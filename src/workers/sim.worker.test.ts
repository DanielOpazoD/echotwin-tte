import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCaseById } from '@/cases';
import { baseInput } from '@/simulator/core/baseInput';
import type { WorkerToMain } from '@/simulator/core/protocol';

/**
 * The worker module registers `self.onmessage` on import, so it is loaded with a fake `self` per test.
 * What is checked here is the pacing contract that only E2E exercised before (engineering audit, B5): a
 * loaded case answers `ready` and starts ticking, a tick that throws is reported and retried, and after
 * MAX_TICK_FAILURES consecutive failures the worker stops instead of retrying forever.
 */
type FakeSelf = {
  onmessage: ((ev: { data: unknown }) => void) | null;
  postMessage: ReturnType<typeof vi.fn>;
};

describe('sim.worker pacing and failure policy', () => {
  let fakeSelf: FakeSelf;
  let mod: { MAX_TICK_FAILURES: number; TICK_RETRY_MS: number };
  /** The worker's own copy of the core (vi.resetModules gives it a fresh module graph), so spies reach it. */
  let core: { prototype: { step: (dt: number) => unknown } };
  beforeEach(async () => {
    vi.useFakeTimers();
    fakeSelf = { onmessage: null, postMessage: vi.fn() };
    (globalThis as { self?: unknown }).self = fakeSelf;
    vi.resetModules();
    core = (await import('@/simulator/core/simulatorCore')).SimulatorCore;
    mod = await import('./sim.worker');
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    delete (globalThis as { self?: unknown }).self;
  });
  const posted = (): WorkerToMain[] =>
    fakeSelf.postMessage.mock.calls.map((c) => c[0] as WorkerToMain);
  const load = () =>
    fakeSelf.onmessage!({
      data: {
        type: 'loadCase',
        caseDef: loadCaseById('normal-excellent-window'),
        input: baseInput(),
      },
    });

  it('answers ready and delivers frames on its own clock', () => {
    load();
    expect(posted()[0]?.type).toBe('ready');
    vi.advanceTimersByTime(300);
    const frames = posted().filter((m) => m.type === 'frame');
    expect(frames.length).toBeGreaterThan(0);
    expect(posted().filter((m) => m.type === 'error')).toEqual([]);
  });

  it('keeps at most two frames outstanding until the main thread recycles', () => {
    load();
    vi.advanceTimersByTime(1000);
    expect(posted().filter((m) => m.type === 'frame')).toHaveLength(2);
    const frame = posted().find((m) => m.type === 'frame');
    if (frame?.type !== 'frame') throw new Error('no frame');
    fakeSelf.onmessage!({ data: { type: 'recycle', buffer: frame.output.rgba } });
    vi.advanceTimersByTime(200);
    expect(posted().filter((m) => m.type === 'frame')).toHaveLength(3);
  });

  it('reports a failing tick, retries, and stops after MAX_TICK_FAILURES in a row', () => {
    load();
    vi.spyOn(core.prototype, 'step').mockImplementation(() => {
      throw new Error('render exploded');
    });
    vi.advanceTimersByTime(mod.TICK_RETRY_MS * (mod.MAX_TICK_FAILURES + 2));
    const errors = posted().filter((m) => m.type === 'error');
    expect(errors).toHaveLength(mod.MAX_TICK_FAILURES);
    expect(errors.at(-1)?.type === 'error' && errors.at(-1)?.message).toMatch(/detenida/);
    const before = posted().length;
    vi.advanceTimersByTime(mod.TICK_RETRY_MS * 4);
    expect(posted().length).toBe(before);
  });

  it('a new case resets the failure count and the clock', () => {
    load();
    const spy = vi.spyOn(core.prototype, 'step').mockImplementation(() => {
      throw new Error('render exploded');
    });
    vi.advanceTimersByTime(mod.TICK_RETRY_MS * (mod.MAX_TICK_FAILURES + 2));
    spy.mockRestore();
    load();
    vi.advanceTimersByTime(300);
    expect(posted().filter((m) => m.type === 'frame').length).toBeGreaterThan(0);
  });
});
