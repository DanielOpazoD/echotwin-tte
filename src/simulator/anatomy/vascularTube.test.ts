import { describe, expect, it } from 'vitest';
import { compileVascularTube, vascularTubeDistance, type TubeDistance } from './vascularTube';

const result = (): TubeDistance => ({ distance: Infinity, nx: 0, ny: 0, nz: 0, segment: -1 });
describe('shared swept vascular lumen', () => {
  it('preserves cylinder radius, normals and spherical terminal cap', () => {
    const tube = compileVascularTube(
        [
          [
            { p: { x: 0, y: 0, z: 0 }, radiusCm: 1 },
            { p: { x: 0, y: 0, z: 4 }, radiusCm: 1 },
          ],
        ],
        0.7,
      ),
      q = result();
    for (const [x, y, z, expected] of [
      [0.5, 0, 2, -0.5],
      [0, 1.2, 2, 0.2],
      [0, 0, 4.5, -0.5],
    ]) {
      expect(vascularTubeDistance(tube, x!, y!, z!, q)).toBe(true);
      expect(q.distance).toBeCloseTo(expected!, 6);
      expect(Math.hypot(q.nx, q.ny, q.nz)).toBeCloseTo(1, 6);
    }
    expect(vascularTubeDistance(tube, 10, 0, 0, q)).toBe(false);
  });
  it('queries the union through an open branch ostium and keeps segment identity', () => {
    const tube = compileVascularTube(
        [
          [
            { p: { x: 0, y: 0, z: 0 }, radiusCm: 1 },
            { p: { x: 0, y: 0, z: 4 }, radiusCm: 1 },
          ],
          [
            { p: { x: 0, y: 0, z: 2 }, radiusCm: 0.5 },
            { p: { x: 3, y: 0, z: 2 }, radiusCm: 0.5 },
          ],
        ],
        0.7,
      ),
      q = result();
    for (let x = 0; x < 3; x += 0.05) {
      expect(vascularTubeDistance(tube, x, 0, 2, q)).toBe(true);
      expect(q.distance).toBeLessThan(0);
    }
    vascularTubeDistance(tube, 2, 0.2, 2, q);
    expect(q.segment).toBe(1);
    expect(q.distance).toBeCloseTo(-0.3, 6);
  });
  it('rejects invalid geometry before it reaches a shader', () => {
    expect(() =>
      compileVascularTube([[{ p: { x: NaN, y: 0, z: 0 }, radiusCm: 1 }]], 0.2),
    ).toThrow();
    expect(() => compileVascularTube([[{ p: { x: 0, y: 0, z: 0 }, radiusCm: 0 }]], 0.2)).toThrow();
  });
});
