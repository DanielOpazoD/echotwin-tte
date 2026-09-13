// Where does speckle dB variance go? Detrended dB std of the myocardial envelope in the polar frame, after the console,
// and after scan conversion, with and without display smoothing.
import { renderApical, presentApical } from '@/simulator/renderer/clinicalImage';
import { DISPLAY_SMOOTHING } from '@/simulator/renderer/acoustic/psf';
import { applyConsole, createConsoleState } from '@/simulator/renderer/postprocess/consolePipeline';
import { DEFAULT_ACQUISITION } from '@/simulator/renderer/types';
import { Structure, Tissue } from '@/simulator/anatomy/tissue';
import { erode, imageStats, LABEL } from '@/clinical/regionStats';
const isLv = (s: number) => s >= Structure.LvWallSeptal && s <= Structure.LvApex;
function detrendedStdPolar(values: Float64Array, ok: Uint8Array, L: number, N: number, rl: number, rs: number): number {
  const res: number[] = [];
  for (let li = 0; li < L; li++) for (let si = 0; si < N; si++) {
    const i = li * N + si; if (!ok[i]) continue;
    let s = 0, n = 0;
    for (let a = Math.max(0, li - rl); a <= Math.min(L - 1, li + rl); a++) for (let b = Math.max(0, si - rs); b <= Math.min(N - 1, si + rs); b++) { const j = a * N + b; if (ok[j]) { s += values[j]!; n++; } }
    res.push(values[i]! - s / n);
  }
  const m = res.reduce((a, b) => a + b, 0) / res.length;
  return Math.sqrt(res.reduce((a, b) => a + (b - m) ** 2, 0) / res.length);
}
for (const [lat, ax] of [[0, 0], [2.5, 2.5]]) {
  DISPLAY_SMOOTHING.lateralMm = lat; DISPLAY_SMOOTHING.axialMm = ax;
  const r = renderApical('normal-excellent-window', 'a4c', true);
  const { lines: L, samples: N, depthCm, sectorRad } = r.frame.spec;
  const dr = depthCm / N;
  // myocardium eroded by 2 samples/lines, 5-11 cm
  const ok = new Uint8Array(L * N);
  for (let li = 2; li < L - 2; li++) for (let si = Math.floor(5 / dr); si < Math.floor(11 / dr); si++) {
    let all = true;
    for (let a = -2; a <= 2 && all; a++) for (let b = -2; b <= 2; b++) { const j = (li + a) * N + si + b; if (!isLv(r.frame.structure[j]!) || r.frame.tissue[j] !== Tissue.Myocardium) { all = false; break; } }
    if (all) ok[li * N + si] = 1;
  }
  const db = new Float64Array(L * N);
  for (let i = 0; i < L * N; i++) db[i] = 20 * Math.log10((r.frame.amplitude[i] ?? 0) / Math.max(1e-4, r.frame.transmission[i] ?? 1) + 1e-9);
  // ±4 mm window: samples ±4/dr/10, lines at 8 cm ±4 mm / (r dθ)
  const rs = Math.round(0.4 / dr), rl = Math.round(0.4 / (8 * sectorRad / L));
  const disp = new Uint8ClampedArray(L * N);
  applyConsole(r.frame, DEFAULT_ACQUISITION, createConsoleState(r.seed), disp);
  const g = new Float64Array(L * N); for (let i = 0; i < L * N; i++) g[i] = disp[i]!;
  const st = imageStats(presentApical(r));
  let n = 0; for (const v of ok) n += v;
  console.log(`smoothing ${lat}/${ax}: polar myo samples ${n}; envelope dB detrended std ${detrendedStdPolar(db, ok, L, N, rl, rs).toFixed(2)} dB (Rayleigh 5.57); console grey detrended std ${detrendedStdPolar(g, ok, L, N, rl, rs).toFixed(1)} (= ${(detrendedStdPolar(g, ok, L, N, rl, rs) / (255 / 70)).toFixed(2)} dB); scan-converted detrended std ${st.myocardialDetrendedStd.toFixed(1)} (= ${(st.myocardialDetrendedStd / (255 / 70)).toFixed(2)} dB)`);
}
