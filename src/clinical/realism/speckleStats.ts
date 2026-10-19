/**
 * Speckle statistics of the realism bench (decision 343), the same code on the simulator and on clinical images.
 *
 * - On a linear envelope (the simulator before its console, a phantom): the point SNR mean/std, 1.91 for fully developed
 *   speckle (Rayleigh amplitude; Burckhardt 1978, Wagner et al. 1983).
 * - On a log-compressed grey (what a clinical file holds, CAMUS): the shape of the distribution of log-amplitude, which a
 *   linear grey map (grey = a·dB + b) does not change. Its skewness fits a Nakagami-m amplitude (intensity Gamma(m):
 *   m = 1 Rayleigh, m < 1 pre-Rayleigh as a K amplitude with few scatterers per cell, m > 1 smoother than speckle:
 *   compounding, filtering, a coherent part), and its kurtosis checks the fit. With m known, the std of the grey gives the
 *   dynamic range the file would have been compressed with.
 * - The K shape α needs a linear envelope (intensity moments): the simulator's, not a clinical file's. The log-skewness
 *   of a K amplitude is not monotonic in α (−1.14 at α → ∞, −0.81 at α = 1, −2 as α → 0), so it cannot be read back
 *   from a log-compressed image.
 *
 * Cumulants of ln I for a Gamma(m) intensity: κ₂ = ψ₁(m), κ₃ = ψ₂(m), κ₄ = ψ₃(m); ln A = ½ ln I has the same
 * standardized moments.
 */

export interface Moments {
  n: number;
  mean: number;
  std: number;
  skewness: number;
  /** Fourth standardized moment minus 3. */
  excessKurtosis: number;
}

/** Sample moments of the finite values. */
export function moments(values: ArrayLike<number>): Moments {
  let n = 0,
    s = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (!Number.isFinite(v)) continue;
    n++;
    s += v;
  }
  if (n < 2) return { n, mean: NaN, std: NaN, skewness: NaN, excessKurtosis: NaN };
  const mean = s / n;
  let m2 = 0,
    m3 = 0,
    m4 = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (!Number.isFinite(v)) continue;
    const d = v - mean;
    const d2 = d * d;
    m2 += d2;
    m3 += d2 * d;
    m4 += d2 * d2;
  }
  m2 /= n;
  m3 /= n;
  m4 /= n;
  return {
    n,
    mean,
    std: Math.sqrt(m2),
    skewness: m2 > 0 ? m3 / Math.pow(m2, 1.5) : NaN,
    excessKurtosis: m2 > 0 ? m4 / (m2 * m2) - 3 : NaN,
  };
}

/** Point SNR of a linear envelope: mean / std. 1.91 for Rayleigh amplitude. */
export function envelopeSnr(values: ArrayLike<number>): number {
  const m = moments(values);
  return m.mean / m.std;
}

/** Moments of the natural log of the positive values (zeros and negatives are left out). */
export function logMoments(values: ArrayLike<number>): Moments {
  const logs = new Float64Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    logs[i] = v > 0 ? Math.log(v) : NaN;
  }
  return moments(logs);
}

/** Rayleigh envelope SNR, √(π/(4−π)) (Burckhardt 1978). */
export const RAYLEIGH_SNR = Math.sqrt(Math.PI / (4 - Math.PI));

/** Polygamma ψ⁽ⁿ⁾(x) for n = 1, 2, 3 and x > 0: recurrence up to x ≥ 8, then the asymptotic series. */
export function polygamma(order: 1 | 2 | 3, x: number): number {
  if (!(x > 0)) return NaN;
  let acc = 0;
  // ψ⁽ⁿ⁾(x) = ψ⁽ⁿ⁾(x+1) + (−1)ⁿ⁺¹ n! / xⁿ⁺¹
  const fact = order === 1 ? 1 : order === 2 ? 2 : 6;
  const sign = order % 2 === 1 ? 1 : -1;
  while (x < 8) {
    acc += (sign * fact) / Math.pow(x, order + 1);
    x += 1;
  }
  const x2 = 1 / (x * x);
  let tail: number;
  if (order === 1)
    // 1/x + 1/(2x²) + Σ B₂ₖ / x²ᵏ⁺¹
    tail = 1 / x + x2 / 2 + (1 / x) * x2 * (1 / 6 - x2 * (1 / 30 - x2 * (1 / 42 - x2 * (1 / 30))));
  else if (order === 2)
    // −1/x² − 1/x³ − Σ (2k+1) B₂ₖ / x²ᵏ⁺²
    tail = -x2 - x2 / x - x2 * x2 * (1 / 2 - x2 * (1 / 6 - x2 * (1 / 6 - x2 * (3 / 10))));
  else
    // 2/x³ + 3/x⁴ + Σ (2k+1)(2k+2) B₂ₖ / x²ᵏ⁺³
    tail = (2 * x2) / x + 3 * x2 * x2 + ((x2 * x2) / x) * (2 - x2 * (1 - x2 * (4 / 3 - x2 * 3)));
  return acc + tail;
}

/** Skewness of ln A for a Nakagami-m amplitude (Gamma(m) intensity): ψ₂(m) / ψ₁(m)^1.5. −1.1395 at m = 1 (Rayleigh). */
export function nakagamiLogSkew(m: number): number {
  return polygamma(2, m) / Math.pow(polygamma(1, m), 1.5);
}

/** Excess kurtosis of ln A for a Nakagami-m amplitude: ψ₃(m) / ψ₁(m)²; 2.40 at m = 1. A check of the m fitted from the skewness. */
export function nakagamiLogExcessKurtosis(m: number): number {
  return polygamma(3, m) / polygamma(1, m) ** 2;
}

/** The Rayleigh value of the log-amplitude skewness. */
export const RAYLEIGH_LOG_SKEW = nakagamiLogSkew(1);

/** Bisection on log(x) for a decreasing-in-|skew| map f over [lo, hi]; NaN when the target lies outside f's range. */
function invert(f: (x: number) => number, target: number, lo: number, hi: number): number {
  let a = Math.log(lo),
    b = Math.log(hi);
  const fa = f(lo),
    fb = f(hi);
  if (!Number.isFinite(target) || (target - fa) * (target - fb) > 0) return NaN;
  for (let i = 0; i < 80; i++) {
    const mid = (a + b) / 2;
    const fm = f(Math.exp(mid));
    if ((fm - target) * (fa - target) > 0) a = mid;
    else b = mid;
  }
  return Math.exp((a + b) / 2);
}

/**
 * Nakagami m from the skewness of the log-amplitude (or of a grey linear in dB), over m ∈ [0.05, 400]. Skewness rises
 * from about −2 (m → 0) to 0 (m → ∞); NaN outside that range (a positive skew is not log-compressed speckle).
 */
export function nakagamiMFromLogSkew(skew: number): number {
  return invert(nakagamiLogSkew, skew, 0.05, 400);
}

/**
 * K shape α of a linear envelope from its intensity moments: E[I²]/E[I]² = 2(1 + 1/α) for a K amplitude (Jakeman 1980),
 * 2 for Rayleigh (α → ∞). Infinity when the ratio is at or under 2 (as regular as Rayleigh or more). It needs linear
 * data: a log-compressed clinical file has lost the scale it would be read on.
 */
export function kAlphaFromEnvelope(envelope: ArrayLike<number>): number {
  let s1 = 0,
    s2 = 0,
    n = 0;
  for (let i = 0; i < envelope.length; i++) {
    const a = envelope[i]!;
    if (!Number.isFinite(a)) continue;
    const I = a * a;
    s1 += I;
    s2 += I * I;
    n++;
  }
  const ratio = s2 / n / (s1 / n) ** 2;
  return ratio > 2 ? 2 / (ratio - 2) : Infinity;
}

/** Decibels per neper of amplitude: 20 / ln 10. */
const DB_PER_NP = 20 / Math.LN10;

/**
 * Dynamic range (dB) over `greyLevels` grey levels that turns Nakagami-m speckle into the measured grey std, for a grey
 * linear in dB: std(grey) = (greyLevels / DR) · (20/ln10) · ½ √ψ₁(m).
 */
export function impliedDynamicRangeDb(greyStd: number, m: number, greyLevels = 255): number {
  return (greyLevels * DB_PER_NP * 0.5 * Math.sqrt(polygamma(1, m))) / greyStd;
}

/** Std (dB) of 20·log10 of a Rayleigh amplitude: 5.57 dB. */
export const RAYLEIGH_LOG_STD_DB = DB_PER_NP * 0.5 * Math.sqrt(polygamma(1, 1));

/**
 * Normalized cross-correlation of two equal-length samples (Pearson). The frame-to-frame decorrelation of the bench is 1
 * minus this on the same tissue after motion compensation.
 */
export function pearson(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  let sa = 0,
    sb = 0;
  for (let i = 0; i < n; i++) {
    sa += a[i]!;
    sb += b[i]!;
  }
  const ma = sa / n,
    mb = sb / n;
  let ab = 0,
    aa = 0,
    bb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i]! - ma,
      y = b[i]! - mb;
    ab += x * y;
    aa += x * x;
    bb += y * y;
  }
  return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : NaN;
}

export interface Quantiles {
  n: number;
  p10: number;
  p25: number;
  median: number;
  p75: number;
  p90: number;
  mean: number;
}

/** Quantiles of the finite values (nearest rank), as the clinical comparison prints them. */
export function quantiles(values: readonly number[]): Quantiles {
  const s = values.filter(Number.isFinite).sort((a, b) => a - b);
  const at = (q: number): number =>
    s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))]! : NaN;
  const mean = s.length ? s.reduce((a, b) => a + b, 0) / s.length : NaN;
  return {
    n: s.length,
    p10: at(0.1),
    p25: at(0.25),
    median: at(0.5),
    p75: at(0.75),
    p90: at(0.9),
    mean,
  };
}

/**
 * Where a value sits in a reference distribution, in interquartile widths from its median (0 inside the median, ±1 one
 * IQR off), the yardstick of the clinical comparison (decision 70).
 */
export function iqrDistance(value: number, ref: Pick<Quantiles, 'p25' | 'median' | 'p75'>): number {
  const iqr = ref.p75 - ref.p25;
  return iqr > 0 ? (value - ref.median) / iqr : NaN;
}

/** Window of the bench's windowed envelope SNR: 5 lines × 7 samples (about 2 × 3.5 mm at 9 cm on the high tier). */
export const SNR_WINDOW = { lines: 5, samples: 7 };

/**
 * Median over windows of the local envelope SNR (mean/std), on a polar grid (lines × samples, index li·samples + si):
 * windows of `wl` lines × `ws` samples, stepped by their size, that lie entirely inside `mask`. A region whose echo level
 * changes slowly (a myocardial wall: fibre angle, depth) reads its speckle here instead of its level changes; the same
 * estimator on uniform speckle gives the yardstick, because a small window biases the SNR it reads.
 */
export function windowedSnr(
  values: ArrayLike<number>,
  mask: (i: number) => boolean,
  lines: number,
  samples: number,
  wl: number,
  ws: number,
): { median: number; windows: number } {
  const snrs: number[] = [];
  for (let l0 = 0; l0 + wl <= lines; l0 += wl)
    for (let s0 = 0; s0 + ws <= samples; s0 += ws) {
      const v: number[] = [];
      let inside = true;
      for (let l = l0; l < l0 + wl && inside; l++)
        for (let s = s0; s < s0 + ws; s++) {
          const i = l * samples + s;
          if (!mask(i)) {
            inside = false;
            break;
          }
          v.push(values[i]!);
        }
      if (inside) snrs.push(envelopeSnr(v));
    }
  snrs.sort((a, b) => a - b);
  return { median: snrs.length ? snrs[Math.floor(snrs.length / 2)]! : NaN, windows: snrs.length };
}
