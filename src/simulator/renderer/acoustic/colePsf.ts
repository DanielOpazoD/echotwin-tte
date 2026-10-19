/**
 * PSF kernels of the convolution image formation (decision 351), taken from the physics reference of the realism bench
 * instead of closed formulas: the pulse-echo response of the simulator's aperture seen by a phased array with
 * delay-and-sum beamforming, as Field II computes it (`clinical/realism/dasReference.ts`, validated against 0.886 λF at
 * the focus). The array is the bench's: 64 point elements over the simulator's aperture, the console's transmit focus,
 * dynamic receive at F/1, no apodization.
 *
 * Axially, the envelope of the Field II pulse-echo pulse (a two-cycle excitation through a two-cycle impulse response),
 * stretched 1.15 times in harmonic imaging as the closed-form PSF assumes. Laterally, at each depth, the narrowband
 * pulse-echo profile (the transmit field focused on each line times the receive sensitivity; the transmit field squared
 * for a harmonic source received at twice the frequency) with the sign of each lobe, sampled at the line spacing. Both
 * in the table of `psf.ts` (unit energy), so `formEnvelope` applies them as it applies the closed-form ones.
 */
import {
  fieldIiPulse,
  narrowbandLateral,
  SOUND_SPEED_MM_PER_US,
  type ArrayParams,
} from '@/clinical/realism/dasReference';
import type { PolarFrameSpec } from '../types';
import {
  APERTURE_MM,
  LATERAL_TAPS,
  MAX_AXIAL_RADIUS,
  MAX_LATERAL_RADIUS,
  psfKey,
  type PsfKernels,
} from './psf';

/** Elements of the reference array, and its receive F-number. */
export const COLE_ELEMENTS = 64;
export const COLE_RX_F_NUMBER = 1;
/** Harmonic imaging lengthens the pulse as the closed-form PSF assumes (`axialFwhmMm`). */
export const COLE_HARMONIC_AXIAL_STRETCH = 1.15;
/** Taps below this fraction of the kernel's peak are left out of its radius. */
const TAP_FLOOR = 1e-3;
/** Depths (cm) between which the lateral profile is computed; the samples in between interpolate it. */
const PROFILE_STEP_CM = 0.25;

/** The bench's reference array at the console's frequency and transmit focus. */
export function coleArray(frequencyMHz: number, focusCm: number): ArrayParams {
  return {
    f0MHz: frequencyMHz,
    elements: COLE_ELEMENTS,
    apertureMm: APERTURE_MM,
    txFocusMm: focusCm * 10,
    apodization: 'rect',
    rxFNumber: COLE_RX_F_NUMBER,
  };
}

const cache = new Map<string, PsfKernels>();

/** The convolution kernels for a frame geometry at the console's frequency and harmonic setting. */
export function buildColeKernels(
  spec: PolarFrameSpec,
  frequencyMHz: number,
  harmonics: boolean,
): PsfKernels {
  const key = `${psfKey(spec, frequencyMHz, harmonics, 0, null)}|cole`;
  const kept = cache.get(key);
  if (kept) return kept;
  const p = coleArray(frequencyMHz, spec.focusCm);
  const drMm = (spec.depthCm / spec.samples) * 10;
  const dTheta = spec.sectorRad / spec.lines;

  // axial: the pulse's envelope against depth (two-way: Δt = 2Δz/c)
  const pulse = fieldIiPulse(frequencyMHz);
  const envAt = (tUs: number): number => {
    const f = pulse.peak + tUs / pulse.dtUs;
    const i0 = Math.floor(f);
    if (i0 < 0 || i0 + 1 >= pulse.re.length) return 0;
    const e0 = Math.hypot(pulse.re[i0]!, pulse.im[i0]!),
      e1 = Math.hypot(pulse.re[i0 + 1]!, pulse.im[i0 + 1]!);
    return e0 + (e1 - e0) * (f - i0);
  };
  const stretch = harmonics ? COLE_HARMONIC_AXIAL_STRETCH : 1;
  const ax: number[] = [];
  for (let j = 0; j <= MAX_AXIAL_RADIUS; j++)
    ax.push(envAt((2 * j * drMm) / SOUND_SPEED_MM_PER_US / stretch));
  let axialRadius = MAX_AXIAL_RADIUS;
  while (axialRadius > 1 && Math.abs(ax[axialRadius]!) < TAP_FLOOR * ax[0]!) axialRadius--;
  const axial = new Float32Array(2 * axialRadius + 1);
  for (let j = -axialRadius; j <= axialRadius; j++) axial[j + axialRadius] = ax[Math.abs(j)]!;
  unitEnergy(axial, 0, axial.length);

  // lateral: the signed pulse-echo profile at a ladder of depths, interpolated to each sample
  const rx = harmonics ? 2 * frequencyMHz : frequencyMHz;
  const profiles = new Map<number, { xMm: Float64Array; signed: Float64Array }>();
  const profileAt = (rCm: number) => {
    const key2 = Math.max(1, Math.round(rCm / PROFILE_STEP_CM));
    const kept2 = profiles.get(key2);
    if (kept2) return kept2;
    const depthMm = key2 * PROFILE_STEP_CM * 10;
    const halfWidth = Math.min(40, (MAX_LATERAL_RADIUS + 1) * depthMm * dTheta);
    const step = Math.min(0.05, (depthMm * dTheta) / 8);
    const pr = narrowbandLateral(p, depthMm, frequencyMHz, rx, harmonics, halfWidth, step);
    const v = { xMm: pr.xMm, signed: pr.signed };
    profiles.set(key2, v);
    return v;
  };
  const sample = (pr: { xMm: Float64Array; signed: Float64Array }, x: number): number => {
    const x0 = pr.xMm[0]!,
      dx = pr.xMm[1]! - x0;
    const f = (x - x0) / dx;
    const i0 = Math.floor(f);
    if (i0 < 0 || i0 + 1 >= pr.signed.length) return 0;
    return pr.signed[i0]! + (pr.signed[i0 + 1]! - pr.signed[i0]!) * (f - i0);
  };
  const lateral = new Float32Array(spec.samples * LATERAL_TAPS);
  const lateralRadius = new Uint8Array(spec.samples);
  for (let si = 0; si < spec.samples; si++) {
    const r = (si + 0.5) * (spec.depthCm / spec.samples);
    const pr = profileAt(r);
    const spacing = r * 10 * dTheta;
    const centre = si * LATERAL_TAPS + MAX_LATERAL_RADIUS;
    const peak = Math.abs(sample(pr, 0)) || 1;
    let R = 0;
    for (let j = 0; j <= MAX_LATERAL_RADIUS; j++) {
      const w = sample(pr, j * spacing);
      lateral[centre + j] = w;
      lateral[centre - j] = w;
      if (Math.abs(w) >= TAP_FLOOR * peak) R = j;
    }
    for (let j = R + 1; j <= MAX_LATERAL_RADIUS; j++) lateral[centre + j] = lateral[centre - j] = 0;
    unitEnergy(lateral, centre - R, centre + R + 1);
    lateralRadius[si] = R;
  }
  const k: PsfKernels = { key, axialRadius, axial, lateralRadius, lateral };
  cache.set(key, k);
  return k;
}

/** Scales taps [from, to) to unit energy. */
function unitEnergy(t: Float32Array, from: number, to: number): void {
  let e = 0;
  for (let i = from; i < to; i++) e += t[i]! * t[i]!;
  const s = e > 0 ? 1 / Math.sqrt(e) : 0;
  for (let i = from; i < to; i++) t[i] = t[i]! * s;
}
