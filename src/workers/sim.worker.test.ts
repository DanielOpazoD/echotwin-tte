// @tier fast
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
  let core: { prototype: { step: (dt: number) => unknown; request: (req: never) => unknown } };
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

  // Its own deadline: it renders real frames, and with coverage on the CI runner loaded by other applications it took
  // 60.5 and 87 s against the default 60 s in the pipelines of main a7048aa (a few seconds on a quiet machine).
  it(
    'keeps at most two frames outstanding until the main thread recycles',
    { timeout: 300_000 },
    () => {
      load();
      vi.advanceTimersByTime(1000);
      expect(posted().filter((m) => m.type === 'frame')).toHaveLength(2);
      const frame = posted().find((m) => m.type === 'frame');
      if (frame?.type !== 'frame') throw new Error('no frame');
      fakeSelf.onmessage!({ data: { type: 'recycle', buffer: frame.output.rgba } });
      vi.advanceTimersByTime(200);
      expect(posted().filter((m) => m.type === 'frame')).toHaveLength(3);
    },
  );

  it('reports a failing tick, retries, and stops after MAX_TICK_FAILURES in a row', () => {
    load();
    vi.spyOn(core.prototype, 'step').mockImplementation(() => {
      throw new Error('render exploded');
    });
    vi.advanceTimersByTime(mod.TICK_RETRY_MS * (mod.MAX_TICK_FAILURES + 2));
    const errors = posted().filter((m) => m.type === 'error');
    expect(errors).toHaveLength(mod.MAX_TICK_FAILURES);
    expect(errors.at(-1)?.type === 'error' && errors.at(-1)?.message).toMatch(/detenida/);
    // the learner reads the message; the stack trace stays in the console (decision 154)
    for (const m of errors) expect(m.type === 'error' && m.message).not.toMatch(/\n\s+at /);
    expect(errors[0]?.type === 'error' && errors[0].message).toBe('render exploded');
    const before = posted().length;
    vi.advanceTimersByTime(mod.TICK_RETRY_MS * 4);
    expect(posted().length).toBe(before);
  });

  it('answers a canonical-control request with the pose of its own models', () => {
    load();
    fakeSelf.onmessage!({
      data: { type: 'request', id: 7, req: { kind: 'canonicalControl', viewId: 'a4c' } },
    });
    const reply = posted().find((m) => m.type === 'response');
    if (reply?.type !== 'response' || reply.res?.kind !== 'canonicalControl')
      throw new Error('no canonical-control response');
    expect(reply.id).toBe(7);
    const c = reply.res.control;
    expect(Number.isFinite(c.u) && Number.isFinite(c.v) && Number.isFinite(c.rotationDeg)).toBe(
      true,
    );
    // the apical window lies caudal and lateral to the parasternal start pose
    expect(c.v).toBeLessThan(0);
  });

  it('reports a failing message by its text, with the stack only in the console', () => {
    load();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(core.prototype, 'request').mockImplementation(() => {
      throw new Error('bad request');
    });
    fakeSelf.onmessage!({
      data: { type: 'request', id: 8, req: { kind: 'canonicalControl', viewId: 'a4c' } },
    });
    const error = posted().find((m) => m.type === 'error');
    expect(error?.type === 'error' && error.message).toBe('bad request');
    expect(logged).toHaveBeenCalled();
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

describe('sim.worker while frozen (decision 197)', () => {
  let fakeSelf: FakeSelf;
  let core: { prototype: { step: (dt: number) => unknown } };
  beforeEach(async () => {
    vi.useFakeTimers();
    fakeSelf = { onmessage: null, postMessage: vi.fn() };
    (globalThis as { self?: unknown }).self = fakeSelf;
    vi.resetModules();
    core = (await import('@/simulator/core/simulatorCore')).SimulatorCore;
    await import('./sim.worker');
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    delete (globalThis as { self?: unknown }).self;
  });

  it('forms the new cine frame at once instead of waiting for its 80 ms tick', () => {
    fakeSelf.onmessage!({
      data: {
        type: 'loadCase',
        caseDef: loadCaseById('normal-excellent-window'),
        input: { ...baseInput(), frozen: true },
      },
    });
    const step = vi.spyOn(core.prototype, 'step').mockReturnValue(null);
    vi.advanceTimersByTime(5);
    const ticks = step.mock.calls.length;
    expect(ticks).toBeGreaterThan(0);
    // the same frame again waits for the frozen tick
    fakeSelf.onmessage!({ data: { type: 'input', input: { ...baseInput(), frozen: true } } });
    vi.advanceTimersByTime(5);
    expect(step.mock.calls.length).toBe(ticks);
    // another frame of the cine is formed within a millisecond or two
    fakeSelf.onmessage!({
      data: { type: 'input', input: { ...baseInput(), frozen: true, cineOffset: -5 } },
    });
    vi.advanceTimersByTime(2);
    expect(step.mock.calls.length).toBe(ticks + 1);
  });
});
