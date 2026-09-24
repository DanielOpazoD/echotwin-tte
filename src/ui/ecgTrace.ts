/**
 * Geometry of the ECG trace drawn under the image (DisplayCanvas): a sliding window of `spanS`
 * seconds ending at `headS`. The caller keeps the canvas calls; this module only maps samples to
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
}

/** Screen point of an ECG sample under a sliding window ending at headS. */
export function ecgPoint(
  p: { t: number; v: number },
  l: EcgLayout,
): { x: number; y: number } | null {
  const t0 = l.headS - l.spanS;
  if (p.t < t0) return null;
  return {
    x: l.x0 + ((p.t - t0) / l.spanS) * l.width,
    y: l.y + l.height - BOTTOM_PAD_PX - p.v * (l.height - VALUE_PAD_PX),
  };
}

/** Visible samples as screen points, in input order. */
export function ecgTracePoints(ecg: Float64Array, l: EcgLayout): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  // interleaved (time, amplitude) pairs, as the simulator sends them (decision 173)
  for (let i = 0; i + 1 < ecg.length; i += 2) {
    const pt = ecgPoint({ t: ecg[i]!, v: ecg[i + 1]! }, l);
    if (pt) points.push(pt);
  }
  return points;
}

/** Screen x of a time on the strip, clamped to the trace (px). */
export function ecgX(tS: number, l: EcgLayout): number {
  const f = (tS - (l.headS - l.spanS)) / l.spanS;
  return l.x0 + Math.max(0, Math.min(1, f)) * l.width;
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
  const t = l.headS - l.spanS + ((x - l.x0) / l.width) * l.spanS;
  const f = (t - win.endS) / (win.endS - win.startS);
  return Math.max(-(length - 1), Math.min(0, Math.round(f * (length - 1))));
}

/** Where the ECG strip lies: along the bottom of the sector in 2D and colour, of the whole display with a strip. */
export function ecgLayoutOf(hud: SimOutput, modality: SimStore['modality']): EcgLayout {
  const eh = 30;
  return {
    x0: 8,
    width: hud.width - 16,
    y: (modality === '2d' || modality === 'color' ? hud.sector.height : hud.height) - eh - 6,
    height: eh,
    spanS: 3,
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
