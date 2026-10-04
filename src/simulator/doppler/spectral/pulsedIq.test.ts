// @tier fast
import { describe, expect, it } from 'vitest';
import { SPEED_OF_SOUND_MPS } from '@/core/units';
import { accumulatePulsedSpectrum, complexFft, pulsedPacketTiming, synthesizeIq } from './pulsedIq';
import { accumulateSpectrum, DEFAULT_SPECTRAL, SPECTRAL_BINS, spectralRange } from './spectrum';

const peak = (a: Float32Array, s = DEFAULT_SPECTRAL) => {
  let b = 0;
  for (let i = 1; i < a.length; i++) if (a[i]! > a[b]!) b = i;
  const { vMin, vMax } = spectralRange(s);
  return vMax - ((b + 0.5) * (vMax - vMin)) / a.length;
};
const sum = (a: Float32Array) => a.reduce((v, x) => v + x, 0);
const column = (v: number, frequencyMHz = 2.5, settings = {}) => {
  const s = { ...DEFAULT_SPECTRAL, wallFilterMps: 0, ...settings },
    out = new Float32Array(SPECTRAL_BINS);
  accumulatePulsedSpectrum([{ v, weight: 1, dispersion: 0 }], s, frequencyMHz, 42, 0, out);
  return { out, s };
};

describe('pulsed complex slow-time acquisition', () => {
  it('FFT agrees with an independent direct transform, including phase and negative frequency', () => {
    const re = Float64Array.from(
      { length: 16 },
      (_, i) => Math.sin(i * 0.73) + 0.3 * Math.cos(i * 1.3),
    );
    const im = Float64Array.from({ length: 16 }, (_, i) => Math.cos(i * 0.41));
    const r = new Float64Array(re),
      q = new Float64Array(im);
    complexFft(re, im);
    for (let k = 0; k < 16; k++) {
      let er = 0,
        ei = 0;
      for (let j = 0; j < 16; j++) {
        const a = (-2 * Math.PI * k * j) / 16;
        er += r[j]! * Math.cos(a) - q[j]! * Math.sin(a);
        ei += r[j]! * Math.sin(a) + q[j]! * Math.cos(a);
      }
      expect(re[k]).toBeCloseTo(er, 10);
      expect(im[k]).toBeCloseTo(ei, 10);
    }
  });
  it('physical phase increments follow fD=2 f0 v/c and the acquired PRF', () => {
    for (const frequency of [1.5, 2.5, 5]) {
      const { prfHz, durationS } = pulsedPacketTiming(1, frequency),
        r = new Float64Array(128),
        i = new Float64Array(128);
      synthesizeIq([{ velocityMps: 0.4, power: 1, phaseRad: 0 }], frequency, prfHz, 0, r, i);
      const phase = Math.atan2(i[1]!, r[1]!);
      expect(phase).toBeCloseTo(
        (2 * Math.PI * ((2 * frequency * 1e6 * 0.4) / SPEED_OF_SOUND_MPS)) / prfHz,
        12,
      );
      expect(durationS).toBeCloseTo(128 / prfHz, 12);
    }
    expect(pulsedPacketTiming(1, 5).durationS).toBeCloseTo(
      pulsedPacketTiming(1, 2.5).durationS / 2,
      12,
    );
  });
  it('measures both directions, aliasing, inversion and baseline without moving the filter band', () => {
    for (const frequency of [1.5, 2.5, 5])
      for (const v of [-0.73, 0.42, 1.42, -1.73]) {
        const expected = ((((v + 1) % 2) + 2) % 2) - 1;
        const { out, s } = column(v, frequency);
        expect(Math.abs(peak(out, s) - expected)).toBeLessThan(2 / 128);
        const inverted = column(v, frequency, { invert: true });
        expect(Math.abs(peak(inverted.out, inverted.s) + expected)).toBeLessThan(2 / 128);
      }
    const shifted = column(1.42, 2.5, { baselineShiftMps: 0.6 });
    expect(Math.abs(peak(shifted.out, shifted.s) - 1.42)).toBeLessThan(2 / 128);
  });
  it('rejects a fast signal aliased into the wall filter, including after baseline shift', () => {
    for (const baselineShiftMps of [0, 0.6]) {
      const s = { ...DEFAULT_SPECTRAL, baselineShiftMps },
        legacy = new Float32Array(128);
      accumulateSpectrum([{ v: 2, weight: 1, dispersion: 0 }], s, true, legacy);
      const corrected = column(2, 2.5, s).out;
      expect(sum(legacy)).toBeGreaterThan(0.1);
      expect(sum(corrected)).toBeLessThan(1e-10);
      expect(sum(column(0.4, 2.5, s).out)).toBeGreaterThan(0.1);
    }
  });
  it('Vmax and VTI of a prescribed half-sine pulse are recovered from independent packet peaks', () => {
    const vmax = 0.8,
      duration = 0.3,
      dt = 0.002;
    let measuredPeak = 0,
      vti = 0;
    for (let t = 0; t < duration; t += dt) {
      const v = vmax * Math.sin((Math.PI * (t + 0.5 * dt)) / duration),
        { out, s } = column(v);
      const measured = Math.max(0, peak(out, s));
      measuredPeak = Math.max(measuredPeak, measured);
      vti += measured * dt;
    }
    expect(Math.abs(measuredPeak / vmax - 1)).toBeLessThan(0.02);
    expect(Math.abs(vti / ((2 * vmax * duration) / Math.PI) - 1)).toBeLessThan(0.02);
  });
  it('oblique velocity projection changes measured speed, and empty gates have no signal power', () => {
    for (const angle of [0, 30, 60, 90]) {
      const v = 0.8 * Math.cos((angle * Math.PI) / 180),
        { out, s } = column(v);
      expect(Math.abs(peak(out, s) - v)).toBeLessThan(2 / 128);
    }
    const out = new Float32Array(128);
    accumulatePulsedSpectrum([], DEFAULT_SPECTRAL, 2.5, 42, 0, out);
    expect(sum(out)).toBe(0);
  });
});

it('subgrid half-normal deceleration has its analytical mean, without Rayleigh modal bias', () => {
  const s = { ...DEFAULT_SPECTRAL, wallFilterMps: 0 },
    out = new Float32Array(128);
  let weighted = 0,
    power = 0;
  for (let i = 0; i < 64; i++) {
    accumulatePulsedSpectrum([{ v: 0.8, weight: 1, dispersion: 0.2 }], s, 2.5, 42, i * 0.003, out);
    for (let b = 0; b < 128; b++) {
      const v = 1 - ((b + 0.5) * 2) / 128;
      weighted += v * out[b]!;
      power += out[b]!;
    }
  }
  const expected = 0.8 - 0.9 * 0.2 * 0.8 * Math.sqrt(2 / Math.PI);
  expect(Math.abs(weighted / power - expected)).toBeLessThan(2 / 128);
});
