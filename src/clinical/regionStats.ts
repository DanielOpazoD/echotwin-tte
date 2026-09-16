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
  /** Grey std inside the eroded myocardium after removing the ±4 mm local mean: speckle-scale texture contrast. */
  myocardialDetrendedStd: number;
  /** The same inside the eroded LV cavity: how granular the blood pool looks. */
  cavityDetrendedStd: number;
  /** Speckle cell: twice the lag (mm) at which the autocorrelation of detrended grey inside the myocardium falls to 0.5. */
  speckleCellMm: { horizontal: number; vertical: number };
  /**
   * Skewness of the detrended grey inside the myocardium (decision 90). Speckle shown on a grey scale linear in dB is
   * log-Rayleigh, with skewness −1.14: a tail of dark nulls. Grey maps that expand the bright end, and anything that
   * fills the nulls, move it up.
   */
  myocardialResidualSkew: number;
  /**
   * Slope of the 5×5 grey std against the 5×5 grey mean over windows inside the eroded cavity, myocardium and atrium, in
   * grey levels of std per 100 grey levels of mean, skipping windows darker than grey 16 that the black end clips
   * (decision 90). Speckle has the same std in dB at every echo level, so on a grey scale linear in dB the slope is zero;
   * a grey map that expands the bright end makes it positive, whatever the region.
   */
  levelStdSlope: number;
  /** 99th percentile of the grey of every non-black pixel: where the white end of the image sits (decision 90). */
  brightGreyP99: number;
}

/** Removes a band of `radius` pixels from the border of a region, so partial-volume edges do not bias the stats. */
export function erode(
  labels: Uint8Array,
  w: number,
  h: number,
  label: number,
  radius: number,
): Uint8Array {
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
  if (n === 0)
    return {
      n: 0,
      mean: NaN,
      median: NaN,
      p10: NaN,
      p90: NaN,
      histogram: new Array<number>(16).fill(0),
    };
  const s = [...values].sort((a, b) => a - b);
  const at = (q: number): number => s[Math.min(n - 1, Math.floor(q * n))]!;
  const histogram = new Array<number>(16).fill(0);
  let sum = 0;
  for (const v of values) {
    sum += v;
    const k = Math.min(15, Math.max(0, Math.floor(v / 16)));
    histogram[k] = (histogram[k] ?? 0) + 1 / n;
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
  const bgFraction = (l: number): number =>
    (contact.get(`${l}-0`) ?? 0) / Math.max(1, perimeter[l]!);
  const cavity = [1, 2, 3].reduce((best, l) => (bgFraction(l) < bgFraction(best) ? l : best), 1);
  if (cavity !== LABEL.cavity)
    throw new Error(
      `labels: the region least exposed to background is ${cavity}, expected ${LABEL.cavity} for the LV cavity`,
    );
  const withCavity = (l: number): number => contact.get(`${l}-${cavity}`) ?? 0;
  const myo = [2, 3].reduce((best, l) => (withCavity(l) > withCavity(best) ? l : best), 2);
  if (myo !== LABEL.myocardium)
    throw new Error(
      `labels: the region sharing the longest border with the cavity is ${myo}, expected ${LABEL.myocardium} for the myocardium`,
    );
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
    for (let y = 0; y < img.height; y++)
      for (let x = 0; x < img.width; x++)
        if (img.labels[x + y * img.width] === label) {
          sx += x;
          sy += y;
          n++;
        }
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
    out = {
      width: img.height,
      height: img.width,
      grey,
      labels,
      mmPerPx: [img.mmPerPx[1], img.mmPerPx[0]],
    };
  }
  const [, cy2] = ((): [number, number] => {
    let sy = 0,
      n = 0;
    for (let y = 0; y < out.height; y++)
      for (let x = 0; x < out.width; x++)
        if (out.labels[x + y * out.width] === LABEL.cavity) {
          sy += y;
          n++;
        }
    return [0, sy / Math.max(1, n)];
  })();
  let say = 0,
    an = 0;
  for (let y = 0; y < out.height; y++)
    for (let x = 0; x < out.width; x++)
      if (out.labels[x + y * out.width] === LABEL.atrium) {
        say += y;
        an++;
      }
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

/** Half-width (mm) of the local-mean window that speckle residuals are taken against. */
const DETREND_MM = 4;

/** Grey minus the mean of the same region within ±4 mm, for every pixel of the mask (0 elsewhere). */
function detrendedResiduals(img: RegionImage, mask: Uint8Array): Float32Array {
  const { width: w, height: h, grey } = img;
  const rx = Math.max(1, Math.round(DETREND_MM / img.mmPerPx[0]));
  const ry = Math.max(1, Math.round(DETREND_MM / img.mmPerPx[1]));
  const W1 = w + 1;
  const sumG = new Float64Array(W1 * (h + 1));
  const sumC = new Float64Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowG = 0,
      rowC = 0;
    for (let x = 0; x < w; x++) {
      const i = x + y * w;
      if (mask[i]) {
        rowG += grey[i]!;
        rowC++;
      }
      sumG[x + 1 + (y + 1) * W1] = sumG[x + 1 + y * W1]! + rowG;
      sumC[x + 1 + (y + 1) * W1] = sumC[x + 1 + y * W1]! + rowC;
    }
  }
  const box = (t: Float64Array, x0: number, y0: number, x1: number, y1: number): number =>
    t[x1 + y1 * W1]! - t[x0 + y1 * W1]! - t[x1 + y0 * W1]! + t[x0 + y0 * W1]!;
  const res = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = x + y * w;
      if (!mask[i]) continue;
      const x0 = Math.max(0, x - rx),
        x1 = Math.min(w, x + rx + 1),
        y0 = Math.max(0, y - ry),
        y1 = Math.min(h, y + ry + 1);
      res[i] = grey[i]! - box(sumG, x0, y0, x1, y1) / box(sumC, x0, y0, x1, y1);
    }
  return res;
}

/** Skewness of the residuals inside the mask. */
function residualSkew(res: Float32Array, mask: Uint8Array): number {
  let s = 0,
    n = 0;
  for (let i = 0; i < mask.length; i++)
    if (mask[i]) {
      s += res[i]!;
      n++;
    }
  if (n < 3) return NaN;
  const m = s / n;
  let s2 = 0,
    s3 = 0;
  for (let i = 0; i < mask.length; i++)
    if (mask[i]) {
      const d = res[i]! - m;
      s2 += d * d;
      s3 += d * d * d;
    }
  return s2 > 0 ? s3 / n / Math.pow(s2 / n, 1.5) : NaN;
}

/** Windows darker than this are skipped by levelStdSlope: the black end of the grey scale clips their spread. */
const LEVEL_SLOPE_MIN_GREY = 16;

/** Least-squares slope (per 100 grey levels) of the 5×5 grey std against the 5×5 grey mean over windows inside the mask (step 2 px). */
function levelStdSlope(img: RegionImage, mask: Uint8Array): number {
  const { width: w, height: h, grey } = img;
  let n = 0,
    sx = 0,
    sy = 0,
    sxx = 0,
    sxy = 0;
  for (let y = 2; y < h - 2; y += 2)
    for (let x = 2; x < w - 2; x += 2) {
      let inside = true,
        s = 0,
        s2 = 0;
      for (let dy = -2; dy <= 2 && inside; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const i = x + dx + (y + dy) * w;
          if (!mask[i]) {
            inside = false;
            break;
          }
          s += grey[i]!;
          s2 += grey[i]! * grey[i]!;
        }
      if (!inside) continue;
      const mean = s / 25;
      if (mean < LEVEL_SLOPE_MIN_GREY) continue;
      const sd = Math.sqrt(Math.max(0, s2 / 25 - mean * mean));
      n++;
      sx += mean;
      sy += sd;
      sxx += mean * mean;
      sxy += mean * sd;
    }
  const den = n * sxx - sx * sx;
  return n > 2 && den > 0 ? (100 * (n * sxy - sx * sy)) / den : NaN;
}

/** 99th percentile of the grey of the non-black pixels, from a histogram of whole grey levels. */
function brightGreyP99(grey: Float32Array): number {
  const hist = new Float64Array(256);
  let n = 0;
  for (let i = 0; i < grey.length; i++) {
    const v = grey[i]!;
    if (v > 0) {
      hist[Math.min(255, Math.floor(v))]! += 1;
      n++;
    }
  }
  let acc = 0;
  for (let g = 0; g < 256; g++) {
    acc += hist[g]!;
    if (acc >= 0.99 * n) return g;
  }
  return NaN;
}

/** Standard deviation of the detrended grey inside the mask: speckle-scale texture contrast, free of regional trends. */
function detrendedStd(res: Float32Array, mask: Uint8Array): number {
  let s = 0,
    s2 = 0,
    n = 0;
  for (let i = 0; i < mask.length; i++)
    if (mask[i]) {
      s += res[i]!;
      s2 += res[i]! * res[i]!;
      n++;
    }
  return n > 1 ? Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2)) : NaN;
}

/**
 * Speckle cell (mm): twice the lag at which the autocorrelation of grey residuals inside the region falls to 0.5.
 * Residuals are taken against the mean of the same region within ±4 mm (summed-area tables), and the correlation
 * pairs pixels across the whole mask. The first version subtracted the mean of every horizontal or vertical run
 * instead: across a wall only 8–9 mm wide that removes most of the correlation of a 2–3 mm cell, so the horizontal
 * cell read the wall thickness as much as the texture — on synthetic speckle a 3 mm PSF measured 1.62 mm in a 9 mm
 * wall and 2.05 mm in a 20 mm one (2.16 and 2.23 mm now), and 4 mm read 2.00 and 2.44 (2.92 and 2.87) (decision 74).
 */
function cellMm(
  img: RegionImage,
  mask: Uint8Array,
  res: Float32Array,
  horizontal: boolean,
): number {
  const { width: w, height: h } = img;
  const maxLag = 16;
  const acf: number[] = [];
  for (let lag = 0; lag <= maxLag; lag++) {
    let sum = 0,
      n = 0;
    const dx = horizontal ? lag : 0,
      dy = horizontal ? 0 : lag;
    for (let y = 0; y + dy < h; y++)
      for (let x = 0; x + dx < w; x++) {
        const i = x + y * w,
          j = x + dx + (y + dy) * w;
        if (!mask[i] || !mask[j]) continue;
        sum += res[i]! * res[j]!;
        n++;
      }
    acf.push(n > 0 ? sum / n : NaN);
  }
  if (!(acf[0]! > 0)) return NaN;
  for (let k = 1; k <= maxLag; k++) {
    const a = acf[k]! / acf[0]!,
      b = acf[k - 1]! / acf[0]!;
    if (a <= 0.5)
      return (
        2 *
        (k - 1 + (b - 0.5) / Math.max(1e-9, b - a)) *
        (horizontal ? img.mmPerPx[0] : img.mmPerPx[1])
      );
  }
  return NaN;
}

export function imageStats(img: RegionImage, erodePx = 2): ImageStats {
  const { width: w, height: h } = img;
  const masks = [LABEL.cavity, LABEL.myocardium, LABEL.atrium].map((l) =>
    erode(img.labels, w, h, l, erodePx),
  );
  const pick = (mask: Uint8Array): number[] => {
    const v: number[] = [];
    for (let i = 0; i < mask.length; i++) if (mask[i]) v.push(img.grey[i]!);
    return v;
  };
  const [cavity, myocardium, atrium] = masks.map((m) => summarise(pick(m))) as [
    RegionSummary,
    RegionSummary,
    RegionSummary,
  ];
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
  const residuals = detrendedResiduals(img, myoMask);
  const regions = new Uint8Array(w * h);
  for (let i = 0; i < regions.length; i++)
    regions[i] = masks[0]![i]! | masks[1]![i]! | masks[2]![i]!;
  return {
    cavity,
    myocardium,
    atrium,
    tissueBloodContrast: myocardium.median - cavity.median,
    myocardialLocalStd: stds.length ? stds[Math.floor(stds.length / 2)]! : NaN,
    myocardialDetrendedStd: detrendedStd(residuals, myoMask),
    cavityDetrendedStd: detrendedStd(detrendedResiduals(img, masks[0]!), masks[0]!),
    speckleCellMm: {
      horizontal: cellMm(img, myoMask, residuals, true),
      vertical: cellMm(img, myoMask, residuals, false),
    },
    myocardialResidualSkew: residualSkew(residuals, myoMask),
    levelStdSlope: levelStdSlope(img, regions),
    brightGreyP99: brightGreyP99(img.grey),
  };
}
