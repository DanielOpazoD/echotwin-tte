import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadCaseById } from '@/cases';
import { SimClient, type SimClientHandlers } from './client';
import { baseInput } from './baseInput';

function handlers(): SimClientHandlers & { ready: unknown[]; frames: unknown[]; errors: string[] } {
  const h = {
    ready: [] as unknown[],
    frames: [] as unknown[],
    errors: [] as string[],
    onFrame(o: unknown) {
      h.frames.push(o);
    },
    onReady(...a: unknown[]) {
      h.ready.push(a);
    },
    onError(m: string) {
      h.errors.push(m);
    },
  };
  return h as SimClientHandlers & { ready: unknown[]; frames: unknown[]; errors: string[] };
}

// Node has no Worker, so the client always takes the inline path here — the same path tests use.
describe('SimClient inline path', () => {
  let client: SimClient | null = null;
  afterEach(() => {
    client?.dispose();
    client = null;
    vi.useRealTimers();
  });

  it('reports inline mode, announces the case as ready with its truth and phase marks', () => {
    const h = handlers();
    client = new SimClient(h);
    expect(client.mode).toBe('inline');
    const c = loadCaseById('normal-excellent-window');
    client.loadCase(c, baseInput());
    expect(h.errors).toEqual([]);
    expect(h.ready).toHaveLength(1);
    const [truth, caseId, marks, lvLen] = h.ready[0] as [
      unknown,
      string,
      { ejectionStart: number; ejectionEnd: number; hasAWave: boolean },
      number,
    ];
    expect(caseId).toBe('normal-excellent-window');
    expect(truth).toBeTruthy();
    expect(marks.ejectionStart).toBeGreaterThan(0);
    expect(marks.ejectionEnd).toBeLessThan(1);
    expect(lvLen).toBeGreaterThan(0);
  });

  it('delivers frames on its timer until disposed', () => {
    vi.useFakeTimers();
    const h = handlers();
    client = new SimClient(h);
    client.loadCase(loadCaseById('normal-excellent-window'), baseInput());
    vi.advanceTimersByTime(500);
    const n = h.frames.length;
    expect(n).toBeGreaterThan(0);
    client.dispose();
    vi.advanceTimersByTime(500);
    expect(h.frames.length).toBe(n);
    expect(h.errors).toEqual([]);
  });

  it('resolves requests against the core and ignores unchanged input', async () => {
    const h = handlers();
    client = new SimClient(h);
    const input = baseInput();
    client.loadCase(loadCaseById('normal-excellent-window'), input);
    // an autoTrace request with no spectral strip yet resolves to null, not an error
    await expect(client.request({ kind: 'autoTrace', x0: 0, x1: 10 })).resolves.toBeNull();
    client.send(input);
    client.send({ ...input, gateDepthCm: 8 });
    expect(h.errors).toEqual([]);
    expect(() => client!.recycle(new ArrayBuffer(8))).not.toThrow();
  });
});
