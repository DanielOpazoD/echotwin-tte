import type { SimOutput, SimRequest, SimResponse } from '@/simulator/core/protocol';

/**
 * Hand-off between the simulation loop and the display canvas. The latest composite frame is
 * delivered imperatively to listeners (the canvas draws it immediately, outside React) and its
 * buffer is recycled back to the worker after drawing. React only receives a throttled HUD.
 */
type Listener = (out: SimOutput) => void;
const listeners = new Set<Listener>();
export const frameBus = {
  latest: null as SimOutput | null,
  /** Main-thread cost of the last frame (diagnostics for the Dev panel and performance checks). */
  diag: { drawMs: 0, overlayMs: 0, frames: 0 },
  recycle: (_b: ArrayBuffer): void => {},
  /** On-demand request to the simulator (auto-trace); wired by useSimulation. */
  request: (_req: SimRequest): Promise<SimResponse | null> => Promise.resolve(null),
  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  emit(out: SimOutput): void {
    if (listeners.size === 0) {
      // no display mounted (report, references, curriculum or progress screen): acknowledge the frame at once,
      // otherwise the worker keeps two frames outstanding and drops every later one until the case reloads
      out.bitmap?.close();
      frameBus.recycle(out.rgba);
      return;
    }
    for (const l of listeners) l(out);
  },
};
