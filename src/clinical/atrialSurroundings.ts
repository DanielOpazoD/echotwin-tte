import { LABEL, type RegionImage } from './regionStats';
import { sectorGeometry } from './sectorStats';

/**
 * What an apical image shows just outside the left atrium (decision 333): the grey of the band beyond the LA border, over
 * the myocardium's median grey, split by how the border meets the beam. Where the beam crosses the border (the atrial
 * roof, deep in the sector) the band holds the atrial wall, the pericardium and the mediastinum behind it; where the
 * border runs along the beam, the side walls. The same code runs on a CAMUS image and on the simulator's apical image,
 * both apex up (`orientApical`), on the CAMUS labels only.
 */
export interface AtrialSurroundings {
  /** Median over roof border pixels of the mean grey 0.5–3 mm outside the border, over the myocardium median. */
  roofWall: number;
  /** The same 3–6 mm outside. */
  roofBeyond: number;
  /** The same 0.5–3 mm outside the side borders, which run along the beam. */
  sideWall: number;
}

/** |cos| between the border's outward normal and the beam: above it the beam crosses the border, below the other along it. */
export const ROOF_COS = 0.75;
export const SIDE_COS = 0.35;
/** Border pixels this close to the LV cavity or myocardium are the mitral plane, not the atrial wall (mm). */
const NEAR_LV_MM = 4;
/** Smoothing of the LA indicator for the border normal (mm). */
const NORMAL_MM = 1.5;

const median = (v: number[]): number => {
  if (!v.length) return NaN;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

export function atrialSurroundings(img: RegionImage): AtrialSurroundings {
  const { width: w, height: h, grey, labels } = img;
  const [mx, my] = img.mmPerPx;
  const { apexX, apexY, mask } = sectorGeometry(img);
  const at = (x: number, y: number): number => {
    const xi = Math.round(x),
      yi = Math.round(y);
    return xi < 0 || yi < 0 || xi >= w || yi >= h ? -1 : labels[xi + yi * w]!;
  };
  const g = (x: number, y: number): number => {
    const x0 = Math.floor(x),
      y0 = Math.floor(y),
      fx = x - x0,
      fy = y - y0;
    const p = (xx: number, yy: number): number =>
      grey[Math.min(w - 1, Math.max(0, xx)) + Math.min(h - 1, Math.max(0, yy)) * w]!;
    return (
      (1 - fy) * ((1 - fx) * p(x0, y0) + fx * p(x0 + 1, y0)) +
      fy * ((1 - fx) * p(x0, y0 + 1) + fx * p(x0 + 1, y0 + 1))
    );
  };
  // the LA indicator smoothed by a separable box, whose gradient gives the border normal
  const R = Math.max(2, Math.round(NORMAL_MM / mx));
  const box = (src: Float32Array, dx: number, dy: number): Float32Array => {
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let s = 0,
          n = 0;
        for (let k = -R; k <= R; k++) {
          const xx = x + k * dx,
            yy = y + k * dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          s += src[xx + yy * w]!;
          n++;
        }
        out[x + y * w] = s / n;
      }
    return out;
  };
  const ind = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) ind[i] = labels[i] === LABEL.atrium ? 1 : 0;
  const sm = box(box(ind, 1, 0), 0, 1);
  const myo: number[] = [];
  for (let i = 0; i < w * h; i++) if (labels[i] === LABEL.myocardium) myo.push(grey[i]!);
  const myoMedian = median(myo);
  const lvR = Math.round(NEAR_LV_MM / mx);
  const nearLv = (x: number, y: number): boolean => {
    for (let dy = -lvR; dy <= lvR; dy += 2)
      for (let dx = -lvR; dx <= lvR; dx += 2) {
        const l = at(x + dx, y + dy);
        if (l === LABEL.cavity || l === LABEL.myocardium) return true;
      }
    return false;
  };
  const band = (x: number, y: number, nx: number, ny: number, d0: number, d1: number): number => {
    let s = 0,
      k = 0;
    for (let d = d0 + 0.125; d < d1; d += 0.25) {
      const px = x + (nx * d) / mx,
        py = y + (ny * d) / my;
      if (at(px, py) !== LABEL.background || !mask[Math.round(px) + Math.round(py) * w]) continue;
      s += g(px, py);
      k++;
    }
    return k >= 3 ? s / k : NaN;
  };
  const roofWall: number[] = [],
    roofBeyond: number[] = [],
    sideWall: number[] = [];
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      if (labels[x + y * w] !== LABEL.atrium) continue;
      const n4 = [at(x + 1, y), at(x - 1, y), at(x, y + 1), at(x, y - 1)];
      if (!n4.includes(LABEL.background) || nearLv(x, y)) continue;
      let nx = -(sm[x + 1 + y * w]! - sm[x - 1 + y * w]!) / mx,
        ny = -(sm[x + (y + 1) * w]! - sm[x + (y - 1) * w]!) / my;
      const nl = Math.hypot(nx, ny);
      if (nl < 1e-6) continue;
      nx /= nl;
      ny /= nl;
      const bx = (x - apexX) * mx,
        by = (y - apexY) * my;
      const c = Math.abs(nx * bx + ny * by) / Math.hypot(bx, by);
      if (c > ROOF_COS) {
        const a = band(x, y, nx, ny, 0.5, 3),
          b = band(x, y, nx, ny, 3, 6);
        if (Number.isFinite(a)) roofWall.push(a);
        if (Number.isFinite(b)) roofBeyond.push(b);
      } else if (c < SIDE_COS) {
        const a = band(x, y, nx, ny, 0.5, 3);
        if (Number.isFinite(a)) sideWall.push(a);
      }
    }
  // too few border pixels (an atrium cut by the sector's end) give no number
  const rel = (v: number[]): number => (v.length >= 20 ? median(v) / myoMedian : NaN);
  return { roofWall: rel(roofWall), roofBeyond: rel(roofBeyond), sideWall: rel(sideWall) };
}
