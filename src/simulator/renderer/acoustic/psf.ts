import type { PolarFrameSpec } from '../types';
import {
  SCATTER_FREQ,
  SCATTER_FREQ_RATIO,
  SLICE_HALF_BASE_CM,
  SLICE_HALF_SLOPE,
} from './acoustics';

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
/** The PSF and noise passes loop over ±radius taps centred on column MAX_LATERAL_RADIUS of the kernel table. */
export function psfDefinesGlsl(): string {
  return [
    `#define PSF_AXIAL_RADIUS ${MAX_AXIAL_RADIUS}`,
    `#define PSF_LATERAL_RADIUS ${MAX_LATERAL_RADIUS}`,
  ].join('\n');
}
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
export function lateralFwhmMm(
  rCm: number,
  focusCm: number,
  frequencyMHz: number,
  harmonics: boolean,
  beamWidthBoost = 0,
): number {
  const lambda = 1.54 / frequencyMHz;
  const rMm = Math.max(1, rCm * 10);
  const fMm = Math.max(10, focusCm * 10);
  const rx = 1.02 * lambda * Math.max(rMm / APERTURE_MM, 1);
  const w0 = 1.02 * lambda * (fMm / APERTURE_MM);
  const zR = (Math.PI * (w0 / 1.177) ** 2) / lambda;
  const tx = w0 * Math.sqrt(1 + ((rMm - fMm) / zR) ** 2);
  const twoWay = 1 / Math.sqrt(1 / (tx * tx) + 1 / (rx * rx));
  return (
    twoWay *
    (harmonics ? 0.8 : 1) *
    (1 + 1.6 * beamWidthBoost * Math.min(1, Math.abs(rCm - focusCm) / 6))
  );
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

export function psfKey(
  spec: PolarFrameSpec,
  frequencyMHz: number,
  harmonics: boolean,
  beamWidthBoost: number,
): string {
  return `${spec.lines}x${spec.samples}|${spec.depthCm}|${spec.sectorRad.toFixed(5)}|${spec.focusCm}|${frequencyMHz}|${harmonics ? 1 : 0}|${beamWidthBoost.toFixed(3)}`;
}

export function buildPsfKernels(
  spec: PolarFrameSpec,
  frequencyMHz: number,
  harmonics: boolean,
  beamWidthBoost = 0,
): PsfKernels {
  const dr = spec.depthCm / spec.samples;
  const dTheta = spec.sectorRad / spec.lines;
  const axial = new Float32Array(2 * MAX_AXIAL_RADIUS + 1);
  const axialSigma = (axialFwhmMm(frequencyMHz, harmonics) / 10 / dr) * FWHM_TO_SIGMA;
  const axialRadius = gaussianTaps(axialSigma, MAX_AXIAL_RADIUS, axial, MAX_AXIAL_RADIUS);
  const lateral = new Float32Array(spec.samples * LATERAL_TAPS);
  const lateralRadius = new Uint8Array(spec.samples);
  for (let si = 0; si < spec.samples; si++) {
    const r = (si + 0.5) * dr;
    const sigmaLines =
      (lateralFwhmMm(r, spec.focusCm, frequencyMHz, harmonics, beamWidthBoost) /
        10 /
        (r * dTheta)) *
      FWHM_TO_SIGMA;
    lateralRadius[si] = gaussianTaps(
      sigmaLines,
      MAX_LATERAL_RADIUS,
      lateral,
      si * LATERAL_TAPS + MAX_LATERAL_RADIUS,
    );
  }
  // shift the axial taps so index 0 is offset −R (compact)
  const compact = axial.slice(MAX_AXIAL_RADIUS - axialRadius, MAX_AXIAL_RADIUS + axialRadius + 1);
  return {
    key: psfKey(spec, frequencyMHz, harmonics, beamWidthBoost),
    axialRadius,
    axial: compact,
    lateralRadius,
    lateral,
  };
}

/** Axial filter of one line of complex samples (clamped at the ends) into tmp arrays. */
function axialPass(
  re: Float32Array,
  im: Float32Array,
  base: number,
  samples: number,
  k: PsfKernels,
  tmpRe: Float32Array,
  tmpIm: Float32Array,
): void {
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
export function formEnvelope(
  re: Float32Array,
  im: Float32Array,
  lines: number,
  samples: number,
  k: PsfKernels,
  outAmp: Float32Array,
  tmpRe: Float32Array,
  tmpIm: Float32Array,
): void {
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

/** Half-width (cm) of the elevational slice at depth r: the offset of the two side planes of the slice-thickness passes. */
export function sliceHalfWidthCm(rCm: number, focusCm: number): number {
  return SLICE_HALF_BASE_CM + SLICE_HALF_SLOPE * Math.abs(rCm - focusCm);
}

/** Axial radius cap of an M-mode line kernel: the line is sampled several times finer than a frame (decision 84). */
export const MAX_LINE_AXIAL_RADIUS = 16;

/**
 * Normalised autocorrelation of value noise with smoothstep interpolation at a lag of `u` lattice cells, averaged over
 * the position inside the cell: ∫φ(t)φ(t+u)dt / ∫φ²(t)dt with φ(t) = 1 − 3t² + 2|t|³ on |t| ≤ 1 (zero from two cells).
 */
export function valueNoiseCorrelation(u: number): number {
  const a = Math.abs(u);
  if (a >= 2) return 0;
  const N = 256;
  const phi = (t: number): number => {
    const x = Math.abs(t);
    return x >= 1 ? 0 : 1 - x * x * (3 - 2 * x);
  };
  let s = 0;
  for (let i = 0; i < N; i++) {
    const t = -1 + (2 * (i + 0.5)) / N;
    s += phi(t) * phi(t + a);
  }
  // ∫φ² over [−1, 1] = 26/35 = 1 − 2·E[s(1−s)], the per-axis variance factor behind PHASOR_NORM
  return (s * (2 / N)) / (26 / 35);
}

/**
 * Lattice cells crossed per scatterer cell along an M-mode line, per lattice axis (decision 84). The across-beam lattice
 * coordinates are nearly constant along a line, and value noise is not stationary inside a cell (its variance halves
 * between lattice points), so a line at a fixed across-beam position would carry a constant gain of up to ±3 dB. Sweeping
 * them along the beam by irrational fractions of the along-beam coordinate averages that out within the pulse.
 */
export const LINE_LATTICE_PATH: readonly [number, number, number] = [1, 0.618034, 0.381966];

/**
 * Mean power of the axially filtered scatterer phasor when its two lattices (SCATTER_FREQ and ×SCATTER_FREQ_RATIO) are
 * sampled every `dr` cm along a path crossing `path` cells per axis per scatterer cell: Σᵢ Σⱼ wᵢ wⱼ ρ((i−j)·dr), with the
 * lattice correlation the product over the axes. It is 1 when the samples are independent (a frame: 0.71 mm against a
 * 0.4 mm cell) and grows when they are finer than the cell, because neighbouring phasors then add coherently (+4.25 dB at
 * 0.18 mm along one axis). A Monte Carlo over the lattice agreed with the axis-aligned value within 0.05 dB for every
 * oblique material direction tried, so a frame line needs no direction.
 */
export function filteredScattererPower(
  axial: Float32Array,
  drCm: number,
  path: readonly number[] = [1, 0, 0],
): number {
  const n = axial.length;
  const corr = (cells: number): number => {
    let c = 1;
    for (const a of path) c *= a === 0 ? 1 : valueNoiseCorrelation(cells * a);
    return c;
  };
  let p = 0;
  for (let lag = -(n - 1); lag <= n - 1; lag++) {
    const tau = Math.abs(lag) * drCm;
    const rho = 0.5 * (corr(tau * SCATTER_FREQ) + corr(tau * SCATTER_FREQ * SCATTER_FREQ_RATIO));
    if (rho === 0) continue;
    let s = 0;
    for (let i = Math.max(0, -lag); i < n && i + lag < n; i++) s += axial[i]! * axial[i + lag]!;
    p += rho * s;
  }
  return p;
}

/**
 * Kernels of one M-mode line (decision 84). The line is the same beam as a frame line, sampled finer than the frame so
 * the scatterer field is resolved and an echo can move by less than a frame sample; its levels stay those of a frame line
 * without the lateral pass:
 *  - incoherent contributions are scaled by √(P_frame / P_line), the ratio of the filtered scatterer powers
 *    (`filteredScattererPower`), so the mean speckle level does not depend on the sampling: `incoherent` for the tissue
 *    phasor, which follows `LINE_LATTICE_PATH`, and `incoherentAxial` for clutter and lung reverberation, whose lattices
 *    run along one axis with depth (3.76 against 3.00 dB of gain at 0.2 mm);
 *  - a coherent echo keeps the peak it has on a frame line: deposited on the two samples an interface window covers
 *    (w₀ + w₁ of each kernel), on one sample (pleural line, w₀) or spread over many (ring-down, Σw).
 * `lateralCells` and `elevationCells` are the lattice frequencies (cells/cm) of a phasor whose cell across the beam is
 * the beam width, so tissue sliding across the beam decorrelates over a beam width and not over a scatterer cell.
 */
export interface LineKernels extends PsfKernels {
  samples: number;
  incoherent: number;
  incoherentAxial: number;
  specular: number;
  single: number;
  smooth: number;
  lateralCells: Float32Array;
  elevationCells: Float32Array;
}

export function lineKernelKey(
  frame: PolarFrameSpec,
  samples: number,
  frequencyMHz: number,
  harmonics: boolean,
  beamWidthBoost: number,
): string {
  return `line${samples}|${psfKey(frame, frequencyMHz, harmonics, beamWidthBoost)}`;
}

export function buildLineKernels(
  frame: PolarFrameSpec,
  samples: number,
  frequencyMHz: number,
  harmonics: boolean,
  beamWidthBoost = 0,
): LineKernels {
  const ref = buildPsfKernels(frame, frequencyMHz, harmonics, beamWidthBoost);
  const drFrame = frame.depthCm / frame.samples;
  const dr = frame.depthCm / samples;
  const taps = new Float32Array(2 * MAX_LINE_AXIAL_RADIUS + 1);
  const sigma = (axialFwhmMm(frequencyMHz, harmonics) / 10 / dr) * FWHM_TO_SIGMA;
  const axialRadius = gaussianTaps(sigma, MAX_LINE_AXIAL_RADIUS, taps, MAX_LINE_AXIAL_RADIUS);
  const axial = taps.slice(
    MAX_LINE_AXIAL_RADIUS - axialRadius,
    MAX_LINE_AXIAL_RADIUS + axialRadius + 1,
  );
  const peak = (k: Float32Array, R: number, width: number): number => {
    let s = 0;
    for (let j = 0; j < width && R + j < k.length; j++) s += k[R + j]!;
    return s;
  };
  const sum = (k: Float32Array): number => k.reduce((a, b) => a + b, 0);
  const lateralCells = new Float32Array(samples);
  const elevationCells = new Float32Array(samples);
  for (let si = 0; si < samples; si++) {
    const r = (si + 0.5) * dr;
    lateralCells[si] =
      10 / lateralFwhmMm(r, frame.focusCm, frequencyMHz, harmonics, beamWidthBoost);
    elevationCells[si] = 1 / (2 * sliceHalfWidthCm(r, frame.focusCm));
  }
  return {
    key: lineKernelKey(frame, samples, frequencyMHz, harmonics, beamWidthBoost),
    samples,
    axialRadius,
    axial,
    lateralRadius: new Uint8Array(0),
    lateral: new Float32Array(0),
    incoherent: Math.sqrt(
      filteredScattererPower(ref.axial, drFrame) /
        filteredScattererPower(axial, dr, LINE_LATTICE_PATH),
    ),
    incoherentAxial: Math.sqrt(
      filteredScattererPower(ref.axial, drFrame) / filteredScattererPower(axial, dr),
    ),
    specular: peak(ref.axial, ref.axialRadius, 2) / peak(axial, axialRadius, 2),
    single: peak(ref.axial, ref.axialRadius, 1) / peak(axial, axialRadius, 1),
    smooth: sum(ref.axial) / sum(axial),
    lateralCells,
    elevationCells,
  };
}

/** Single scanline (M-mode): axial PSF and envelope only; the lateral beam enters through `LineKernels` (decision 84). */
export function formEnvelopeLine(
  re: Float32Array,
  im: Float32Array,
  samples: number,
  k: PsfKernels,
  outAmp: Float32Array,
  tmpRe: Float32Array,
  tmpIm: Float32Array,
): void {
  axialPass(re, im, 0, samples, k, tmpRe, tmpIm);
  for (let si = 0; si < samples; si++) {
    const a = tmpRe[si]!,
      b = tmpIm[si]!;
    outAmp[si] = Math.sqrt(a * a + b * b) * ENVELOPE_NORM;
  }
}

/**
 * Kernels of the receiver noise (decision 91). Thermal noise joins the echo after the transducer, so the receive chain
 * filters it and the transmitted pulse and beam do not. A frame reuses the echo's separable response without the case's
 * beam-width artifact, which widens the transmit beam: for Gaussian responses the receive-only correlation is √2 shorter
 * than the echo's along the beam and up to √2 wider across it (as wide where the transmit beam is much wider than the
 * receive one), so the reuse errs in opposite directions on the two axes. An M-mode line has no neighbours and takes the
 * axial response at its own finer sampling (decision 84).
 */
export function buildNoiseKernels(
  spec: PolarFrameSpec,
  frequencyMHz: number,
  harmonics: boolean,
): PsfKernels {
  if (spec.lines > 1)
    return {
      ...buildPsfKernels(spec, frequencyMHz, harmonics, 0),
      key: `noise|${psfKey(spec, frequencyMHz, harmonics, 0)}`,
    };
  const dr = spec.depthCm / spec.samples;
  const taps = new Float32Array(2 * MAX_LINE_AXIAL_RADIUS + 1);
  const axialRadius = gaussianTaps(
    (axialFwhmMm(frequencyMHz, harmonics) / 10 / dr) * FWHM_TO_SIGMA,
    MAX_LINE_AXIAL_RADIUS,
    taps,
    MAX_LINE_AXIAL_RADIUS,
  );
  return {
    key: `noise|${psfKey(spec, frequencyMHz, harmonics, 0)}`,
    axialRadius,
    axial: taps.slice(MAX_LINE_AXIAL_RADIUS - axialRadius, MAX_LINE_AXIAL_RADIUS + axialRadius + 1),
    lateralRadius: new Uint8Array(0),
    lateral: new Float32Array(0),
  };
}

/** Separable filter of a frame of complex samples, in place in `re`/`im`: the axial pass, then the lateral one when the frame has more than one line. */
export function filterComplex(
  re: Float32Array,
  im: Float32Array,
  lines: number,
  samples: number,
  k: PsfKernels,
  tmpRe: Float32Array,
  tmpIm: Float32Array,
): void {
  for (let li = 0; li < lines; li++) axialPass(re, im, li * samples, samples, k, tmpRe, tmpIm);
  if (lines === 1) {
    re.set(tmpRe.subarray(0, samples));
    im.set(tmpIm.subarray(0, samples));
    return;
  }
  const lastLine = lines - 1;
  for (let si = 0; si < samples; si++) {
    const R = k.lateralRadius[si]!;
    const centre = si * LATERAL_TAPS + MAX_LATERAL_RADIUS;
    const w0 = k.lateral[centre]!;
    for (let li = 0; li < lines; li++) {
      const at = li * samples + si;
      let sr = w0 * tmpRe[at]!,
        sm = w0 * tmpIm[at]!;
      // the taps are symmetric: one product per pair of lines at ±j
      for (let j = 1; j <= R; j++) {
        const lo = (li - j < 0 ? 0 : li - j) * samples + si,
          hi = (li + j > lastLine ? lastLine : li + j) * samples + si;
        const wj = k.lateral[centre + j]!;
        sr += wj * (tmpRe[lo]! + tmpRe[hi]!);
        sm += wj * (tmpIm[lo]! + tmpIm[hi]!);
      }
      re[at] = sr;
      im[at] = sm;
    }
  }
}
