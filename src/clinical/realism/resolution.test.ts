import { describe, expect, it } from 'vitest';
import { cnr, contrastDb, gcnr, onGrid, widthAtLevel } from './resolution';
import { RAYLEIGH_SNR } from './speckleStats';
import { seededRandom } from './turing';

const gaussian = (sigma: number, step: number, n = 201): number[] =>
  Array.from({ length: n }, (_, i) =>
    Math.exp(-(((i - (n - 1) / 2) * step) ** 2) / (2 * sigma * sigma)),
  );

describe('widthAtLevel', () => {
  it('gives the FWHM of a Gaussian (2.3548 σ) at −6 dB, finely and coarsely sampled', () => {
    expect(widthAtLevel(gaussian(1, 0.01, 1001), 0.01)).toBeCloseTo(2.3548, 2);
    // two samples per FWHM: linear interpolation between them errs by a few per cent
    const coarse = widthAtLevel(gaussian(1, 1.2, 21), 1.2);
    expect(coarse / 2.3548).toBeGreaterThan(0.9);
    expect(coarse / 2.3548).toBeLessThan(1.1);
  });
  it('reads −20 dB wider than −6 dB and NaN when a side never falls under the level', () => {
    const g = gaussian(1, 0.01, 1001);
    expect(widthAtLevel(g, 0.01, -20)).toBeCloseTo(2 * Math.sqrt(2 * Math.log(10)), 2);
    expect(widthAtLevel([1, 2, 3], 1)).toBeNaN();
  });
});

describe('cyst figures', () => {
  const rand = seededRandom(3);
  const outside = Array.from({ length: 50_000 }, () =>
    Math.sqrt(-Math.log(Math.max(1e-300, rand()))),
  );
  it('an anechoic cyst in Rayleigh speckle reaches CNR 1.91 and gCNR 1', () => {
    const inside = new Array<number>(5000).fill(0);
    expect(cnr(inside, outside)).toBeCloseTo(RAYLEIGH_SNR, 1);
    expect(gcnr(inside, outside)).toBeGreaterThan(0.98);
  });
  it('contrast in dB and gCNR of two equal distributions', () => {
    expect(contrastDb([0.1, 0.1], [1, 1])).toBeCloseTo(-20, 10);
    expect(gcnr(outside.slice(0, 25_000), outside.slice(25_000))).toBeLessThan(0.05);
  });
});

describe('onGrid (decision 355)', () => {
  it('reads a curve at the grid’s points around an origin, interpolating between its samples', () => {
    // a line is read exactly at any point
    const line = Array.from({ length: 101 }, (_, i) => 3 + 0.5 * i);
    const g = onGrid(line, 0.02, 0.5, 40);
    // origin 40, step 25 samples: 15, 40, 65, 90
    expect(Array.from(g)).toEqual([10.5, 23, 35.5, 48]);
    // a step that falls between samples
    const h = onGrid(line, 0.1, 0.25, 0);
    expect(h.length).toBe(41);
    expect(h[1]).toBeCloseTo(3 + 0.5 * 2.5, 12);
    expect(h[40]).toBeCloseTo(53, 12);
    // the same spacing gives the curve back
    expect(Array.from(onGrid(line, 1, 1, 7))).toEqual(line);
  });

  it('shows a point on a sample as the simulator’s grid does', () => {
    // a Gaussian pulse of FWHM 0.636 mm, on a 0.5 mm grid with the point on a sample
    const sigma = 0.636 / 2.3548,
      step = 0.01;
    const pulse = gaussian(sigma, step, 601);
    expect(widthAtLevel(pulse, step)).toBeCloseTo(0.636, 2);
    const onSamples = onGrid(pulse, step, 0.5, 300);
    expect(onSamples[Math.floor(onSamples.length / 2)]).toBeCloseTo(1, 12);
    // its neighbours at ±0.5 mm read v; the −6 dB crossing (L = 10^(−6/20)) falls 0.5·(1 − L)/(1 − v) from the peak
    const v = Math.exp(-0.25 / (2 * sigma * sigma)),
      level = Math.pow(10, -6 / 20);
    expect(widthAtLevel(onSamples, 0.5)).toBeCloseTo((2 * 0.5 * (1 - level)) / (1 - v), 9);
    expect(widthAtLevel(onSamples, 0.5)).toBeLessThan(0.636);
  });
});
