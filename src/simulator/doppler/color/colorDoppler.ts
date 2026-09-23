import { softTissueTransmission } from '@/simulator/renderer/acoustic/acoustics';
import { aliasVelocity } from '@/clinical/formulas';
import { hash3 } from '@/core/random';
import { Tissue } from '@/simulator/anatomy/tissue';
import type { PolarFrame } from '@/simulator/renderer/types';
import type { ScanLut } from '@/simulator/renderer/scanConvert';
import { COLOR_BLEND, colorMap } from '@/simulator/renderer/postprocess/colorMap';

export interface ColorSettings {
  boxThetaMinRad: number;
  boxThetaMaxRad: number;
  boxRMinCm: number;
  boxRMaxCm: number;
  scaleMps: number; // Nyquist
  baselineShiftMps: number;
  wallFilterMps: number;
  gainDb: number;
  persistence: number;
  showVariance: boolean;
  invert: boolean;
}

export const DEFAULT_COLOR: ColorSettings = {
  boxThetaMinRad: -0.32,
  boxThetaMaxRad: 0.32,
  boxRMinCm: 5,
  boxRMaxCm: 13,
  scaleMps: 0.62,
  baselineShiftMps: 0,
  wallFilterMps: 0.06,
  gainDb: 0,
  persistence: 0.3,
  showVariance: true,
  invert: false,
};

/** Acquisition the colour field was formed with: the expected tissue attenuation depends on it. */
export interface ColorAcquisition {
  frequencyMHz: number;
  harmonics: boolean;
}

/** Below this fraction of the expected transmission a sample lies in an acoustic shadow: no Doppler signal at any gain. */
export const DOPPLER_SHADOW_TRANSMISSION = 0.02;

/**
 * Two-way transmission of a frame sample relative to what soft tissue (0.5 dB/cm/MHz) would leave at its depth for the
 * acquisition that formed the frame (decisions 87 and 96): depth alone does not make a shadow.
 */
export function relativeTransmission(
  transmission: number,
  depthCm: number,
  acquisition: ColorAcquisition,
): number {
  return (
    transmission / softTissueTransmission(depthCm, acquisition.frequencyMHz, acquisition.harmonics)
  );
}

/** Second-order wall-filter magnitude at |v| over the cutoff: −3 dB at the cutoff, flat from about twice it. */
export function wallFilterResponse(vAbs: number, cutoffMps: number): number {
  if (cutoffMps <= 0) return 1;
  const x = (vAbs / cutoffMps) ** 2;
  return x / Math.sqrt(1 + x * x);
}

/** Per-sample colour result buffers (polar). vel in m/s after aliasing, NaN where no colour. */
export interface ColorField {
  vel: Float32Array;
  variance: Float32Array;
  power: Float32Array;
  /** Velocity scale, baseline and inversion the field was formed with: its phases mean nothing under other ones. */
  scaleMps: number;
  baselineShiftMps: number;
  invert: boolean;
}

/**
 * The colour field as a scanner estimates it (decision 116). Each update the velocity comes from the autocorrelation of a short
 * packet of echoes and the power from the same echoes of moving blood, so both scatter: the power of the blood's speckle
 * (exponential, averaged over the packet and the sample volume) decides whether a sample passes the display threshold,
 * and the velocity estimate scatters around the velocity, more with a broad spectrum and with a weak echo. Both are
 * correlated over about two samples and two lines (the resolution cell) and new at every update, as the blood moves on.
 * Without an estimate the field is the expected one. Declared values: no measured colour Doppler texture was found to
 * calibrate against.
 */
export interface ColorEstimate {
  /** Index of the colour update: every update draws a new realization. */
  realization: number;
  seed: number;
}
/**
 * Velocity scatter of the estimate: a floor for a strong laminar echo and the scatter at the display threshold (fractions of
 * Nyquist), and the spectral width over the square root of the independent samples of a packet: the turbulent spread of the
 * spectrum is 0.9 × dispersion × speed (spectrum.ts), over √4. In a turbulent jet well above Nyquist the estimate becomes a
 * mosaic of every colour, as it does on a scanner.
 */
const ESTIMATE_SD_FLOOR = 0.035;
const ESTIMATE_SD_WIDTH = 0.45;
const ESTIMATE_SD_THRESHOLD = 0.06;
const COLOR_THRESHOLD = 0.25;

/** Unit Gaussian from two hashes (Box–Muller). */
function hashGaussian(li: number, si: number, stream: number, seed: number): number {
  const u1 = hash3(li, si, stream, seed);
  const u2 = hash3(li, si, stream + 1, seed);
  return Math.sqrt(-2 * Math.log(Math.max(1e-12, u1))) * Math.cos(2 * Math.PI * u2);
}

/** Binomial [1 2 1]/4 smoothing of a lines × samples grid, along lines and along samples, in place. */
function smoothGrid(g: Float32Array, nL: number, nS: number, tmp: Float32Array): void {
  for (let l = 0; l < nL; l++)
    for (let k = 0; k < nS; k++) {
      const i = l * nS + k;
      tmp[i] = 0.25 * (g[k > 0 ? i - 1 : i]! + 2 * g[i]! + g[k < nS - 1 ? i + 1 : i]!);
    }
  for (let l = 0; l < nL; l++)
    for (let k = 0; k < nS; k++) {
      const i = l * nS + k;
      g[i] = 0.25 * (tmp[l > 0 ? i - nS : i]! + 2 * tmp[i]! + tmp[l < nL - 1 ? i + nS : i]!);
    }
}

/**
 * The estimate of one update over the colour box: a unit Gaussian velocity scatter and the blood's speckle power (mean 1), both
 * correlated over the resolution cell (about two samples and two lines). The power is the squared magnitude of a smoothed
 * complex Gaussian field, smoothed again as the packet and the sample volume average it. Computed per sample with its own
 * 3×3 kernels it cost 10 µs a sample (60 ms for a colour box of 6000 samples).
 */
function estimateGrids(
  liMin: number,
  siMin: number,
  nL: number,
  nS: number,
  estimate: ColorEstimate,
): { velocity: Float32Array; power: Float32Array } {
  const n = nL * nS;
  const velocity = new Float32Array(n);
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  const tmp = new Float32Array(n);
  const stream = estimate.realization * 8;
  for (let l = 0; l < nL; l++)
    for (let k = 0; k < nS; k++) {
      const i = l * nS + k;
      velocity[i] = hashGaussian(liMin + l, siMin + k, stream, estimate.seed);
      re[i] = hashGaussian(liMin + l, siMin + k, stream + 2, estimate.seed);
      im[i] = hashGaussian(liMin + l, siMin + k, stream + 4, estimate.seed);
    }
  smoothGrid(velocity, nL, nS, tmp);
  smoothGrid(re, nL, nS, tmp);
  smoothGrid(im, nL, nS, tmp);
  // [1 2 1]/4 in two directions keeps (6/16)² of the variance
  const unit = 1 / 0.375;
  const power = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    velocity[i]! *= unit;
    const a = re[i]! * unit,
      b = im[i]! * unit;
    power[i] = (a * a + b * b) / 2;
  }
  smoothGrid(power, nL, nS, tmp);
  return { velocity, power };
}

export function allocColorField(n: number): ColorField {
  return {
    vel: new Float32Array(n).fill(NaN),
    variance: new Float32Array(n),
    power: new Float32Array(n),
    scaleMps: 0,
    baselineShiftMps: 0,
    invert: false,
  };
}

/**
 * Compute colour for samples inside the box. `axialVelocity(idx)` returns the projected velocity
 * (m/s, +toward) and dispersion for a polar sample, computed by the caller from the flow field.
 * Blooming: gain above 0 extends colour into adjacent non-blood samples (dilation).
 * Signal power (decision 87) is the colour gain × the sample's two-way transmission relative to what soft tissue would
 * leave at that depth for this acquisition × the wall-filter response, so low gain loses attenuated, partly shadowed and
 * slow flow first; under a real shadow (< 2 % of the expected transmission) there is no signal at any gain. It used to
 * depend on velocity only, with the shadow threshold computed at a fixed 2.5 MHz.
 * Persistence blends each coloured sample with `prev`, the field of the previous update, as the lag-one autocorrelation
 * the velocity comes from: power-weighted phasors at the Doppler phase of each velocity, whose angle is the blended
 * velocity. Averaging aliased velocities linearly turned two flows on either side of Nyquist into a false slow flow.
 * `prev` must be a different buffer from `out`, which is cleared first.
 */
export function computeColorField(
  frame: PolarFrame,
  s: ColorSettings,
  prev: ColorField | null,
  axialVelocity: (
    idx: number,
    li: number,
    si: number,
    out: { v: number; disp: number; present: number },
  ) => void,
  out: ColorField,
  acquisition: ColorAcquisition,
  estimate?: ColorEstimate,
): { colorLines: number } {
  const { lines, samples, sectorRad, depthCm } = frame.spec;
  const tmp = { v: 0, disp: 0, present: 0 };
  const half = sectorRad / 2;
  const liMin = Math.max(0, Math.floor(((s.boxThetaMinRad + half) / sectorRad) * lines));
  const liMax = Math.min(lines - 1, Math.ceil(((s.boxThetaMaxRad + half) / sectorRad) * lines));
  const siMin = Math.max(0, Math.floor((s.boxRMinCm / depthCm) * samples));
  const siMax = Math.min(samples - 1, Math.ceil((s.boxRMaxCm / depthCm) * samples));
  out.vel.fill(NaN);
  out.power.fill(0);
  out.variance.fill(0);
  out.scaleMps = s.scaleMps;
  out.baselineShiftMps = s.baselineShiftMps;
  out.invert = s.invert;
  // a history formed under another scale, baseline or inversion is not blended: its velocities are other phases
  const history =
    prev &&
    prev.scaleMps === s.scaleMps &&
    prev.baselineShiftMps === s.baselineShiftMps &&
    prev.invert === s.invert
      ? prev
      : null;
  const gainLin = Math.pow(10, s.gainDb / 20);
  const bloomSamples = Math.max(0, Math.round((s.gainDb - 2) * 0.6)); // dilation radius grows with gain
  const nS = siMax - siMin + 1;
  const grids =
    estimate && liMax >= liMin && nS > 0
      ? estimateGrids(liMin, siMin, liMax - liMin + 1, nS, estimate)
      : null;
  for (let li = liMin; li <= liMax; li++) {
    for (let si = siMin; si <= siMax; si++) {
      const idx = li * samples + si;
      const tissue = frame.tissue[idx];
      const trans = frame.transmission[idx] ?? 0;
      const r = ((si + 0.5) / samples) * depthCm;
      const relTrans = relativeTransmission(trans, r, acquisition);
      if (relTrans < DOPPLER_SHADOW_TRANSMISSION) continue; // acoustic shadow: no Doppler signal at any gain
      let isBlood = tissue === Tissue.Blood;
      if (!isBlood && bloomSamples > 0) {
        // blooming: colour bleeds onto adjacent tissue when gain is high
        for (let d = 1; d <= bloomSamples && !isBlood; d++) {
          if (frame.tissue[idx - d] === Tissue.Blood || frame.tissue[idx + d] === Tissue.Blood)
            isBlood = true;
          if (li > 0 && frame.tissue[idx - samples] === Tissue.Blood) isBlood = true;
          if (li < lines - 1 && frame.tissue[idx + samples] === Tissue.Blood) isBlood = true;
        }
      }
      if (!isBlood) continue;
      axialVelocity(idx, li, si, tmp);
      if (!tmp.present) continue;
      const vTrue = s.invert ? -tmp.v : tmp.v;
      if (Math.abs(vTrue) < s.wallFilterMps) continue;
      const expectedPower = Math.min(
        1,
        gainLin * Math.min(1, relTrans) * wallFilterResponse(Math.abs(vTrue), s.wallFilterMps),
      );
      let power = expectedPower;
      let vEstimate = vTrue;
      let variance = Math.min(1, tmp.disp * 1.6);
      if (estimate) {
        // the estimate of this update (decision 116): speckled power, scattered velocity
        const g = (li - liMin) * nS + (si - siMin);
        const speckle = grids!.power[g]!;
        power = Math.min(1, expectedPower * speckle);
        const sd = Math.hypot(
          s.scaleMps * ESTIMATE_SD_FLOOR,
          ESTIMATE_SD_WIDTH * tmp.disp * Math.abs(vTrue),
          (s.scaleMps * ESTIMATE_SD_THRESHOLD * COLOR_THRESHOLD) /
            Math.max(1e-3, gainLin * Math.min(1, relTrans) * speckle),
        );
        vEstimate = vTrue + sd * grids!.velocity[g]!;
        // a weak or scattered estimate reads as spectral spread too
        variance = Math.min(1, variance + (sd / s.scaleMps) ** 2 * 4);
      }
      if (power < COLOR_THRESHOLD) continue; // below the display threshold: weak signal not shown
      const v = aliasVelocity(vEstimate, s.scaleMps, s.baselineShiftMps);
      let vel = v;
      let pow = power;
      const pv = history ? (history.vel[idx] ?? NaN) : NaN;
      if (history && !Number.isNaN(pv)) {
        const p = s.persistence;
        const pp = history.power[idx] ?? power;
        const a1 = (Math.PI * (v - s.baselineShiftMps)) / s.scaleMps;
        const a0 = (Math.PI * (pv - s.baselineShiftMps)) / s.scaleMps;
        const re = (1 - p) * power * Math.cos(a1) + p * pp * Math.cos(a0);
        const im = (1 - p) * power * Math.sin(a1) + p * pp * Math.sin(a0);
        vel = aliasVelocity(
          s.baselineShiftMps + (s.scaleMps * Math.atan2(im, re)) / Math.PI,
          s.scaleMps,
          s.baselineShiftMps,
        );
        variance = variance * (1 - p) + (history.variance[idx] ?? variance) * p;
        pow = power * (1 - p) + pp * p;
      }
      out.vel[idx] = vel;
      out.variance[idx] = variance;
      out.power[idx] = pow;
    }
  }
  return { colorLines: Math.max(0, liMax - liMin + 1) };
}

export { colorMap } from '@/simulator/renderer/postprocess/colorMap';

/**
 * Blend a polar colour field over a scan-converted grey image (85 % colour, 15 % grey) inside the colour
 * box, using the nearest polar sample of each pixel. The GPU present pass (gpu/glslImage.ts) does the same.
 */
export function overlayColorField(
  rgba: Uint8ClampedArray,
  lut: ScanLut,
  vel: Float32Array,
  variance: Float32Array,
  c: ColorSettings,
): void {
  const rgb: [number, number, number] = [0, 0, 0];
  const S = lut.samples;
  const n = lut.idx.length;
  for (let p = 0, o = 0; p < n; p++, o += 4) {
    if ((lut.idx[p] ?? -1) < 0) continue;
    const r = lut.rCm[p] ?? 0;
    if (r < c.boxRMinCm || r > c.boxRMaxCm) continue;
    const th = lut.theta[p] ?? 0;
    if (th < c.boxThetaMinRad || th > c.boxThetaMaxRad) continue;
    const k = (lut.li[p] ?? 0) * S + (lut.si[p] ?? 0);
    const v = vel[k];
    if (v === undefined || Number.isNaN(v)) continue;
    colorMap(v, c.scaleMps, variance[k] ?? 0, c.showVariance, rgb);
    const g = rgba[o] ?? 0;
    rgba[o] = Math.round(rgb[0] * COLOR_BLEND + g * (1 - COLOR_BLEND));
    rgba[o + 1] = Math.round(rgb[1] * COLOR_BLEND + g * (1 - COLOR_BLEND));
    rgba[o + 2] = Math.round(rgb[2] * COLOR_BLEND + g * (1 - COLOR_BLEND));
  }
}
