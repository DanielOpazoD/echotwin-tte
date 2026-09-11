import type { PolarFrameSpec } from '../types';

/**
 * Point spread function and envelope detection (acoustic image formation, decision 52).
 *
 * The scene samplers (CPU tracer and WebGL2 port) produce, per polar sample, a complex signal: tissue
 * backscatter σ times a complex scatterer phasor anchored in tissue coordinates (incoherent), plus the
 * coherent specular amplitude, all multiplied by the two-way transmission. The system response is a
 * separable PSF applied to that complex signal — the axial pulse envelope along samples and the two-way
 * lateral beam profile across lines, whose width follows depth, transmit focus, frequency and harmonic
 * imaging — followed by envelope detection. Speckle statistics (Rayleigh) and its anisotropic cell that
 * grows with depth emerge here instead of being painted with noise.
 *
 * Kernels have unit energy (Σw² = 1): incoherent scattering keeps its mean level for any kernel width,
 * while coherent interfaces spread with the kernel and gain with their lateral extent. Both renderers use
 * the same Float32 kernel table, so CPU and GPU agree to float precision.
 */
export const MAX_AXIAL_RADIUS = 4;
export const MAX_LATERAL_RADIUS = 8;
export const LATERAL_TAPS = 2 * MAX_LATERAL_RADIUS + 1;
/** Mean envelope of a unit-power circular complex Gaussian is √π/2: scaling by its inverse keeps mean(envelope) ≈ σ. */
export const ENVELOPE_NORM = 2 / Math.sqrt(Math.PI);
/** Active aperture of the simulated adult sector probe (mm). */
export const APERTURE_MM = 14;
const FWHM_TO_SIGMA = 1 / (2 * Math.sqrt(2 * Math.log(2)));

/** Axial resolution (FWHM of the pulse envelope, mm): about two cycles; harmonic imaging trades a little axial resolution. */
export function axialFwhmMm(frequencyMHz: number, harmonics: boolean): number {
  return 0.77 * (2.5 / frequencyMHz) * (harmonics ? 1.15 : 1);
}

/**
 * Two-way lateral FWHM (mm) at depth r: dynamic receive focusing limited to F-number ≥ 1, times a fixed
 * transmit focus modelled as a Gaussian beam (waist at the focus, Rayleigh range from the waist). Harmonic
 * imaging narrows the beam; the case artifact "beam width" widens it away from the focus.
 */
export function lateralFwhmMm(rCm: number, focusCm: number, frequencyMHz: number, harmonics: boolean, beamWidthBoost = 0): number {
  const lambda = 1.54 / frequencyMHz;
  const rMm = Math.max(1, rCm * 10);
  const fMm = Math.max(10, focusCm * 10);
  const rx = 1.02 * lambda * Math.max(rMm / APERTURE_MM, 1);
  const w0 = 1.02 * lambda * (fMm / APERTURE_MM);
  const zR = (Math.PI * (w0 / 1.177) ** 2) / lambda;
  const tx = w0 * Math.sqrt(1 + ((rMm - fMm) / zR) ** 2);
  const twoWay = 1 / Math.sqrt(1 / (tx * tx) + 1 / (rx * rx));
  return twoWay * (harmonics ? 0.8 : 1) * (1 + 1.6 * beamWidthBoost * Math.min(1, Math.abs(rCm - focusCm) / 6));
}

export interface PsfKernels {
  key: string;
  axialRadius: number;
  /** Axial weights for offsets −R..R. */
  axial: Float32Array;
  /** Per sample index: radius (lines) of its lateral kernel. */
  lateralRadius: Uint8Array;
  /** Per sample index: LATERAL_TAPS weights centred on MAX_LATERAL_RADIUS (zeros beyond its radius). */
  lateral: Float32Array;
}

/** Unit-energy Gaussian taps for offsets −R..R written at `offset` (centre = offset + centre); returns R. */
function gaussianTaps(sigma: number, maxRadius: number, out: Float32Array, centre: number): number {
  const s = Math.max(0.3, sigma);
  const R = Math.min(maxRadius, Math.max(1, Math.ceil(3 * s)));
  let e = 0;
  for (let j = -R; j <= R; j++) {
    const w = Math.exp(-(j * j) / (2 * s * s));
    out[centre + j] = w;
    e += w * w;
  }
  const k = 1 / Math.sqrt(e);
  for (let j = -R; j <= R; j++) out[centre + j] = (out[centre + j] ?? 0) * k;
  return R;
}

export function psfKey(spec: PolarFrameSpec, frequencyMHz: number, harmonics: boolean, beamWidthBoost: number): string {
  return `${spec.lines}x${spec.samples}|${spec.depthCm}|${spec.sectorRad.toFixed(5)}|${spec.focusCm}|${frequencyMHz}|${harmonics ? 1 : 0}|${beamWidthBoost.toFixed(3)}`;
}

export function buildPsfKernels(spec: PolarFrameSpec, frequencyMHz: number, harmonics: boolean, beamWidthBoost = 0): PsfKernels {
  const dr = spec.depthCm / spec.samples;
  const dTheta = spec.sectorRad / spec.lines;
  const axial = new Float32Array(2 * MAX_AXIAL_RADIUS + 1);
  const axialSigma = (axialFwhmMm(frequencyMHz, harmonics) / 10 / dr) * FWHM_TO_SIGMA;
  const axialRadius = gaussianTaps(axialSigma, MAX_AXIAL_RADIUS, axial, MAX_AXIAL_RADIUS);
  const lateral = new Float32Array(spec.samples * LATERAL_TAPS);
  const lateralRadius = new Uint8Array(spec.samples);
  for (let si = 0; si < spec.samples; si++) {
    const r = (si + 0.5) * dr;
    const sigmaLines = (lateralFwhmMm(r, spec.focusCm, frequencyMHz, harmonics, beamWidthBoost) / 10 / (r * dTheta)) * FWHM_TO_SIGMA;
    lateralRadius[si] = gaussianTaps(sigmaLines, MAX_LATERAL_RADIUS, lateral, si * LATERAL_TAPS + MAX_LATERAL_RADIUS);
  }
  // shift the axial taps so index 0 is offset −R (compact)
  const compact = axial.slice(MAX_AXIAL_RADIUS - axialRadius, MAX_AXIAL_RADIUS + axialRadius + 1);
  return { key: psfKey(spec, frequencyMHz, harmonics, beamWidthBoost), axialRadius, axial: compact, lateralRadius, lateral };
}

/** Axial filter of one line of complex samples (clamped at the ends) into tmp arrays. */
function axialPass(re: Float32Array, im: Float32Array, base: number, samples: number, k: PsfKernels, tmpRe: Float32Array, tmpIm: Float32Array): void {
  const R = k.axialRadius;
  const w = k.axial;
  const last = samples - 1;
  for (let si = 0; si < samples; si++) {
    let sr = 0,
      sm = 0;
    for (let j = -R; j <= R; j++) {
      const q = si + j;
      const idx = base + (q < 0 ? 0 : q > last ? last : q);
      const wj = w[j + R]!;
      sr += wj * re[idx]!;
      sm += wj * im[idx]!;
    }
    tmpRe[base + si] = sr;
    tmpIm[base + si] = sm;
  }
}

/** Separable PSF on a full frame of complex samples followed by envelope detection into `outAmp`. */
export function formEnvelope(re: Float32Array, im: Float32Array, lines: number, samples: number, k: PsfKernels, outAmp: Float32Array, tmpRe: Float32Array, tmpIm: Float32Array): void {
  for (let li = 0; li < lines; li++) axialPass(re, im, li * samples, samples, k, tmpRe, tmpIm);
  const lastLine = lines - 1;
  for (let si = 0; si < samples; si++) {
    const R = k.lateralRadius[si]!;
    const centre = si * LATERAL_TAPS + MAX_LATERAL_RADIUS;
    for (let li = 0; li < lines; li++) {
      let sr = 0,
        sm = 0;
      for (let j = -R; j <= R; j++) {
        const q = li + j;
        const idx = (q < 0 ? 0 : q > lastLine ? lastLine : q) * samples + si;
        const wj = k.lateral[centre + j]!;
        sr += wj * tmpRe[idx]!;
        sm += wj * tmpIm[idx]!;
      }
      outAmp[li * samples + si] = Math.sqrt(sr * sr + sm * sm) * ENVELOPE_NORM;
    }
  }
}

/** Single scanline (M-mode): axial PSF and envelope only — one beam has no lateral neighbours. */
export function formEnvelopeLine(re: Float32Array, im: Float32Array, samples: number, k: PsfKernels, outAmp: Float32Array, tmpRe: Float32Array, tmpIm: Float32Array): void {
  axialPass(re, im, 0, samples, k, tmpRe, tmpIm);
  for (let si = 0; si < samples; si++) {
    const a = tmpRe[si]!,
      b = tmpIm[si]!;
    outAmp[si] = Math.sqrt(a * a + b * b) * ENVELOPE_NORM;
  }
}
