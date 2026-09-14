import { aliasVelocity } from '@/clinical/formulas';
import { Tissue } from '@/simulator/anatomy/tissue';
import type { PolarFrame } from '@/simulator/renderer/types';
import type { ScanLut } from '@/simulator/renderer/scanConvert';

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
export function relativeTransmission(transmission: number, depthCm: number, acquisition: ColorAcquisition): number {
  const fAtten = acquisition.frequencyMHz * (acquisition.harmonics ? 1.2 : 1);
  return transmission / Math.exp(-0.23 * 0.5 * fAtten * depthCm);
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

export function allocColorField(n: number): ColorField {
  return { vel: new Float32Array(n).fill(NaN), variance: new Float32Array(n), power: new Float32Array(n), scaleMps: 0, baselineShiftMps: 0, invert: false };
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
  axialVelocity: (idx: number, li: number, si: number, out: { v: number; disp: number; present: number }) => void,
  out: ColorField,
  acquisition: ColorAcquisition,
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
  const history = prev && prev.scaleMps === s.scaleMps && prev.baselineShiftMps === s.baselineShiftMps && prev.invert === s.invert ? prev : null;
  const gainLin = Math.pow(10, s.gainDb / 20);
  const bloomSamples = Math.max(0, Math.round((s.gainDb - 2) * 0.6)); // dilation radius grows with gain
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
          if (frame.tissue[idx - d] === Tissue.Blood || frame.tissue[idx + d] === Tissue.Blood) isBlood = true;
          if (li > 0 && frame.tissue[idx - samples] === Tissue.Blood) isBlood = true;
          if (li < lines - 1 && frame.tissue[idx + samples] === Tissue.Blood) isBlood = true;
        }
      }
      if (!isBlood) continue;
      axialVelocity(idx, li, si, tmp);
      if (!tmp.present) continue;
      const vTrue = s.invert ? -tmp.v : tmp.v;
      if (Math.abs(vTrue) < s.wallFilterMps) continue;
      const v = aliasVelocity(vTrue, s.scaleMps, s.baselineShiftMps);
      const power = Math.min(1, gainLin * Math.min(1, relTrans) * wallFilterResponse(Math.abs(vTrue), s.wallFilterMps));
      if (power < 0.25) continue; // below the display threshold: weak signal not shown
      let vel = v;
      let variance = Math.min(1, tmp.disp * 1.6);
      let pow = power;
      const pv = history ? (history.vel[idx] ?? NaN) : NaN;
      if (history && !Number.isNaN(pv)) {
        const p = s.persistence;
        const pp = history.power[idx] ?? power;
        const a1 = (Math.PI * (v - s.baselineShiftMps)) / s.scaleMps;
        const a0 = (Math.PI * (pv - s.baselineShiftMps)) / s.scaleMps;
        const re = (1 - p) * power * Math.cos(a1) + p * pp * Math.cos(a0);
        const im = (1 - p) * power * Math.sin(a1) + p * pp * Math.sin(a0);
        vel = aliasVelocity(s.baselineShiftMps + (s.scaleMps * Math.atan2(im, re)) / Math.PI, s.scaleMps, s.baselineShiftMps);
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

/** Velocity → RGB (red toward, blue away; brighter = faster; green = variance). */
export function colorMap(v: number, scale: number, variance: number, showVariance: boolean, out: [number, number, number]): void {
  const t = Math.max(-1, Math.min(1, v / scale));
  const a = Math.abs(t);
  if (t >= 0) {
    out[0] = 120 + 135 * Math.min(1, a * 1.2);
    out[1] = 20 + 220 * Math.max(0, a - 0.55) * 2.2;
    out[2] = 20;
  } else {
    out[0] = 20;
    out[1] = 40 + 200 * Math.max(0, a - 0.55) * 2.2;
    out[2] = 120 + 135 * Math.min(1, a * 1.2);
  }
  if (showVariance && variance > 0.15) {
    const g = Math.min(1, (variance - 0.15) * 1.5);
    out[1] = out[1] * (1 - g) + 230 * g;
    out[0] = out[0] * (1 - g * 0.4);
    out[2] = out[2] * (1 - g * 0.4);
  }
}

/**
 * Blend a polar colour field over a scan-converted grey image (85 % colour, 15 % grey) inside the colour
 * box, using the nearest polar sample of each pixel. The GPU present pass (gpu/glslImage.ts) does the same.
 */
export function overlayColorField(rgba: Uint8ClampedArray, lut: ScanLut, vel: Float32Array, variance: Float32Array, c: ColorSettings): void {
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
    rgba[o] = Math.round(rgb[0] * 0.85 + g * 0.15);
    rgba[o + 1] = Math.round(rgb[1] * 0.85 + g * 0.15);
    rgba[o + 2] = Math.round(rgb[2] * 0.85 + g * 0.15);
  }
}
