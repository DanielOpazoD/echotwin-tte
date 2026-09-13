/**
 * Region-by-region image statistics used to compare the simulator against clinical echocardiograms
 * (decision 69). The SAME code runs on a CAMUS image and on a scan-converted simulator frame, so any
 * difference in the numbers is a difference in the images, not in how they were measured.
 *
 * Labels follow the CAMUS convention: 0 background, 1 LV cavity (endocardium), 2 LV myocardium,
 * 3 left atrium. That convention is never taken on trust: identifyLabels() checks it from geometry alone —
 * without looking at intensity, which is what is being measured — and refuses to continue if it does not hold.
 */
export const LABEL = { background: 0, cavity: 1, myocardium: 2, atrium: 3 } as const;

export interface RegionImage {
  width: number;
  height: number;
  /** Displayed grey level, 0-255, row-major: index = x + y·width. */
  grey: Float32Array;
  labels: Uint8Array;
  /** Pixel size in mm along x (columns) and y (rows). */
  mmPerPx: [number, number];
}

export interface RegionSummary {
  n: number;
  mean: number;
  median: number;
  p10: number;
  p90: number;
  /** 16 bins over 0-255, as fractions of n. */
  histogram: number[];
}

export interface ImageStats {
  cavity: RegionSummary;
  myocardium: RegionSummary;
  atrium: RegionSummary;
  /** Myocardium minus LV cavity, in grey levels (medians). */
  tissueBloodContrast: number;
  /** Median grey std in 5×5 windows lying entirely inside the eroded myocardium. */
  myocardialLocalStd: number;
  /** Speckle cell: twice the lag (mm) at which the grey autocorrelation inside the myocardium falls to 0.5. */
  speckleCellMm: { horizontal: number; vertical: number };
}

/** Removes a band of `radius` pixels from the border of a region, so partial-volume edges do not bias the stats. */
export function erode(labels: Uint8Array, w: number, h: number, label: number, radius: number): Uint8Array {
  const out = new Uint8Array(labels.length);
  for (let y = radius; y < h - radius; y++)
    for (let x = radius; x < w - radius; x++) {
      let keep = true;
      for (let dy = -radius; dy <= radius && keep; dy++)
        for (let dx = -radius; dx <= radius; dx++)
          if (labels[x + dx + (y + dy) * w] !== label) {
            keep = false;
            break;
          }
      if (keep) out[x + y * w] = 1;
    }
  return out;
}

function summarise(values: number[]): RegionSummary {
  const n = values.length;
  if (n === 0) return { n: 0, mean: NaN, median: NaN, p10: NaN, p90: NaN, histogram: new Array(16).fill(0) };
  const s = [...values].sort((a, b) => a - b);
  const at = (q: number): number => s[Math.min(n - 1, Math.floor(q * n))]!;
  const histogram = new Array(16).fill(0);
  let sum = 0;
  for (const v of values) {
    sum += v;
    histogram[Math.min(15, Math.max(0, Math.floor(v / 16)))] += 1 / n;
  }
  return { n, mean: sum / n, median: at(0.5), p10: at(0.1), p90: at(0.9), histogram };
}

/**
 * Checks the label convention from geometry. The cavity is the region with the least contact with the
 * background, because the myocardium wraps it; the myocardium is the region sharing the longest border
 * with the cavity; the atrium is what remains. Throws if the file does not fit.
 */
export function identifyLabels(labels: Uint8Array, w: number, h: number): void {
  const contact = new Map<string, number>();
  const perimeter = [0, 0, 0, 0];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const a = labels[x + y * w]!;
      if (a === 0) continue;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = x + dx,
          ny = y + dy;
        const b = nx < 0 || ny < 0 || nx >= w || ny >= h ? 0 : labels[nx + ny * w]!;
        if (b === a) continue;
        perimeter[a] = perimeter[a]! + 1;
        const key = `${a}-${b}`;
        contact.set(key, (contact.get(key) ?? 0) + 1);
      }
    }
  const bgFraction = (l: number): number => (contact.get(`${l}-0`) ?? 0) / Math.max(1, perimeter[l]!);
  const cavity = [1, 2, 3].reduce((best, l) => (bgFraction(l) < bgFraction(best) ? l : best), 1);
  if (cavity !== LABEL.cavity) throw new Error(`labels: the region least exposed to background is ${cavity}, expected ${LABEL.cavity} for the LV cavity`);
  const withCavity = (l: number): number => contact.get(`${l}-${cavity}`) ?? 0;
  const myo = [2, 3].reduce((best, l) => (withCavity(l) > withCavity(best) ? l : best), 2);
  if (myo !== LABEL.myocardium) throw new Error(`labels: the region sharing the longest border with the cavity is ${myo}, expected ${LABEL.myocardium} for the myocardium`);
}

/**
 * Orients an apical image so that rows run away from the probe: in an apical view the left atrium lies
 * deeper than the LV cavity. Returns a new image (transposed and/or flipped) when needed. Geometry only.
 */
export function orientApical(img: RegionImage): RegionImage {
  const centroid = (label: number): [number, number] => {
    let sx = 0,
      sy = 0,
      n = 0;
    for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) if (img.labels[x + y * img.width] === label) { sx += x; sy += y; n++; }
    return [sx / Math.max(1, n), sy / Math.max(1, n)];
  };
  let out = img;
  const [cx, cy] = centroid(LABEL.cavity);
  const [ax, ay] = centroid(LABEL.atrium);
  if (Math.abs(ax - cx) > Math.abs(ay - cy)) {
    const grey = new Float32Array(img.grey.length),
      labels = new Uint8Array(img.labels.length);
    for (let y = 0; y < img.height; y++)
      for (let x = 0; x < img.width; x++) {
        grey[y + x * img.height] = img.grey[x + y * img.width]!;
        labels[y + x * img.height] = img.labels[x + y * img.width]!;
      }
    out = { width: img.height, height: img.width, grey, labels, mmPerPx: [img.mmPerPx[1], img.mmPerPx[0]] };
  }
  const [, cy2] = ((): [number, number] => {
    let sy = 0, n = 0;
    for (let y = 0; y < out.height; y++) for (let x = 0; x < out.width; x++) if (out.labels[x + y * out.width] === LABEL.cavity) { sy += y; n++; }
    return [0, sy / Math.max(1, n)];
  })();
  let say = 0, an = 0;
  for (let y = 0; y < out.height; y++) for (let x = 0; x < out.width; x++) if (out.labels[x + y * out.width] === LABEL.atrium) { say += y; an++; }
  if (say / Math.max(1, an) < cy2) {
    const grey = new Float32Array(out.grey.length),
      labels = new Uint8Array(out.labels.length);
    for (let y = 0; y < out.height; y++)
      for (let x = 0; x < out.width; x++) {
        grey[x + (out.height - 1 - y) * out.width] = out.grey[x + y * out.width]!;
        labels[x + (out.height - 1 - y) * out.width] = out.labels[x + y * out.width]!;
      }
    out = { ...out, grey, labels };
  }
  return out;
}

function cellMm(img: RegionImage, mask: Uint8Array, horizontal: boolean): number {
  const { width: w, height: h, grey } = img;
  const maxLag = 12;
  const acc = new Float64Array(maxLag + 1);
  const cnt = new Float64Array(maxLag + 1);
  const outer = horizontal ? h : w;
  const inner = horizontal ? w : h;
  for (let o = 0; o < outer; o++) {
    let run: number[] = [];
    const flush = (): void => {
      if (run.length >= 12) {
        const m = run.reduce((a, b) => a + b, 0) / run.length;
        const d = run.map((v) => v - m);
        const v0 = d.reduce((a, b) => a + b * b, 0) / d.length;
        if (v0 > 0)
          for (let lag = 0; lag <= maxLag && lag < d.length; lag++) {
            let s = 0;
            for (let k = 0; k + lag < d.length; k++) s += d[k]! * d[k + lag]!;
            acc[lag] = acc[lag]! + s / (d.length - lag) / v0;
            cnt[lag] = cnt[lag]! + 1;
          }
      }
      run = [];
    };
    for (let i = 0; i < inner; i++) {
      const idx = horizontal ? i + o * w : o + i * w;
      if (mask[idx]) run.push(grey[idx]!);
      else flush();
    }
    flush();
  }
  const acf = Array.from(acc, (a, i) => a / Math.max(1, cnt[i]!));
  for (let k = 1; k <= maxLag; k++)
    if (acf[k]! <= 0.5) {
      const lag = k - 1 + (acf[k - 1]! - 0.5) / Math.max(1e-9, acf[k - 1]! - acf[k]!);
      return 2 * lag * (horizontal ? img.mmPerPx[0] : img.mmPerPx[1]);
    }
  return NaN;
}

export function imageStats(img: RegionImage, erodePx = 2): ImageStats {
  const { width: w, height: h } = img;
  const masks = [LABEL.cavity, LABEL.myocardium, LABEL.atrium].map((l) => erode(img.labels, w, h, l, erodePx));
  const pick = (mask: Uint8Array): number[] => {
    const v: number[] = [];
    for (let i = 0; i < mask.length; i++) if (mask[i]) v.push(img.grey[i]!);
    return v;
  };
  const [cavity, myocardium, atrium] = masks.map((m) => summarise(pick(m))) as [RegionSummary, RegionSummary, RegionSummary];
  const myoMask = masks[1]!;
  const stds: number[] = [];
  for (let y = 2; y < h - 2; y += 3)
    for (let x = 2; x < w - 2; x += 3) {
      const vals: number[] = [];
      let inside = true;
      for (let dy = -2; dy <= 2 && inside; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const i = x + dx + (y + dy) * w;
          if (!myoMask[i]) {
            inside = false;
            break;
          }
          vals.push(img.grey[i]!);
        }
      if (!inside) continue;
      const m = vals.reduce((a, b) => a + b, 0) / vals.length;
      stds.push(Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / vals.length));
    }
  stds.sort((a, b) => a - b);
  return {
    cavity,
    myocardium,
    atrium,
    tissueBloodContrast: myocardium.median - cavity.median,
    myocardialLocalStd: stds.length ? stds[Math.floor(stds.length / 2)]! : NaN,
    speckleCellMm: { horizontal: cellMm(img, myoMask, true), vertical: cellMm(img, myoMask, false) },
  };
}
