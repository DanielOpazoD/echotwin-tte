import { describe, expect, it } from 'vitest';
import { LABEL, type RegionImage } from '../regionStats';
import { regionResidual } from './regionTexture';
import { moments } from './speckleStats';
import { seededRandom } from './turing';

function image(grey: (x: number, y: number) => number, w = 120, h = 120): RegionImage {
  const g = new Float32Array(w * h),
    labels = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      g[x + y * w] = grey(x, y);
      if (x >= 20 && x < 100 && y >= 20 && y < 100) labels[x + y * w] = LABEL.myocardium;
    }
  return { width: w, height: h, grey: g, labels, mmPerPx: [0.5, 0.5] };
}

describe('regionResidual', () => {
  it('is zero on a constant region and keeps only the eroded interior', () => {
    const r = regionResidual(
      image(() => 100),
      LABEL.myocardium,
      2,
    );
    expect(r.length).toBe(76 * 76);
    expect(Math.max(...r.map(Math.abs))).toBeLessThan(1e-9);
  });
  it('removes a slow ramp and keeps the shape of the texture on it', () => {
    const rand = seededRandom(2);
    const noise = Float64Array.from(
      { length: 120 * 120 },
      () => -Math.log(Math.max(1e-12, rand())) * 10,
    );
    const flat = moments(regionResidual(image((x, y) => 60 + noise[x + 120 * y]!)));
    const ramp = moments(regionResidual(image((x, y) => 60 + 0.8 * x + noise[x + 120 * y]!)));
    expect(ramp.std).toBeCloseTo(flat.std, 0);
    expect(ramp.skewness).toBeCloseTo(flat.skewness, 1);
    expect(flat.skewness).toBeGreaterThan(1.5);
  });
  it('skips pixels clipped at the black or white end', () => {
    const r = regionResidual(image((x) => (x % 2 ? 255 : 100)));
    expect(r.length).toBe(Math.floor((76 * 76) / 2));
  });
});
