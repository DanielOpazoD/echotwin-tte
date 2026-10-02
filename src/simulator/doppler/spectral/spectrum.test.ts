import { describe, expect, it } from 'vitest';
import { accumulateSpectrum, DEFAULT_SPECTRAL, SPECTRAL_BINS, spectralRange } from './spectrum';

/**
 * Turbulent spread stops at the baseline (decision 246). A turbulent stenotic jet spreads toward lower speeds, down to zero;
 * a Gaussian tail that crossed the baseline filled the opposite channel of continuous wave: in the core's CW of the severe
 * stenosis the band from +0.2 to +1.5 m/s shone at 71 % of the jet in mid-systole.
 */
describe('spectral distribution of one turbulent sample (decision 246)', () => {
  const s = { ...DEFAULT_SPECTRAL, scaleMps: 6, wallFilterMps: 0.2 };
  const { vMin, vMax } = spectralRange(s);
  const vOf = (b: number) => vMax - ((b + 0.5) / SPECTRAL_BINS) * (vMax - vMin);
  const column = (aliasing: boolean) => {
    const out = new Float32Array(SPECTRAL_BINS);
    // a 4.4 m/s jet away from the transducer, as turbulent as a severe stenosis
    accumulateSpectrum([{ v: -4.4, weight: 1, dispersion: 0.6 }], s, aliasing, out);
    return out;
  };

  it('in continuous wave it fills the window down to the baseline and stops there', () => {
    const out = column(false);
    let toward = 0,
      away = 0,
      nearZero = 0;
    for (let b = 0; b < SPECTRAL_BINS; b++) {
      const v = vOf(b);
      if (v > 0.2) toward += out[b]!;
      else if (v < -0.2) away += out[b]!;
      if (v < 0 && v > -0.5) nearZero = Math.max(nearZero, out[b]!);
    }
    expect(toward / away).toBeLessThan(0.01);
    // still filled under the envelope, close to the baseline
    expect(nearZero).toBeGreaterThan(0.05);
  });
});
