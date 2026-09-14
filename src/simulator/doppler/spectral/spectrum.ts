import { aliasVelocity } from '@/clinical/formulas';
import { hash3 } from '@/core/random';

/**
 * Spectral Doppler column generation (spec 62): velocity distribution → histogram over the
 * displayed velocity range, with intrinsic spectral broadening, turbulence broadening, wall
 * filter, aliasing wrap, gain and noise. Deterministic per column index.
 */
export interface SpectralSettings {
  scaleMps: number; // ±Nyquist (before baseline shift)
  baselineShiftMps: number; // positive shifts the baseline down (more room for positive velocities)
  wallFilterMps: number;
  gainDb: number;
  sweepSpeedMmPerS: number; // 25 / 50 / 100
  gateLengthCm: number; // PW only
  invert: boolean;
  audioOn: boolean;
  volume: number;
}

export const DEFAULT_SPECTRAL: SpectralSettings = {
  scaleMps: 1.0,
  baselineShiftMps: 0,
  wallFilterMps: 0.08,
  gainDb: 0,
  sweepSpeedMmPerS: 50,
  gateLengthCm: 0.4,
  invert: false,
  audioOn: false,
  volume: 0.5,
};

export const SPECTRAL_BINS = 128;

/** Velocity range shown: [vMin, vMax] given scale and baseline shift. */
export function spectralRange(s: SpectralSettings): { vMin: number; vMax: number } {
  const lo = -s.scaleMps + s.baselineShiftMps;
  const hi = s.scaleMps + s.baselineShiftMps;
  return { vMin: lo, vMax: hi };
}

export interface VelocitySample {
  v: number; // axial velocity m/s (positive = toward the transducer)
  weight: number;
  dispersion: number;
}

/**
 * Raw spectral distribution of one column (SPECTRAL_BINS values, index 0 = vMax at top) before gain and compression.
 * Each sample adds a Gaussian of intrinsic plus turbulent broadening (decision 87):
 * - PW (`aliasing`): centred on the aliased velocity and summed around the displayed span, so the part of the distribution
 *   that crosses Nyquist reappears at the other end. It used to fold only the centre and cut the Gaussian at the screen
 *   edge, so energy near Nyquist was lost.
 * - CW: centred on the true velocity, and only the part inside the displayed range is drawn. The velocity used to be
 *   clamped to the range first, so an out-of-range jet stacked at the edge and a wider scale did not move it back.
 */
export function accumulateSpectrum(samples: readonly VelocitySample[], s: SpectralSettings, aliasing: boolean, out: Float32Array): void {
  const { vMin, vMax } = spectralRange(s);
  const span = vMax - vMin;
  out.fill(0);
  const intrinsic = 0.035 * s.scaleMps + 0.02; // intrinsic spectral broadening (m/s)
  for (const smp of samples) {
    if (smp.weight <= 0) continue;
    if (Math.abs(smp.v) < s.wallFilterMps) continue; // wall filter on true velocity
    let v = s.invert ? -smp.v : smp.v;
    if (aliasing) v = aliasVelocity(v, s.scaleMps, s.baselineShiftMps);
    const sigma = intrinsic + smp.dispersion * Math.abs(smp.v) * 0.9;
    const centerBin = ((vMax - v) / span) * SPECTRAL_BINS;
    const sigmaBins = Math.max(0.6, (sigma / span) * SPECTRAL_BINS);
    let lo = Math.floor(centerBin - 3 * sigmaBins);
    let hi = Math.ceil(centerBin + 3 * sigmaBins);
    if (!aliasing) {
      lo = Math.max(0, lo);
      hi = Math.min(SPECTRAL_BINS - 1, hi);
    }
    for (let b = lo; b <= hi; b++) {
      const d = (b + 0.5 - centerBin) / sigmaBins;
      const k = aliasing ? ((b % SPECTRAL_BINS) + SPECTRAL_BINS) % SPECTRAL_BINS : b;
      out[k] = (out[k] ?? 0) + smp.weight * Math.exp(-0.5 * d * d);
    }
  }
}

/**
 * Build one spectral column (SPECTRAL_BINS values 0..1, index 0 = vMax at top) from samples.
 * `aliasing=false` for CW (Nyquist far above the range → velocities beyond the display leave it).
 */
export function buildSpectralColumn(samples: readonly VelocitySample[], s: SpectralSettings, columnIndex: number, seed: number, aliasing: boolean, out: Float32Array): void {
  accumulateSpectrum(samples, s, aliasing, out);
  const gainLin = Math.pow(10, s.gainDb / 20);
  // normalise softly, apply gain + noise floor + compression
  let max = 0;
  for (let b = 0; b < SPECTRAL_BINS; b++) max = Math.max(max, out[b] ?? 0);
  const norm = max > 0 ? 1 / (max * 0.8 + 0.2) : 0;
  for (let b = 0; b < SPECTRAL_BINS; b++) {
    const noise = 0.05 * hash3(b, columnIndex, 3, seed);
    const y = ((out[b] ?? 0) * norm + noise) * gainLin;
    out[b] = Math.min(1, Math.pow(Math.max(0, y), 0.7));
  }
}

/** Column time step (s) and columns per second for the strip width given the sweep speed. */
export function columnsPerSecond(sweepMmPerS: number, stripWidthPx: number, stripWidthMm: number): number {
  // strip physical width in mm at the given sweep speed → seconds shown = stripWidthMm / sweep
  const seconds = stripWidthMm / sweepMmPerS;
  return stripWidthPx / seconds;
}
