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
 * Build one spectral column (SPECTRAL_BINS values 0..1, index 0 = vMax at top) from samples.
 * `aliasing=false` for CW (Nyquist far above the range → velocities beyond the display clip).
 */
export function buildSpectralColumn(samples: readonly VelocitySample[], s: SpectralSettings, columnIndex: number, seed: number, aliasing: boolean, out: Float32Array): void {
  const { vMin, vMax } = spectralRange(s);
  const span = vMax - vMin;
  out.fill(0);
  const gainLin = Math.pow(10, s.gainDb / 20);
  const intrinsic = 0.035 * s.scaleMps + 0.02; // intrinsic spectral broadening (m/s)
  for (const smp of samples) {
    if (smp.weight <= 0) continue;
    let v = s.invert ? -smp.v : smp.v;
    if (aliasing) v = aliasVelocity(v, s.scaleMps, s.baselineShiftMps);
    else v = Math.max(vMin, Math.min(vMax, v));
    if (Math.abs(smp.v) < s.wallFilterMps) continue; // wall filter on true velocity
    const sigma = intrinsic + smp.dispersion * Math.abs(smp.v) * 0.9;
    const centerBin = ((vMax - v) / span) * SPECTRAL_BINS;
    const sigmaBins = Math.max(0.6, (sigma / span) * SPECTRAL_BINS);
    const lo = Math.max(0, Math.floor(centerBin - 3 * sigmaBins));
    const hi = Math.min(SPECTRAL_BINS - 1, Math.ceil(centerBin + 3 * sigmaBins));
    for (let b = lo; b <= hi; b++) {
      const d = (b + 0.5 - centerBin) / sigmaBins;
      out[b] = (out[b] ?? 0) + smp.weight * Math.exp(-0.5 * d * d);
    }
  }
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
