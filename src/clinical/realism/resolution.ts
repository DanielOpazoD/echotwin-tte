/**
 * Resolution and contrast figures of the phantom benchmarks (decision 343), as the ultrasound literature defines them so
 * they compare with Field II results: the width of a point target's envelope at a level under its peak (−6 dB, the
 * amplitude FWHM), the contrast of a cyst in dB, its contrast-to-noise ratio and the generalized CNR (Rodriguez-Molares
 * et al., IEEE TUFFC 2020), which does not depend on the grey map.
 */

/**
 * Width of a profile at `levelDb` under its peak (−6 dB = half amplitude), in the units of `spacing`, with the two
 * crossings interpolated linearly between samples. NaN when the profile does not fall under the level on both sides.
 */
export function widthAtLevel(profile: ArrayLike<number>, spacing: number, levelDb = -6): number {
  let peak = -Infinity,
    ip = -1;
  for (let i = 0; i < profile.length; i++)
    if (profile[i]! > peak) {
      peak = profile[i]!;
      ip = i;
    }
  if (ip < 0 || !(peak > 0)) return NaN;
  const level = peak * Math.pow(10, levelDb / 20);
  let left = NaN,
    right = NaN;
  for (let i = ip; i > 0; i--)
    if (profile[i - 1]! < level) {
      const a = profile[i - 1]!,
        b = profile[i]!;
      left = i - 1 + (level - a) / (b - a);
      break;
    }
  for (let i = ip; i < profile.length - 1; i++)
    if (profile[i + 1]! < level) {
      const a = profile[i]!,
        b = profile[i + 1]!;
      right = i + (a - level) / (a - b);
      break;
    }
  return (right - left) * spacing;
}

const mean = (v: ArrayLike<number>): number => {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i]!;
  return s / v.length;
};
const variance = (v: ArrayLike<number>): number => {
  const m = mean(v);
  let s = 0;
  for (let i = 0; i < v.length; i++) s += (v[i]! - m) ** 2;
  return s / v.length;
};

/** Cyst contrast (dB) of envelope samples: 20·log10(mean inside / mean outside). */
export function contrastDb(inside: ArrayLike<number>, outside: ArrayLike<number>): number {
  return 20 * Math.log10(mean(inside) / mean(outside));
}

/** Contrast-to-noise ratio |μₒ − μᵢ| / √(σₒ² + σᵢ²): for an anechoic cyst in Rayleigh speckle at most 1.91. */
export function cnr(inside: ArrayLike<number>, outside: ArrayLike<number>): number {
  return Math.abs(mean(outside) - mean(inside)) / Math.sqrt(variance(inside) + variance(outside));
}

/**
 * Generalized CNR: 1 − the overlap of the two normalized histograms (`bins` bins over the joint range). 1 when the
 * distributions do not overlap, 0 when they are the same; invariant to any monotonic grey map.
 */
export function gcnr(inside: ArrayLike<number>, outside: ArrayLike<number>, bins = 100): number {
  let lo = Infinity,
    hi = -Infinity;
  for (const v of [inside, outside])
    for (let i = 0; i < v.length; i++) {
      lo = Math.min(lo, v[i]!);
      hi = Math.max(hi, v[i]!);
    }
  if (!(hi > lo)) return 0;
  const hist = (v: ArrayLike<number>): Float64Array => {
    const h = new Float64Array(bins);
    for (let i = 0; i < v.length; i++)
      h[Math.min(bins - 1, Math.floor(((v[i]! - lo) / (hi - lo)) * bins))]! += 1 / v.length;
    return h;
  };
  const a = hist(inside),
    b = hist(outside);
  let overlap = 0;
  for (let i = 0; i < bins; i++) overlap += Math.min(a[i]!, b[i]!);
  return 1 - overlap;
}
