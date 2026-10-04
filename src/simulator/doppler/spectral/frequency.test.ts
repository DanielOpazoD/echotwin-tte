import { describe, expect, it } from 'vitest';
import { DEFAULT_SPECTRAL, SPECTRAL_BINS, displaySpectrum, estimateDurationS } from './spectrum';

describe('spectral ensemble timing follows the transmitted fundamental', () => {
  it('counts 128 pulse intervals without hiding long TDI ensembles behind a 30 ms clamp', () => {
    for (const frequencyMHz of [1.5, 2.5, 5]) {
      for (const scaleMps of [0.1, 0.6, 1.2]) {
        const duration = estimateDurationS({ ...DEFAULT_SPECTRAL, scaleMps }, frequencyMHz, 1);
        const prfHz = (4 * frequencyMHz * 1e6 * scaleMps) / 1540;
        expect(duration * prfHz).toBeCloseTo(128, 10);
      }
    }
  });

  it('spends more elapsed time on an ensemble when duplex leaves gaps, without lowering instantaneous Nyquist', () => {
    const s = { ...DEFAULT_SPECTRAL, scaleMps: 0.6 };
    const full = estimateDurationS(s, 2.5, 1);
    expect(estimateDurationS(s, 2.5, 0.75)).toBeCloseTo(full / 0.75, 12);
    const expected = new Float32Array(SPECTRAL_BINS).fill(0.3);
    const a = new Float32Array(SPECTRAL_BINS);
    const b = new Float32Array(SPECTRAL_BINS);
    displaySpectrum(expected, s, 11, 0, 0.017, a, 2.5, 1);
    displaySpectrum(expected, s, 11, 0, 0.017 / 0.75, b, 2.5, 0.75);
    expect(b).toEqual(a);
  });

  it('has the same grain at equal ensemble age, while preserving expected velocity power', () => {
    const expected = new Float32Array(SPECTRAL_BINS).fill(0.3);
    const s = { ...DEFAULT_SPECTRAL, scaleMps: 0.6 };
    const a = new Float32Array(SPECTRAL_BINS);
    const b = new Float32Array(SPECTRAL_BINS);
    const changed = new Float32Array(SPECTRAL_BINS);
    displaySpectrum(expected, s, 11, 0, 0.017, a, 2.5, 1);
    displaySpectrum(expected, s, 11, 0, 0.0085, b, 5, 1);
    displaySpectrum(expected, s, 11, 0, 0.017, changed, 5, 1);
    expect(b).toEqual(a);
    expect(changed).not.toEqual(a);
    expect(expected.every((v) => Math.abs(v - 0.3) < 1e-6)).toBe(true);
  });
});
