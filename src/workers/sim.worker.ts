import { SimulatorCore } from '@/simulator/core/simulatorCore';
import type { MainToWorker, SimInput, WorkerToMain } from '@/simulator/core/protocol';

/**
 * Web Worker entry. The worker drives its own clock (setTimeout at the simulated frame interval)
 * so the simulation keeps running independently of main-thread rAF throttling; the main thread
 * only sends inputs when they change and recycles buffers (which doubles as back-pressure ack).
 */
let core: SimulatorCore | null = null;
let input: SimInput | null = null;
let lastTick = 0;
let outstanding = 0;
let lastPostMs = 0;
let dropped = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
/** Absolute time (ms) the next tick is due, and how late the current one fired (diagnostics). */
let nextDue = 0;
let lateMs = 0;
let lastFps = 30;
/**
 * Consecutive ticks that threw. Each one is reported and retried after a pause; after MAX_TICK_FAILURES the
 * worker stops instead of retrying forever against a broken core (engineering audit, A5). A successful tick or
 * a new case resets the count.
 */
let tickFailures = 0;
export const MAX_TICK_FAILURES = 5;
export const TICK_RETRY_MS = 500;

const post = (m: WorkerToMain, transfer?: Transferable[]): void => {
  (self as unknown as Worker).postMessage(m, transfer ?? []);
};

function schedule(delayMs: number): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(tick, delayMs);
}

function tick(): void {
  timer = null;
  if (!core || !input) return;
  const tStart = performance.now();
  lateMs = nextDue > 0 ? Math.max(0, tStart - nextDue) : 0;
  const now = tStart / 1000;
  const dt = lastTick ? now - lastTick : 1 / 60;
  lastTick = now;
  try {
    const t0 = performance.now();
    const out = core.step(dt);
    const stepMs = performance.now() - t0;
    tickFailures = 0;
    if (out && outstanding < 2) {
      out.stats = {
        ...out.stats,
        stepMs: Number(stepMs.toFixed(1)),
        postMs: Number(lastPostMs.toFixed(2)),
        lateMs: Number(lateMs.toFixed(1)),
        dropped,
      };
      outstanding++;
      const tp = performance.now();
      post({ type: 'frame', output: out }, out.bitmap ? [out.rgba, out.bitmap] : [out.rgba]);
      lastPostMs = performance.now() - tp;
    } else if (out) {
      out.bitmap?.close(); // main thread is behind: drop the frame, keep simulating
      core.recycle(out.rgba);
      dropped++;
    }
    // pace at the simulated frame rate (or 30 Hz for strips) against an absolute schedule: a timer that fires
    // late shortens the next wait instead of lowering the frame rate (worker timers ran ~5 ms late under load,
    // 31.5 instead of 36.9 frames/s); after a stall longer than one interval the schedule restarts from now
    if (out) lastFps = out.simulatedFps;
    const targetMs = input.frozen ? 80 : Math.max(12, Math.min(50, 1000 / lastFps));
    nextDue = nextDue > 0 && tStart - nextDue < targetMs ? nextDue + targetMs : tStart + targetMs;
    schedule(Math.max(1, nextDue - performance.now()));
  } catch (e) {
    tickFailures++;
    // the learner reads the message; the stack goes to the console (decision 154)
    const detail = e instanceof Error ? e.message : String(e);
    console.error('sim.worker: fallo del paso de simulación', e);
    if (tickFailures >= MAX_TICK_FAILURES) {
      post({
        type: 'error',
        message: `Simulación detenida tras ${tickFailures} errores consecutivos; recarga el caso. (${detail})`,
      });
      return;
    }
    post({ type: 'error', message: detail });
    schedule(TICK_RETRY_MS);
  }
}

self.onmessage = (ev: MessageEvent<MainToWorker>) => {
  const msg = ev.data;
  try {
    if (msg.type === 'init' || msg.type === 'loadCase') {
      core = new SimulatorCore(msg.caseDef, msg.input);
      input = msg.input;
      lastTick = 0;
      outstanding = 0;
      nextDue = 0;
      lastFps = 30;
      tickFailures = 0;
      post({
        type: 'ready',
        truth: core.truth,
        caseId: msg.caseDef.id,
        phaseMarks: core.phaseMarks(),
        lvLengthCm: core.lvLengthCm(),
      });
      schedule(1);
      return;
    }
    if (!core) return;
    if (msg.type === 'recycle') {
      core.recycle(msg.buffer);
      outstanding = Math.max(0, outstanding - 1);
      return;
    }
    if (msg.type === 'input') {
      input = msg.input;
      core.setInput(msg.input);
      return;
    }
    if (msg.type === 'request') {
      post({ type: 'response', id: msg.id, res: core.request(msg.req) });
    }
  } catch (e) {
    // the message reaches the screen; the stack only the console (decision 154)
    console.error('sim worker:', e);
    post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
};
