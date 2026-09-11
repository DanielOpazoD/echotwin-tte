import type { CaseDefinition } from '@/cases/schema';
import type { MainToWorker, PhaseMarks, SimInput, SimOutput, SimRequest, SimResponse, WorkerToMain } from './protocol';
import { SimulatorCore } from './simulatorCore';
import type { StructuredEchoTruth } from '@/simulator/hemodynamics/groundTruth';

/**
 * SimClient: drives the simulator either in a Web Worker (default) or inline on the main thread
 * (fallback when Workers are unavailable, and for tests). Inputs are pushed when they change; the
 * worker paces itself. Recycling a frame buffer acknowledges consumption (back-pressure).
 */
export interface SimClientHandlers {
  onFrame: (out: SimOutput) => void;
  onReady: (truth: StructuredEchoTruth, caseId: string, phaseMarks: PhaseMarks, lvLengthCm: number) => void;
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

  constructor(handlers: SimClientHandlers, forceInline = false) {
    this.handlers = handlers;
    if (!forceInline && typeof Worker !== 'undefined') {
      try {
        this.worker = new Worker(new URL('../../workers/sim.worker.ts', import.meta.url), { type: 'module' });
        this.worker.onmessage = (ev: MessageEvent<WorkerToMain>) => this.handle(ev.data);
        this.worker.onerror = (e) => handlers.onError(String(e.message ?? e));
        this.mode = 'worker';
        return;
      } catch (e) {
        console.warn('Worker unavailable, falling back to inline simulation', e);
      }
    }
    this.mode = 'inline';
  }

  private pending = new Map<number, (r: SimResponse | null) => void>();
  private nextId = 1;

  private handle(msg: WorkerToMain): void {
    if (msg.type === 'frame') this.handlers.onFrame(msg.output);
    else if (msg.type === 'ready') this.handlers.onReady(msg.truth, msg.caseId, msg.phaseMarks, msg.lvLengthCm);
    else if (msg.type === 'response') {
      const cb = this.pending.get(msg.id);
      if (cb) {
        this.pending.delete(msg.id);
        cb(msg.res);
      }
    } else if (msg.type === 'error') this.handlers.onError(msg.message);
  }

  /** On-demand request to the simulator (auto-trace etc.). */
  request(req: SimRequest): Promise<SimResponse | null> {
    if (this.worker) {
      const id = this.nextId++;
      return new Promise((resolve) => {
        this.pending.set(id, resolve);
        const m: MainToWorker = { type: 'request', id, req };
        this.worker!.postMessage(m);
      });
    }
    return Promise.resolve(this.inline ? this.inline.request(req) : null);
  }

  loadCase(caseDef: CaseDefinition, input: SimInput): void {
    this.lastInputJson = JSON.stringify(input);
    if (this.worker) {
      const m: MainToWorker = { type: 'loadCase', caseDef, input };
      this.worker.postMessage(m);
      return;
    }
    this.inline = new SimulatorCore(caseDef, input);
    this.handlers.onReady(this.inline.truth, caseDef.id, this.inline.phaseMarks(), this.inline.lvLengthCm());
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
    this.worker?.terminate();
    this.worker = null;
    if (this.inlineTimer) clearInterval(this.inlineTimer);
    this.inline = null;
  }
}
