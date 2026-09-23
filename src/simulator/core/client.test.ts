// @tier fast
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
  return h;
}

// Node has no Worker, so the client always takes the inline path here — the same path tests use.
describe('SimClient inline path', () => {
  let client: SimClient | null = null;
  afterEach(() => {
    client?.dispose();
    client = null;
    vi.useRealTimers();
  });

  it('reports inline mode, announces the case as ready with its truth and phase marks', async () => {
    const h = handlers();
    client = new SimClient(h);
    expect(client.mode).toBe('inline');
    const c = loadCaseById('normal-excellent-window');
    await client.loadCase(c, baseInput());
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

  it('delivers frames on its timer until disposed', async () => {
    vi.useFakeTimers();
    const h = handlers();
    client = new SimClient(h);
    await client.loadCase(loadCaseById('normal-excellent-window'), baseInput());
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
    await client.loadCase(loadCaseById('normal-excellent-window'), input);
    // an autoTrace request with no spectral strip yet resolves to null, not an error
    await expect(client.request({ kind: 'autoTrace', x0: 0, x1: 10 })).resolves.toBeNull();
    client.send(input);
    client.send({ ...input, gateDepthCm: 8 });
    expect(h.errors).toEqual([]);
    expect(() => client!.recycle(new ArrayBuffer(8))).not.toThrow();
  });
});

/** A stand-in for the browser Worker: records what the client posts and lets a test answer or fail. */
class FakeWorker {
  static instances: FakeWorker[] = [];
  posted: unknown[] = [];
  terminated = false;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: { message: string }) => void) | null = null;
  constructor(_url: unknown, _opts?: unknown) {
    FakeWorker.instances.push(this);
  }
  postMessage(m: unknown): void {
    this.posted.push(m);
  }
  terminate(): void {
    this.terminated = true;
  }
  reply(data: unknown): void {
    this.onmessage?.({ data });
  }
}

describe('SimClient worker path: every request settles', () => {
  const g = globalThis as { Worker?: unknown };
  const saved = g.Worker;
  let client: SimClient | null = null;
  afterEach(() => {
    client?.dispose();
    client = null;
    g.Worker = saved;
    FakeWorker.instances = [];
    vi.useRealTimers();
  });
  const make = () => {
    g.Worker = FakeWorker;
    const h = handlers();
    client = new SimClient(h);
    expect(client.mode).toBe('worker');
    return { h, w: FakeWorker.instances.at(-1)! };
  };

  it('resolves with the worker reply', async () => {
    const { w } = make();
    const p = client!.request({ kind: 'autoTrace', x0: 0, x1: 10 });
    const sent = w.posted.at(-1) as { type: string; id: number };
    expect(sent.type).toBe('request');
    w.reply({ type: 'response', id: sent.id, res: null });
    await expect(p).resolves.toBeNull();
  });

  it('rejects when the worker reports an error, and still forwards the error', async () => {
    const { h, w } = make();
    const p = client!.request({ kind: 'autoTrace', x0: 0, x1: 10 });
    w.reply({ type: 'error', message: 'boom\nstack' });
    await expect(p).rejects.toThrow(/boom/);
    expect(h.errors).toEqual(['boom\nstack']);
  });

  it('rejects when the case is reloaded or the client is disposed', async () => {
    const { w } = make();
    const p1 = client!.request({ kind: 'autoTrace', x0: 0, x1: 10 });
    void client!.loadCase(loadCaseById('normal-excellent-window'), baseInput());
    await expect(p1).rejects.toThrow(/reloaded/);
    const p2 = client!.request({ kind: 'autoTrace', x0: 0, x1: 10 });
    client!.dispose();
    await expect(p2).rejects.toThrow(/disposed/);
    expect(w.terminated).toBe(true);
  });

  it('rejects when no reply arrives in time', async () => {
    vi.useFakeTimers();
    make();
    const p = client!.request({ kind: 'autoTrace', x0: 0, x1: 10 }, 1000);
    vi.advanceTimersByTime(1001);
    await expect(p).rejects.toThrow(/timed out/);
  });

  it('rejects when the worker itself fails to load', async () => {
    const { h, w } = make();
    const p = client!.request({ kind: 'autoTrace', x0: 0, x1: 10 });
    w.onerror?.({ message: 'failed to fetch module' });
    await expect(p).rejects.toThrow(/failed to fetch/);
    expect(h.errors).toEqual(['failed to fetch module']);
  });

  it('disposes the core of the previous case when it loads another, and the last one when disposed (decision 172)', async () => {
    const { SimulatorCore } = await import('./simulatorCore');
    const spy = vi.spyOn(SimulatorCore.prototype, 'dispose');
    try {
      client = new SimClient(handlers());
      await client.loadCase(loadCaseById('normal-excellent-window'), baseInput());
      expect(spy).toHaveBeenCalledTimes(0);
      await client.loadCase(loadCaseById('aortic-stenosis-severe'), baseInput());
      expect(spy).toHaveBeenCalledTimes(1);
      client.dispose();
      client = null;
      expect(spy).toHaveBeenCalledTimes(2);
    } finally {
      spy.mockRestore();
    }
  });
});
