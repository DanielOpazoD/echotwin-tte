import { describe, expect, it } from 'vitest';
import { cnr, contrastDb, gcnr, widthAtLevel } from './resolution';
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
