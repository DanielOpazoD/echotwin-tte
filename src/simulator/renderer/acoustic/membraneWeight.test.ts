import { describe, expect, it } from 'vitest';
import { MEMBRANE_CM, membraneWeight } from './acoustics';
import { sliceHalfWidthCm } from './psf';

/**
 * A valve leaflet is a membrane thinner than the slice (decision 147): it reads in full where it stands across the
 * imaging plane and by the fraction of the slice it fills where it lies in the plane, so a coaptation surface seen
 * face-on no longer fills the root with tissue.
 */
describe('thin-membrane partial volume', () => {
  it('reads in full edge-on and by thickness over slice thickness face-on', () => {
    for (const e of [0.1, 0.2, 0.3]) {
      expect(membraneWeight(0, e)).toBe(1);
      expect(membraneWeight(1, e)).toBeCloseTo(MEMBRANE_CM / (MEMBRANE_CM + 2 * e), 10);
      expect(membraneWeight(-1, e)).toBeCloseTo(membraneWeight(1, e), 12);
    }
  });

  it('falls monotonically as the membrane turns into the plane, and thicker slices weigh it less', () => {
    let previous = 1;
    for (let c = 0; c <= 1; c += 0.05) {
      const w = membraneWeight(c, 0.2);
      expect(w).toBeLessThanOrEqual(previous + 1e-12);
      expect(w).toBeGreaterThan(0);
      previous = w;
    }
    expect(membraneWeight(1, 0.3)).toBeLessThan(membraneWeight(1, 0.15));
  });

  it('at the focus of a 2.5 MHz beam a face-on cusp keeps about a fifth of its echo, a tilted one about half', () => {
    const e = sliceHalfWidthCm(9, 9);
    expect(membraneWeight(1, e)).toBeGreaterThan(0.12);
    expect(membraneWeight(1, e)).toBeLessThan(0.3);
    expect(membraneWeight(Math.cos(Math.PI / 3), e)).toBeGreaterThan(0.25);
    expect(membraneWeight(Math.cos(Math.PI / 3), e)).toBeLessThan(0.55);
  });
});
