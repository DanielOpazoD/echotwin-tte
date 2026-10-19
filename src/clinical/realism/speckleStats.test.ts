import { describe, expect, it } from 'vitest';
import {
  envelopeSnr,
  impliedDynamicRangeDb,
  iqrDistance,
  kAlphaFromEnvelope,
  logMoments,
  moments,
  nakagamiLogExcessKurtosis,
  nakagamiLogSkew,
  nakagamiMFromLogSkew,
  pearson,
  polygamma,
  quantiles,
  RAYLEIGH_LOG_SKEW,
  RAYLEIGH_LOG_STD_DB,
  RAYLEIGH_SNR,
  windowedSnr,
} from './speckleStats';
import { seededRandom } from './turing';

const rand = seededRandom(7);
const exp1 = (): number => -Math.log(Math.max(1e-300, rand()));
/** Rayleigh amplitudes: √ of an exponential intensity. */
const rayleigh = (n: number): Float64Array =>
  Float64Array.from({ length: n }, () => Math.sqrt(exp1()));
/** K amplitudes of integer shape α: intensity = exponential × Gamma(α)/α. */
const kAmplitudes = (n: number, alpha: number): Float64Array =>
  Float64Array.from({ length: n }, () => {
    let g = 0;
    for (let i = 0; i < alpha; i++) g += exp1();
    return Math.sqrt((exp1() * g) / alpha);
  });

describe('polygamma', () => {
  it('matches the closed forms at 1 and ½', () => {
    expect(polygamma(1, 1)).toBeCloseTo(Math.PI ** 2 / 6, 9);
    expect(polygamma(2, 1)).toBeCloseTo(-2 * 1.2020569031595942, 9);
    expect(polygamma(3, 1)).toBeCloseTo(Math.PI ** 4 / 15, 8);
    expect(polygamma(1, 0.5)).toBeCloseTo(Math.PI ** 2 / 2, 9);
  });
  it('keeps the recurrence ψ₁(x) = ψ₁(x+1) + 1/x²', () => {
    for (const x of [0.3, 2.7, 9.1])
      expect(polygamma(1, x)).toBeCloseTo(polygamma(1, x + 1) + 1 / x ** 2, 10);
  });
});

describe('Rayleigh speckle', () => {
  it('has the textbook constants', () => {
    expect(RAYLEIGH_SNR).toBeCloseTo(1.913, 3);
    expect(RAYLEIGH_LOG_SKEW).toBeCloseTo(-1.1395, 4);
    expect(RAYLEIGH_LOG_STD_DB).toBeCloseTo(5.57, 2);
    expect(nakagamiLogExcessKurtosis(1)).toBeCloseTo(2.4, 1);
  });
  it('reads SNR 1.91 and Nakagami m 1 from simulated Rayleigh amplitudes', () => {
    const a = rayleigh(200_000);
    expect(envelopeSnr(a)).toBeCloseTo(RAYLEIGH_SNR, 1);
    const m = nakagamiMFromLogSkew(logMoments(a).skewness);
    expect(m).toBeGreaterThan(0.93);
    expect(m).toBeLessThan(1.07);
    expect(kAlphaFromEnvelope(a)).toBeGreaterThan(30);
  });
  it('recovers the dynamic range a log-compressed grey was made with', () => {
    const a = rayleigh(100_000);
    const DR = 60;
    // grey linear in dB over DR, 0 dB at grey 255, no clipping inside the band used
    const grey = Float64Array.from(a, (v) => 200 + (255 / DR) * 20 * Math.log10(v));
    const m = nakagamiMFromLogSkew(moments(grey).skewness);
    expect(impliedDynamicRangeDb(moments(grey).std, m)).toBeCloseTo(DR, -0.5);
  });
});

describe('Nakagami and K fits', () => {
  it('inverts the log-skewness of a Nakagami amplitude', () => {
    for (const m of [0.4, 1, 2, 5])
      expect(nakagamiMFromLogSkew(nakagamiLogSkew(m))).toBeCloseTo(m, 4);
    expect(nakagamiMFromLogSkew(0.3)).toBeNaN();
  });
  it('reads a K shape from the intensity moments of K amplitudes', () => {
    const alpha = kAlphaFromEnvelope(kAmplitudes(300_000, 2));
    expect(alpha).toBeGreaterThan(1.7);
    expect(alpha).toBeLessThan(2.3);
  });
});

describe('windowedSnr', () => {
  it('reads uniform speckle near its SNR, biased low by small windows, and skips windows outside the mask', () => {
    const lines = 60,
      samples = 70;
    const a = rayleigh(lines * samples);
    const big = windowedSnr(a, () => true, lines, samples, 10, 14);
    expect(big.median).toBeGreaterThan(1.6);
    expect(big.median).toBeLessThan(2.1);
    const half = windowedSnr(a, (i) => Math.floor(i / samples) < 30, lines, samples, 10, 14);
    expect(half.windows).toBe(big.windows / 2);
  });
});

describe('summaries', () => {
  it('quantiles, IQR distance and Pearson', () => {
    const qs = quantiles([5, 1, 4, 2, 3, NaN]);
    expect(qs.n).toBe(5);
    expect(qs.median).toBe(3);
    expect(iqrDistance(6, { p25: 2, median: 3, p75: 4 })).toBe(1.5);
    expect(pearson([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 12);
    expect(pearson([1, 2, 3], [3, 2, 1])).toBeCloseTo(-1, 12);
  });
});
