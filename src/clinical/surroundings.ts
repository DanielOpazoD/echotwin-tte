import { erode, LABEL, type RegionImage } from './regionStats';

/**
 * What an apical image shows AROUND the left ventricle (decision 144). The grey statistics of decision 69 cover the LV
 * cavity, the myocardium and the left atrium — the regions CAMUS labels — and a simulator image can match every one of
 * them while its surroundings give it away: a uniform grey mediastinum where a clinical image shows dark right
 * ventricle, bright pericardium and reverberating lung. The same code runs on a CAMUS image and on the simulator's
 * apical image, both apex up (`orientApical`), on the CAMUS labels only.
 *
 * Sides: in a four-chamber image side 1 is the septum and side 2 the lateral wall — the septal side is the one whose
 * band 3–9 mm outside the wall is darker at mid-cavity height (right-ventricular blood), as in `apicalGeometry` — and
 * in a two-chamber image side 1 is image left (the inferior wall in the CAMUS convention) and side 2 image right.
 */
export interface Surroundings {
  /** Median grey of lit background beyond 8 mm from any labelled pixel, from the cavity apex to the atrial floor. */
  farBackgroundGrey: number;
  /** 99th percentile of that far background: how bright the surroundings get (pericardium, pleura). */
  farBackgroundP99: number;
  /** Median grey of lit pixels within 15 mm of the sector apex: chest wall and ring-down. */
  nearFieldGrey: number;
  /** Median grey 3–9 mm outside each wall over mid-cavity rows. */
  side1BandGrey: number;
  side2BandGrey: number;
  /** Per mid-cavity row the brightest pixel 0–4 mm outside the epicardium; median over rows (the pericardial line). */
  side1EpicardialPeakGrey: number;
  side2EpicardialPeakGrey: number;
  /**
   * Grey across each wall at mid-cavity rows, endocardium → epicardium in five equal bins (median over rows): the
   * shape of the wall, whether a textured band or two bright edges around a dark core.
   */
  side1Transmural: number[];
  side2Transmural: number[];
  /** Endocardial and epicardial bins over the middle bin, per side: 1 is a flat wall. */
  side1EndoOverMid: number;
  side1EpiOverMid: number;
  side2EndoOverMid: number;
  side2EpiOverMid: number;
}

export type SurroundingsMetric = {
  [K in keyof Surroundings]: Surroundings[K] extends number ? K : never;
}[keyof Surroundings];

const median = (v: number[]): number => {
  if (!v.length) return NaN;
  const s = [...v].sort((a, b) => a - b);
  return s[s.length >> 1]!;
};
const percentile = (v: number[], q: number): number => {
  if (!v.length) return NaN;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
};

const NAN: Surroundings = {
  farBackgroundGrey: NaN,
  farBackgroundP99: NaN,
  nearFieldGrey: NaN,
  side1BandGrey: NaN,
  side2BandGrey: NaN,
  side1EpicardialPeakGrey: NaN,
  side2EpicardialPeakGrey: NaN,
  side1Transmural: [NaN, NaN, NaN, NaN, NaN],
  side2Transmural: [NaN, NaN, NaN, NaN, NaN],
  side1EndoOverMid: NaN,
  side1EpiOverMid: NaN,
  side2EndoOverMid: NaN,
  side2EpiOverMid: NaN,
};

/** Lit pixels (grey > 0) farther than `radiusPx` (box distance) from any labelled pixel. */
function farFromLabels(img: RegionImage, radiusPx: number): Uint8Array {
  const { width: w, height: h, labels } = img;
  // horizontal dilation of the labelled mask by prefix sums, then vertical
  const rowHit = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const pre = new Int32Array(w + 1);
    for (let x = 0; x < w; x++) pre[x + 1] = pre[x]! + (labels[x + y * w] ? 1 : 0);
    for (let x = 0; x < w; x++) {
      const a = Math.max(0, x - radiusPx),
        b = Math.min(w, x + radiusPx + 1);
      rowHit[x + y * w] = pre[b]! - pre[a]! > 0 ? 1 : 0;
    }
  }
  const far = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) {
    const pre = new Int32Array(h + 1);
    for (let y = 0; y < h; y++) pre[y + 1] = pre[y]! + rowHit[x + y * w]!;
    for (let y = 0; y < h; y++) {
      const a = Math.max(0, y - radiusPx),
        b = Math.min(h, y + radiusPx + 1);
      far[x + y * w] = pre[b]! - pre[a]! === 0 && img.grey[x + y * w]! > 0 ? 1 : 0;
    }
  }
  return far;
}

export function surroundings(img: RegionImage, view: '4CH' | '2CH'): Surroundings {
  const { width: w, height: h, grey, labels } = img;
  const mm = img.mmPerPx[0];
  // sector apex: centre of the topmost lit row
  let vy = -1;
  for (let y = 0; y < h && vy < 0; y++) {
    let n = 0;
    for (let x = 0; x < w; x++) if (grey[x + y * w]! > 0) n++;
    if (n >= 3) vy = y;
  }
  const rows: { y: number; left: number; right: number }[] = [];
  let atriumBottom = -1;
  for (let y = 0; y < h; y++) {
    let l = -1,
      r = -1;
    for (let x = 0; x < w; x++) {
      const lb = labels[x + y * w];
      if (lb === LABEL.cavity) {
        if (l < 0) l = x;
        r = x;
      } else if (lb === LABEL.atrium) atriumBottom = y;
    }
    if (l >= 0) rows.push({ y, left: l, right: r });
  }
  if (vy < 0 || rows.length < 10) return NAN;
  const top = rows[0]!,
    bottom = rows[rows.length - 1]!;
  const mid = rows.filter(
    (r) => r.y >= top.y + 0.3 * (bottom.y - top.y) && r.y <= top.y + 0.7 * (bottom.y - top.y),
  );
  if (mid.length < 5) return NAN;
  // each wall over mid-cavity rows: endocardial edge (last cavity pixel) and outer edge of the myocardium
  const walls = mid.map((r) => {
    let lo = r.left - 1;
    while (lo > 0 && labels[lo + r.y * w] === LABEL.myocardium) lo--;
    let ro = r.right + 1;
    while (ro < w - 1 && labels[ro + r.y * w] === LABEL.myocardium) ro++;
    return { y: r.y, endoL: r.left - 1, endoR: r.right + 1, lo, ro };
  });
  const band = (side: -1 | 1): number => {
    const v: number[] = [];
    for (const wl of walls) {
      const edge = side < 0 ? wl.lo : wl.ro;
      for (let k = Math.round(3 / mm); k <= Math.round(9 / mm); k++) {
        const x = edge + side * k;
        if (x < 0 || x >= w || labels[x + wl.y * w] !== LABEL.background) break;
        if (grey[x + wl.y * w]! > 0) v.push(grey[x + wl.y * w]!);
      }
    }
    return median(v);
  };
  const epiPeak = (side: -1 | 1): number => {
    const v: number[] = [];
    for (const wl of walls) {
      const edge = side < 0 ? wl.lo : wl.ro;
      let best = -1;
      for (let k = 0; k <= Math.round(4 / mm); k++) {
        const x = edge + side * k;
        if (x < 0 || x >= w || labels[x + wl.y * w] !== LABEL.background) break;
        best = Math.max(best, grey[x + wl.y * w]!);
      }
      if (best >= 0) v.push(best);
    }
    return median(v);
  };
  const myo = erode(labels, w, h, LABEL.myocardium, 1);
  const transmural = (side: -1 | 1): number[] => {
    const bins: number[][] = [[], [], [], [], []];
    for (const wl of walls) {
      const endo = side < 0 ? wl.endoL : wl.endoR;
      const epi = side < 0 ? wl.lo + 1 : wl.ro - 1;
      const n = Math.abs(epi - endo) + 1;
      if (n < 5) continue;
      for (let k = 0; k < 5; k++) {
        const x = endo + side * Math.round(((k + 0.5) / 5) * (n - 1));
        if (labels[x + wl.y * w] === LABEL.myocardium && (k === 0 || k === 4 || myo[x + wl.y * w]))
          bins[k]!.push(grey[x + wl.y * w]!);
      }
    }
    return bins.map(median);
  };
  // side 1 = septum (the darker band) in a four-chamber image, image left in a two-chamber image
  const bandL = band(-1),
    bandR = band(1);
  const s1: -1 | 1 = view === '4CH' && bandR < bandL ? 1 : -1;
  const s2: -1 | 1 = s1 < 0 ? 1 : -1;
  const far = farFromLabels(img, Math.round(8 / mm));
  const farV: number[] = [];
  const yEnd = Math.max(atriumBottom, bottom.y);
  for (let y = top.y; y <= yEnd; y++)
    for (let x = 0; x < w; x++) if (far[x + y * w]) farV.push(grey[x + y * w]!);
  const nearV: number[] = [];
  const nearRows = Math.round(15 / img.mmPerPx[1]);
  for (let y = vy; y < Math.min(h, vy + nearRows); y++)
    for (let x = 0; x < w; x++) if (grey[x + y * w]! > 0) nearV.push(grey[x + y * w]!);
  const t1 = transmural(s1),
    t2 = transmural(s2);
  return {
    farBackgroundGrey: median(farV),
    farBackgroundP99: percentile(farV, 0.99),
    nearFieldGrey: median(nearV),
    side1BandGrey: s1 < 0 ? bandL : bandR,
    side2BandGrey: s2 < 0 ? bandL : bandR,
    side1EpicardialPeakGrey: epiPeak(s1),
    side2EpicardialPeakGrey: epiPeak(s2),
    side1Transmural: t1,
    side2Transmural: t2,
    side1EndoOverMid: t1[0]! / t1[2]!,
    side1EpiOverMid: t1[4]! / t1[2]!,
    side2EndoOverMid: t2[0]! / t2[2]!,
    side2EpiOverMid: t2[4]! / t2[2]!,
  };
}
