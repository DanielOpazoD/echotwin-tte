import type { CaseDefinition } from '@/cases/schema';
import type { MainToWorker, SimInput, SimOutput, WorkerToMain } from './protocol';
import { SimulatorCore } from './simulatorCore';
import type { StructuredEchoTruth } from '@/simulator/hemodynamics/groundTruth';

/**
 * SimClient: drives the simulator either in a Web Worker (default) or inline on the main thread
 * (fallback when Workers are unavailable, and for tests). Inputs are pushed when they change; the
 * worker paces itself. Recycling a frame buffer acknowledges consumption (back-pressure).
 */
export interface SimClientHandlers {
  onFrame: (out: SimOutput) => void;
  onReady: (truth: StructuredEchoTruth, caseId: string) => void;
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

  private handle(msg: WorkerToMain): void {
    if (msg.type === 'frame') this.handlers.onFrame(msg.output);
    else if (msg.type === 'ready') this.handlers.onReady(msg.truth, msg.caseId);
    else if (msg.type === 'error') this.handlers.onError(msg.message);
  }

  loadCase(caseDef: CaseDefinition, input: SimInput): void {
    this.lastInputJson = JSON.stringify(input);
    if (this.worker) {
      const m: MainToWorker = { type: 'loadCase', caseDef, input };
      this.worker.postMessage(m);
      return;
    }
    this.inline = new SimulatorCore(caseDef, input);
    this.handlers.onReady(this.inline.truth, caseDef.id);
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
