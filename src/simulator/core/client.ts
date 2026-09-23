import type { CaseDefinition } from '@/cases/schema';
import type {
  MainToWorker,
  PhaseMarks,
  SimInput,
  SimOutput,
  SimRequest,
  SimResponse,
  WorkerToMain,
} from './protocol';
import type { SimulatorCore } from './simulatorCore';
import type { StructuredEchoTruth } from '@/simulator/hemodynamics/groundTruth';

/**
 * SimClient: drives the simulator either in a Web Worker (default) or inline on the main thread
 * (fallback when Workers are unavailable, and for tests). Inputs are pushed when they change; the
 * worker paces itself. Recycling a frame buffer acknowledges consumption (back-pressure).
 */
export interface SimClientHandlers {
  onFrame: (out: SimOutput) => void;
  onReady: (
    truth: StructuredEchoTruth,
    caseId: string,
    phaseMarks: PhaseMarks,
    lvLengthCm: number,
  ) => void;
  onError: (message: string) => void;
}

export class SimClient {
  private worker: Worker | null = null;
  private inline: SimulatorCore | null = null;
  private inlineTimer: ReturnType<typeof setInterval> | null = null;
  private inlineLast = 0;
  private lastInputJson = '';
  private handlers: SimClientHandlers;
  readonly mode: 'worker' | 'inline';
  /** Requests still waiting for the worker; every one is settled — by reply, error, reload, timeout or dispose. */
  private pending = new Map<
    number,
    {
      resolve: (r: SimResponse | null) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private nextId = 1;

  constructor(handlers: SimClientHandlers, forceInline = false) {
    this.handlers = handlers;
    if (!forceInline && typeof Worker !== 'undefined') {
      try {
        this.worker = new Worker(new URL('../../workers/sim.worker.ts', import.meta.url), {
          type: 'module',
        });
        this.worker.onmessage = (ev: MessageEvent<WorkerToMain>) => this.handle(ev.data);
        this.worker.onerror = (e) => {
          const message = String(e.message ?? e);
          this.rejectPending(new Error(`simulation worker failed: ${message}`));
          handlers.onError(message);
        };
        this.mode = 'worker';
        return;
      } catch (e) {
        console.warn('Worker unavailable, falling back to inline simulation', e);
      }
    }
    this.mode = 'inline';
  }

  private handle(msg: WorkerToMain): void {
    if (msg.type === 'frame') this.handlers.onFrame(msg.output);
    else if (msg.type === 'ready')
      this.handlers.onReady(msg.truth, msg.caseId, msg.phaseMarks, msg.lvLengthCm);
    else if (msg.type === 'response') {
      const p = this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        p.resolve(msg.res);
      }
    } else if (msg.type === 'error') {
      // the worker caught an exception: any request it was serving will never be answered
      this.rejectPending(new Error(`simulation worker error: ${msg.message.split('\n')[0]}`));
      this.handlers.onError(msg.message);
    }
  }

  private rejectPending(reason: Error): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(reason);
    }
    this.pending.clear();
  }

  /**
   * On-demand request to the simulator (auto-trace etc.). Rejects if the worker reports an error, the case is
   * reloaded, the client is disposed or no reply arrives within `timeoutMs`; a caller that only awaits the
   * value would otherwise hang forever on a dead worker (engineering audit, A5).
   */
  request(req: SimRequest, timeoutMs = 5000): Promise<SimResponse | null> {
    if (this.worker) {
      const id = this.nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          if (this.pending.delete(id))
            reject(new Error(`simulation request ${req.kind} timed out after ${timeoutMs} ms`));
        }, timeoutMs);
        this.pending.set(id, { resolve, reject, timer });
        const m: MainToWorker = { type: 'request', id, req };
        this.worker!.postMessage(m);
      });
    }
    return Promise.resolve(this.inline ? this.inline.request(req) : null);
  }

  /**
   * Load a case. With a worker the request is posted at once; inline, the core module is loaded on demand
   * first — it is the whole engine, and keeping it out of the entry chunk is what lets the application start
   * with the worker alone (audit B7) — so the returned promise settles when `ready` has been announced.
   */
  loadCase(caseDef: CaseDefinition, input: SimInput): Promise<void> {
    this.lastInputJson = JSON.stringify(input);
    // a new core answers nothing asked of the old one
    this.rejectPending(new Error('simulation request cancelled: case reloaded'));
    if (this.worker) {
      const m: MainToWorker = { type: 'loadCase', caseDef, input };
      this.worker.postMessage(m);
      return Promise.resolve();
    }
    const generation = ++this.inlineGeneration;
    return import('./simulatorCore').then(({ SimulatorCore }) => {
      if (generation !== this.inlineGeneration || this.disposed) return; // superseded or disposed meanwhile
      this.startInline(new SimulatorCore(caseDef, input), caseDef.id);
    });
  }

  private inlineGeneration = 0;
  private disposed = false;

  private startInline(core: SimulatorCore, caseId: string): void {
    this.inline?.dispose();
    this.inline = core;
    this.handlers.onReady(core.truth, caseId, core.phaseMarks(), core.lvLengthCm());
    if (this.inlineTimer) clearInterval(this.inlineTimer);
    this.inlineLast = performance.now();
    this.inlineTimer = setInterval(() => {
      if (!this.inline) return;
      const now = performance.now();
      const out = this.inline.step((now - this.inlineLast) / 1000);
      this.inlineLast = now;
      if (out) this.handlers.onFrame(out);
    }, 33);
  }

  /** Push the current input if it changed. Cheap enough to call every animation frame. */
  send(input: SimInput): void {
    const json = JSON.stringify(input);
    if (json === this.lastInputJson) return;
    this.lastInputJson = json;
    if (this.worker) {
      const m: MainToWorker = { type: 'input', input };
      this.worker.postMessage(m);
    } else this.inline?.setInput(input);
  }

  recycle(buffer: ArrayBuffer): void {
    if (this.worker) {
      const m: MainToWorker = { type: 'recycle', buffer };
      this.worker.postMessage(m, [buffer]);
    } else this.inline?.recycle(buffer);
  }

  dispose(): void {
    this.disposed = true;
    this.rejectPending(new Error('simulation request cancelled: client disposed'));
    this.worker?.terminate();
    this.worker = null;
    if (this.inlineTimer) clearInterval(this.inlineTimer);
    this.inline?.dispose();
    this.inline = null;
  }
}
