/**
 * Geometry of the ECG trace drawn under the image (DisplayCanvas): a sliding window of `spanS`
 * seconds ending at `headS`. The caller keeps the canvas calls; this module only maps samples to
 * screen points.
 */

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
