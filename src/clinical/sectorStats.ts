import type { RegionImage } from './regionStats';

/**
 * What the WHOLE sector of an apical image looks like, without labels (decision 146). The region statistics of
 * decision 69 measure the left ventricle and the surroundings of decision 144 the tissue around it; the eye looks at the
 * sector. Twelve blind-test tiles (six CAMUS Good, six simulated at the same scale) were told apart at a glance while
 * their histograms, their coarse variance at 6 and 15 mm, their edge sharpness and their density of thin bright lines
 * overlapped; what separated every one of them was the correlation of the texture along and across the beam: the
 * clinical texture is shorter along the beam at 1 mm and more coherent across it at 4 mm. These statistics are
 * measured in millimetres from the sector apex so that a CAMUS image and a scan-converted simulator image at different
 * pixel sizes give the same numbers for the same picture. They feed the CAMUS reference of `camusSectorStats.ts` and
 * the distinguishability score of `tools/clinical/discriminate.ts`.
 */
export interface SectorStats {
  /** Grey percentiles over the lit sector. */
  greyP5: number;
  greyP25: number;
  greyP50: number;
  greyP75: number;
  greyP95: number;
  /** Fractions of the sector darker than 20 and brighter than 200. */
  darkFraction: number;
  brightFraction: number;
  /** Median grey std in 1.5 mm windows over the sector, and std after removing the ±4 mm local mean. */
  localStd: number;
  detrendedStd: number;
  /** Gradient magnitude after a 1 mm blur, grey levels per mm: median and 95th percentile. */
  gradientP50: number;
  gradientP95: number;
  /** Fraction of sector pixels on a thin bright ridge: brighter than 120 and 40 above both sides 1 mm away. */
  ridgeFraction: number;
  /** Correlation of the demeaned grey with itself displaced along the beam (radial) or across it (tangential). */
  radialCorr1: number;
  radialCorr2: number;
  radialCorr4: number;
  radialCorr8: number;
  tangentialCorr1: number;
  tangentialCorr2: number;
  tangentialCorr4: number;
  tangentialCorr8: number;
  /** Median grey and dark fraction (< 20) in 2 cm depth bands from the apex; NaN where the band holds too few pixels. */
  bandGrey0: number;
  bandGrey2: number;
  bandGrey4: number;
  bandGrey6: number;
  bandGrey8: number;
  bandGrey10: number;
  bandDark0: number;
  bandDark2: number;
  bandDark4: number;
  bandDark6: number;
  bandDark8: number;
  bandDark10: number;
  /** Median grey of the outer quarter of the angular span over that of the central half, 3–10 cm deep: edge roll-off. */
  edgeRollOff: number;
}

export type SectorMetric = keyof SectorStats;

export const SECTOR_METRICS: readonly SectorMetric[] = [
  'greyP5',
  'greyP25',
  'greyP50',
  'greyP75',
  'greyP95',
  'darkFraction',
  'brightFraction',
  'localStd',
  'detrendedStd',
  'gradientP50',
  'gradientP95',
  'ridgeFraction',
  'radialCorr1',
  'radialCorr2',
  'radialCorr4',
  'radialCorr8',
  'tangentialCorr1',
  'tangentialCorr2',
  'tangentialCorr4',
  'tangentialCorr8',
  'bandGrey0',
  'bandGrey2',
  'bandGrey4',
  'bandGrey6',
  'bandGrey8',
  'bandGrey10',
  'bandDark0',
  'bandDark2',
  'bandDark4',
  'bandDark6',
  'bandDark8',
  'bandDark10',
  'edgeRollOff',
];

/** The sector of an apex-up image: its apex (px) and the lit wedge, filled row by row between the outermost lit pixels. */
export interface SectorGeometry {
  apexX: number;
  apexY: number;
  /** 1 inside the sector. */
  mask: Uint8Array;
  /** Deepest sector pixel from the apex, mm. */
  depthMm: number;
  pixels: number;
}

const DARK_GREY = 20;
const BRIGHT_GREY = 200;
const LOCAL_WINDOW_MM = 1.5;
const DETREND_RADIUS_MM = 4;
const BLUR_MM = 1;
const RIDGE_GREY = 120;
const RIDGE_CONTRAST = 40;
const RIDGE_LAG_MM = 1;
const CORR_LAGS_MM = [1, 2, 4, 8] as const;
const CORR_DEMEAN_MM = 3;
const BAND_MM = 20;
const BAND_MIN_PIXELS = 400;
const MARGIN_MM = 3;
const ROLL_OFF_DEPTH_MM: readonly [number, number] = [30, 100];

export function sectorGeometry(img: RegionImage): SectorGeometry {
  const { width: w, height: h, grey } = img;
  const mask = new Uint8Array(w * h);
  let apexY = -1,
    apexX = w / 2,
    pixels = 0,
    deepest = 0;
  for (let y = 0; y < h; y++) {
    let l = -1,
      r = -1;
    for (let x = 0; x < w; x++)
      if (grey[x + y * w]! > 0) {
        if (l < 0) l = x;
        r = x;
      }
    if (l < 0 || r - l < 2) continue;
    if (apexY < 0) {
      apexY = y;
      apexX = (l + r) / 2;
    }
    for (let x = l; x <= r; x++) {
      mask[x + y * w] = 1;
      pixels++;
    }
    deepest = y;
  }
  if (apexY < 0) apexY = 0;
  return { apexX, apexY, mask, depthMm: (deepest - apexY) * img.mmPerPx[1], pixels };
}

/** Bilinear grey at fractional pixel coordinates; NaN outside the sector or the image. */
function sampleAt(
  grey: Float32Array,
  mask: Uint8Array,
  w: number,
  h: number,
  x: number,
  y: number,
): number {
  const x0 = Math.floor(x),
    y0 = Math.floor(y);
  if (x0 < 0 || y0 < 0 || x0 + 1 >= w || y0 + 1 >= h) return NaN;
  const i = x0 + y0 * w;
  if (!mask[i] || !mask[i + 1] || !mask[i + w] || !mask[i + w + 1]) return NaN;
  const fx = x - x0,
    fy = y - y0;
  return (
    grey[i]! * (1 - fx) * (1 - fy) +
    grey[i + 1]! * fx * (1 - fy) +
    grey[i + w]! * (1 - fx) * fy +
    grey[i + w + 1]! * fx * fy
  );
}

/**
 * Mean of `values` over a box of ±rx × ±ry pixels restricted to the mask, per pixel; NaN where the box covers less than
 * half its area with sector pixels. Integral images make it O(w·h).
 */
function boxMean(
  values: Float32Array,
  mask: Uint8Array,
  w: number,
  h: number,
  rx: number,
  ry: number,
): Float32Array {
  const W = w + 1;
  const sum = new Float64Array(W * (h + 1));
  const cnt = new Int32Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let s = 0,
      c = 0;
    for (let x = 0; x < w; x++) {
      const i = x + y * w;
      if (mask[i]) {
        s += values[i]!;
        c++;
      }
      sum[x + 1 + (y + 1) * W] = sum[x + 1 + y * W]! + s;
      cnt[x + 1 + (y + 1) * W] = cnt[x + 1 + y * W]! + c;
    }
  }
  const out = new Float32Array(w * h).fill(NaN);
  const area = (2 * rx + 1) * (2 * ry + 1);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - ry),
      y1 = Math.min(h - 1, y + ry) + 1;
    for (let x = 0; x < w; x++) {
      if (!mask[x + y * w]) continue;
      const x0 = Math.max(0, x - rx),
        x1 = Math.min(w - 1, x + rx) + 1;
      const c = cnt[x1 + y1 * W]! - cnt[x0 + y1 * W]! - cnt[x1 + y0 * W]! + cnt[x0 + y0 * W]!;
      if (c * 2 < area) continue;
      const s = sum[x1 + y1 * W]! - sum[x0 + y1 * W]! - sum[x1 + y0 * W]! + sum[x0 + y0 * W]!;
      out[x + y * w] = s / c;
    }
  }
  return out;
}

/** Fraction of the ±rx × ±ry box around each pixel that lies inside the mask (boxes are clipped at the image edge). */
function maskCoverage(
  mask: Uint8Array,
  w: number,
  h: number,
  rx: number,
  ry: number,
): Float32Array {
  const W = w + 1;
  const cnt = new Int32Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let c = 0;
    for (let x = 0; x < w; x++) {
      if (mask[x + y * w]) c++;
      cnt[x + 1 + (y + 1) * W] = cnt[x + 1 + y * W]! + c;
    }
  }
  const out = new Float32Array(w * h);
  const area = (2 * rx + 1) * (2 * ry + 1);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - ry),
      y1 = Math.min(h - 1, y + ry) + 1;
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - rx),
        x1 = Math.min(w - 1, x + rx) + 1;
      out[x + y * w] =
        (cnt[x1 + y1 * W]! - cnt[x0 + y1 * W]! - cnt[x1 + y0 * W]! + cnt[x0 + y0 * W]!) / area;
    }
  }
  return out;
}

const quantile = (sorted: Float32Array | number[], q: number): number =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]! : NaN;

/** Whole-sector statistics of an apex-up image (a CAMUS frame or a scan-converted simulator frame). */
export function sectorStats(img: RegionImage): SectorStats {
  const { width: w, height: h, grey } = img;
  const [sx, sy] = img.mmPerPx;
  const geo = sectorGeometry(img);
  const { mask, apexX, apexY } = geo;
  // an interior mask keeps every measurement that looks around a pixel away from the sector edge
  const mx = Math.round(MARGIN_MM / sx),
    my = Math.round(MARGIN_MM / sy);
  const interior = new Uint8Array(w * h);
  {
    const cover = maskCoverage(mask, w, h, mx, my);
    for (let i = 0; i < w * h; i++) if (mask[i] && cover[i]! >= 0.999) interior[i] = 1;
  }
  // histogram of the lit sector
  const lit: number[] = [];
  for (let i = 0; i < w * h; i++) if (mask[i]) lit.push(grey[i]!);
  const sorted = Float32Array.from(lit).sort();
  const n = sorted.length;
  let dark = 0,
    bright = 0;
  for (let i = 0; i < n; i++) {
    if (sorted[i]! < DARK_GREY) dark++;
    if (sorted[i]! > BRIGHT_GREY) bright++;
  }
  // local std in 1.5 mm windows and std against the ±4 mm mean
  const lrx = Math.max(1, Math.round(LOCAL_WINDOW_MM / 2 / sx)),
    lry = Math.max(1, Math.round(LOCAL_WINDOW_MM / 2 / sy));
  const sq = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) sq[i] = grey[i]! * grey[i]!;
  const m1 = boxMean(grey, mask, w, h, lrx, lry);
  const m2 = boxMean(sq, mask, w, h, lrx, lry);
  const localStds: number[] = [];
  for (let i = 0; i < w * h; i++)
    if (interior[i] && Number.isFinite(m1[i]!))
      localStds.push(Math.sqrt(Math.max(0, m2[i]! - m1[i]! * m1[i]!)));
  const drx = Math.round(DETREND_RADIUS_MM / sx),
    dry = Math.round(DETREND_RADIUS_MM / sy);
  const trend = boxMean(grey, mask, w, h, drx, dry);
  let dsum = 0,
    dn = 0;
  for (let i = 0; i < w * h; i++)
    if (interior[i] && Number.isFinite(trend[i]!)) {
      const d = grey[i]! - trend[i]!;
      dsum += d * d;
      dn++;
    }
  // gradient after a 1 mm blur, and thin bright ridges
  const brx = Math.max(1, Math.round(BLUR_MM / 2 / sx)),
    bry = Math.max(1, Math.round(BLUR_MM / 2 / sy));
  const blur = boxMean(grey, mask, w, h, brx, bry);
  const grads: number[] = [];
  let ridges = 0,
    ridgeN = 0;
  const rlx = Math.max(1, Math.round(RIDGE_LAG_MM / sx)),
    rly = Math.max(1, Math.round(RIDGE_LAG_MM / sy));
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = x + y * w;
      if (!interior[i]) continue;
      const c = blur[i]!;
      const gx = (blur[i + 1]! - blur[i - 1]!) / (2 * sx),
        gy = (blur[i + w]! - blur[i - w]!) / (2 * sy);
      if (Number.isFinite(gx) && Number.isFinite(gy)) grads.push(Math.hypot(gx, gy));
      if (
        x - rlx < 0 ||
        x + rlx >= w ||
        y - rly < 0 ||
        y + rly >= h ||
        !interior[i - rlx] ||
        !interior[i + rlx] ||
        !interior[i - rly * w] ||
        !interior[i + rly * w]
      )
        continue;
      ridgeN++;
      if (
        c > RIDGE_GREY &&
        ((c - blur[i - rlx]! > RIDGE_CONTRAST && c - blur[i + rlx]! > RIDGE_CONTRAST) ||
          (c - blur[i - rly * w]! > RIDGE_CONTRAST && c - blur[i + rly * w]! > RIDGE_CONTRAST) ||
          (c - blur[i - rlx - rly * w]! > RIDGE_CONTRAST &&
            c - blur[i + rlx + rly * w]! > RIDGE_CONTRAST) ||
          (c - blur[i + rlx - rly * w]! > RIDGE_CONTRAST &&
            c - blur[i - rlx + rly * w]! > RIDGE_CONTRAST))
      )
        ridges++;
    }
  // directional correlation of the grey demeaned over ±3 mm, sampled on a 1 mm grid
  const crx = Math.round(CORR_DEMEAN_MM / sx),
    cry = Math.round(CORR_DEMEAN_MM / sy);
  const cmean = boxMean(grey, mask, w, h, crx, cry);
  const demeaned = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) demeaned[i] = mask[i] ? grey[i]! - cmean[i]! : NaN;
  const corr = { radial: [NaN, NaN, NaN, NaN], tangential: [NaN, NaN, NaN, NaN] };
  const stepX = Math.max(1, Math.round(1 / sx)),
    stepY = Math.max(1, Math.round(1 / sy));
  for (let k = 0; k < CORR_LAGS_MM.length; k++) {
    const lag = CORR_LAGS_MM[k]!;
    let spp = 0,
      spr = 0,
      srr = 0,
      spt = 0,
      stt = 0,
      spp2 = 0;
    for (let y = apexY + my; y < h; y += stepY)
      for (let x = mx; x < w - mx; x += stepX) {
        const i = x + y * w;
        if (!interior[i]) continue;
        const d0 = demeaned[i]!;
        if (!Number.isFinite(d0)) continue;
        // unit direction from the apex, in mm
        const dxmm = (x - apexX) * sx,
          dymm = (y - apexY) * sy;
        const L = Math.hypot(dxmm, dymm);
        if (L < lag) continue;
        const ux = dxmm / L,
          uy = dymm / L;
        const r = sampleAt(demeaned, mask, w, h, x + (ux * lag) / sx, y + (uy * lag) / sy);
        const t = sampleAt(demeaned, mask, w, h, x + (-uy * lag) / sx, y + (ux * lag) / sy);
        if (Number.isFinite(r)) {
          spp += d0 * d0;
          spr += d0 * r;
          srr += r * r;
        }
        if (Number.isFinite(t)) {
          spp2 += d0 * d0;
          spt += d0 * t;
          stt += t * t;
        }
      }
    corr.radial[k] = spr / Math.sqrt(spp * srr);
    corr.tangential[k] = spt / Math.sqrt(spp2 * stt);
  }
  // depth bands from the apex and the angular roll-off
  const bands: number[][] = [[], [], [], [], [], []];
  const bandDark = [0, 0, 0, 0, 0, 0];
  const centre: number[] = [],
    edge: number[] = [];
  for (let y = apexY; y < h; y++) {
    // the lit extent of the row, for the angular position of its pixels
    let l = -1,
      rgt = -1;
    for (let x = 0; x < w; x++)
      if (mask[x + y * w]) {
        if (l < 0) l = x;
        rgt = x;
      }
    for (let x = 0; x < w; x++) {
      const i = x + y * w;
      if (!mask[i]) continue;
      const dxmm = (x - apexX) * sx,
        dymm = (y - apexY) * sy;
      const depth = Math.hypot(dxmm, dymm);
      const b = Math.floor(depth / BAND_MM);
      if (b < bands.length) {
        bands[b]!.push(grey[i]!);
        if (grey[i]! < DARK_GREY) bandDark[b]!++;
      }
      if (depth >= ROLL_OFF_DEPTH_MM[0] && depth <= ROLL_OFF_DEPTH_MM[1]) {
        // angular position within the lit row: 0 at its left edge, 1 at its right edge
        const f = rgt > l ? (x - l) / (rgt - l) : 0.5;
        if (f < 0.125 || f > 0.875) edge.push(grey[i]!);
        else if (f >= 0.25 && f <= 0.75) centre.push(grey[i]!);
      }
    }
  }
  const bandGrey = bands.map((v) =>
    v.length >= BAND_MIN_PIXELS ? quantile(Float32Array.from(v).sort(), 0.5) : NaN,
  );
  const bandDarkFrac = bands.map((v, k) =>
    v.length >= BAND_MIN_PIXELS ? bandDark[k]! / v.length : NaN,
  );
  const med = (v: number[]): number => quantile(Float32Array.from(v).sort(), 0.5);
  const gsorted = Float32Array.from(grads).sort();
  return {
    greyP5: quantile(sorted, 0.05),
    greyP25: quantile(sorted, 0.25),
    greyP50: quantile(sorted, 0.5),
    greyP75: quantile(sorted, 0.75),
    greyP95: quantile(sorted, 0.95),
    darkFraction: dark / n,
    brightFraction: bright / n,
    localStd: med(localStds),
    detrendedStd: Math.sqrt(dsum / Math.max(1, dn)),
    gradientP50: quantile(gsorted, 0.5),
    gradientP95: quantile(gsorted, 0.95),
    ridgeFraction: ridgeN ? ridges / ridgeN : NaN,
    radialCorr1: corr.radial[0]!,
    radialCorr2: corr.radial[1]!,
    radialCorr4: corr.radial[2]!,
    radialCorr8: corr.radial[3]!,
    tangentialCorr1: corr.tangential[0]!,
    tangentialCorr2: corr.tangential[1]!,
    tangentialCorr4: corr.tangential[2]!,
    tangentialCorr8: corr.tangential[3]!,
    bandGrey0: bandGrey[0]!,
    bandGrey2: bandGrey[1]!,
    bandGrey4: bandGrey[2]!,
    bandGrey6: bandGrey[3]!,
    bandGrey8: bandGrey[4]!,
    bandGrey10: bandGrey[5]!,
    bandDark0: bandDarkFrac[0]!,
    bandDark2: bandDarkFrac[1]!,
    bandDark4: bandDarkFrac[2]!,
    bandDark6: bandDarkFrac[3]!,
    bandDark8: bandDarkFrac[4]!,
    bandDark10: bandDarkFrac[5]!,
    edgeRollOff: centre.length && edge.length ? med(edge) / Math.max(1, med(centre)) : NaN,
  };
}
