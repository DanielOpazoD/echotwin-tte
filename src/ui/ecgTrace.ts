/**
 * Geometry of the ECG trace drawn under the image (DisplayCanvas): a sliding window of `spanS`
 * seconds ending at `headS`, or, with a Doppler or M-mode strip on screen, a sweep written as the
 * strip is (decision 231). The caller keeps the canvas calls; this module only maps samples to
 * screen points.
 */
import type { SimOutput } from '@/simulator/core/protocol';
import type { SimStore } from '@/app/store';

/** Bottom padding between the trace floor and the strip's bottom edge (px). */
const BOTTOM_PAD_PX = 6;
/** Vertical room the value range maps onto: `height - VALUE_PAD_PX` (px). */
const VALUE_PAD_PX = 10;

export interface EcgLayout {
  /** Left edge of the trace (px). */
  x0: number;
  /** Trace width (px). */
  width: number;
  /** Top edge of the strip (px). */
  y: number;
  /** Strip height (px). */
  height: number;
  /** Window length in seconds. */
  spanS: number;
  /** Window end (sweep head) in seconds. */
  headS: number;
  /**
   * With a strip on screen the ECG is written as the strip is (decision 231): a sweep of `columns` columns over the
   * trace whose newest sample sits just before `headColumn`, where the strip's sweep marker stands. Until then the ECG
   * scrolled 3 s over the strip's 2 s sweep, and the E wave of a mitral inflow showed 80 ms before the R that
   * precedes it by 480 ms.
   */
  sweep?: { headColumn: number; columns: number } | null;
}

/** Fractional column (0…columns) of a time on a sweep, or null outside the last sweep. */
function sweepColumn(tS: number, l: EcgLayout, clamp: boolean): number | null {
  const sw = l.sweep!;
  let age = l.headS - tS;
  if (clamp) age = Math.max(0, Math.min(l.spanS, age));
  else if (age < 0 || age > l.spanS) return null;
  const c = sw.headColumn - 0.5 - (age / l.spanS) * sw.columns;
  return ((c % sw.columns) + sw.columns) % sw.columns;
}

/** Screen point of an ECG sample under a sliding window ending at headS. */
export function ecgPoint(
  p: { t: number; v: number },
  l: EcgLayout,
): { x: number; y: number } | null {
  const y = l.y + l.height - BOTTOM_PAD_PX - p.v * (l.height - VALUE_PAD_PX);
  if (l.sweep) {
    const c = sweepColumn(p.t, l, false);
    return c === null ? null : { x: l.x0 + (c / l.sweep.columns) * l.width, y };
  }
  const t0 = l.headS - l.spanS;
  if (p.t < t0) return null;
  return { x: l.x0 + ((p.t - t0) / l.spanS) * l.width, y };
}

/** Visible samples as screen polylines, in input order: one, or two on a sweep, split at its head (decision 231). */
export function ecgTracePoints(ecg: Float64Array, l: EcgLayout): { x: number; y: number }[][] {
  const lines: { x: number; y: number }[][] = [];
  let line: { x: number; y: number }[] = [];
  // interleaved (time, amplitude) pairs, as the simulator sends them (decision 173)
  for (let i = 0; i + 1 < ecg.length; i += 2) {
    const pt = ecgPoint({ t: ecg[i]!, v: ecg[i + 1]! }, l);
    if (!pt) continue;
    const prev = line[line.length - 1];
    if (prev && pt.x < prev.x) {
      lines.push(line);
      line = [];
    }
    line.push(pt);
  }
  if (line.length) lines.push(line);
  return lines;
}

/** Screen x of a time on the strip, clamped to the trace (px). */
export function ecgX(tS: number, l: EcgLayout): number {
  if (l.sweep) return l.x0 + (sweepColumn(tS, l, true)! / l.sweep.columns) * l.width;
  const f = (tS - (l.headS - l.spanS)) / l.spanS;
  return l.x0 + Math.max(0, Math.min(1, f)) * l.width;
}

/** The time a point of the trace shows: the inverse of `ecgX` within the window or the last sweep. */
export function ecgTimeAtX(x: number, l: EcgLayout): number {
  if (l.sweep) {
    const sw = l.sweep;
    const c = ((x - l.x0) / l.width) * sw.columns;
    const back = (((sw.headColumn - 0.5 - c) % sw.columns) + sw.columns) % sw.columns;
    return l.headS - (back / sw.columns) * l.spanS;
  }
  return l.headS - l.spanS + ((x - l.x0) / l.width) * l.spanS;
}

/**
 * The cine offset (0 = newest frame, −(length − 1) = oldest) of the frame nearest a point on the strip (decision 190).
 * The frames are spread evenly between the oldest and newest times: the cadence barely drifts within one buffer, and
 * the playhead is drawn at the true time of the frame chosen.
 */
export function cineOffsetAtX(
  x: number,
  l: EcgLayout,
  win: { startS: number; endS: number },
  length: number,
): number {
  if (length < 2 || win.endS <= win.startS) return 0;
  const t = ecgTimeAtX(x, l);
  const f = (t - win.endS) / (win.endS - win.startS);
  return Math.max(-(length - 1), Math.min(0, Math.round(f * (length - 1))));
}

/**
 * Where the ECG strip lies: along the bottom of the sector in 2D and colour; with a Doppler or M-mode strip, along the
 * bottom of the whole display and written on the strip's own sweep, so a wave sits over the columns written at its
 * instant (decision 231).
 */
export function ecgLayoutOf(hud: SimOutput, modality: SimStore['modality']): EcgLayout {
  const eh = 30;
  const st = hud.strip;
  if (modality !== '2d' && modality !== 'color' && st?.kind && st.columns > 0) {
    return {
      x0: st.x,
      width: st.width,
      y: hud.height - eh - 6,
      height: eh,
      spanS: st.secondsPerColumn * st.columns,
      headS: hud.ecgHead,
      sweep: { headColumn: st.headColumn, columns: st.columns },
    };
  }
  return {
    x0: 8,
    width: hud.width - 16,
    y: (modality === '2d' || modality === 'color' ? hud.sector.height : hud.height) - eh - 6,
    height: eh,
    // live, the last 3 s; frozen, the whole cine with 0.25 s before it (a slow colour cadence spans 7 s: its older
    // frames fell off a 3 s strip, decision 197)
    spanS: hud.frozen ? Math.max(3, hud.ecgHead - hud.cineWindow.startS + 0.25) : 3,
    headS: hud.ecgHead,
  };
}

/**
 * The cine offset a press at `p` picks on the ECG strip, or null when the press is not a scrub: the image must be
 * frozen, the ECG shown, no tool armed and review mode off (decision 190).
 */
export function cineOffsetOnEcg(
  p: { x: number; y: number },
  hud: SimOutput,
  st: SimStore,
): number | null {
  if (!hud.frozen || !st.ui.showEcg || st.activeTool !== 'none' || st.ui.reviewMode) return null;
  if (hud.ecg.length <= 3 || hud.cineLength < 2) return null;
  const l = ecgLayoutOf(hud, st.modality);
  if (p.y < l.y - 8 || p.y > l.y + l.height || p.x < l.x0 || p.x > l.x0 + l.width) return null;
  return cineOffsetAtX(p.x, l, hud.cineWindow, hud.cineLength);
}
