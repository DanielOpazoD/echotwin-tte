/**
 * Myocardial texture samples of the realism bench (decision 344): the grey of the eroded myocardium with its local mean
 * removed (a box of ±`halfWindowMm`), the speckle-scale residual whose distribution shape the bench compares between
 * the simulator and CAMUS. Removing the local mean of a grey linear in dB removes the slow changes of echo level (fibre
 * angle, depth, gain) without touching the shape of log-compressed speckle.
 */
import { erode, LABEL, type RegionImage } from '../regionStats';

/** Residual grey (grey − local mean) of the pixels of `label` after `erodePx` erosions, skipping clipped pixels. */
export function regionResidual(
  img: RegionImage,
  label: number = LABEL.myocardium,
  erodePx = 2,
  halfWindowMm = 4,
): Float64Array {
  const { width: w, height: h, grey } = img;
  const inRegion = Uint8Array.from(img.labels, (l) => (l === label ? 1 : 0));
  const core = erode(img.labels, w, h, label, erodePx);
  // integral images of the region's grey and count, so the local mean uses only the region's own pixels
  const S = new Float64Array((w + 1) * (h + 1)),
    C = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = x + y * w;
      const v = inRegion[i] ? grey[i]! : 0;
      const c = inRegion[i] ? 1 : 0;
      const o = x + 1 + (y + 1) * (w + 1);
      S[o] = v + S[o - 1]! + S[o - (w + 1)]! - S[o - (w + 1) - 1]!;
      C[o] = c + C[o - 1]! + C[o - (w + 1)]! - C[o - (w + 1) - 1]!;
    }
  const rx = Math.max(1, Math.round(halfWindowMm / img.mmPerPx[0])),
    ry = Math.max(1, Math.round(halfWindowMm / img.mmPerPx[1]));
  const box = (A: Float64Array, x0: number, y0: number, x1: number, y1: number): number =>
    A[x1 + y1 * (w + 1)]! - A[x0 + y1 * (w + 1)]! - A[x1 + y0 * (w + 1)]! + A[x0 + y0 * (w + 1)]!;
  const out: number[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = x + y * w;
      if (!core[i]) continue;
      const g = grey[i]!;
      // the black and white ends clip the distribution: a pixel there says nothing about its shape
      if (g <= 0 || g >= 255) continue;
      const x0 = Math.max(0, x - rx),
        x1 = Math.min(w, x + rx + 1),
        y0 = Math.max(0, y - ry),
        y1 = Math.min(h, y + ry + 1);
      const n = box(C, x0, y0, x1, y1);
      if (n < 4) continue;
      out.push(g - box(S, x0, y0, x1, y1) / n);
    }
  return Float64Array.from(out);
}
