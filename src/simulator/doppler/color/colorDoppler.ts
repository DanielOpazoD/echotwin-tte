import { aliasVelocity } from '@/clinical/formulas';
import { Tissue } from '@/simulator/anatomy/tissue';
import type { PolarFrame } from '@/simulator/renderer/types';

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

/** Per-sample colour result buffers (polar). vel in m/s after aliasing, NaN where no colour. */
export interface ColorField {
  vel: Float32Array;
  variance: Float32Array;
  power: Float32Array;
}

export function allocColorField(n: number): ColorField {
  return { vel: new Float32Array(n).fill(NaN), variance: new Float32Array(n), power: new Float32Array(n) };
}

/**
 * Compute colour for samples inside the box. `axialVelocity(idx)` returns the projected velocity
 * (m/s, +toward) and dispersion for a polar sample, computed by the caller from the flow field.
 * Blooming: gain above 0 extends colour into adjacent non-blood samples (dilation). Shadowing:
 * samples with low transmission get no colour.
 */
export function computeColorField(
  frame: PolarFrame,
  s: ColorSettings,
  prev: ColorField | null,
  axialVelocity: (idx: number, li: number, si: number, out: { v: number; disp: number; present: number }) => void,
  out: ColorField,
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
  const gainLin = Math.pow(10, s.gainDb / 20);
  const bloomSamples = Math.max(0, Math.round((s.gainDb - 2) * 0.6)); // dilation radius grows with gain
  for (let li = liMin; li <= liMax; li++) {
    for (let si = siMin; si <= siMax; si++) {
      const idx = li * samples + si;
      const tissue = frame.tissue[idx];
      const trans = frame.transmission[idx] ?? 0;
      const r = ((si + 0.5) / samples) * depthCm;
      const expected = Math.exp(-0.23 * 0.5 * 2.5 * 1.2 * r);
      if (trans < 0.2 * expected) continue; // acoustic shadow: no Doppler signal
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
      const power = Math.min(1, gainLin * (0.6 + 0.4 * Math.min(1, Math.abs(vTrue) / 0.3)));
      if (power < 0.25) continue; // low gain: weak signal not displayed
      let vel = v;
      let variance = Math.min(1, tmp.disp * 1.6);
      if (prev && !Number.isNaN(prev.vel[idx] ?? NaN)) {
        const p = s.persistence;
        vel = v * (1 - p) + (prev.vel[idx] ?? v) * p;
        variance = variance * (1 - p) + (prev.variance[idx] ?? variance) * p;
      }
      out.vel[idx] = vel;
      out.variance[idx] = variance;
      out.power[idx] = power;
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
