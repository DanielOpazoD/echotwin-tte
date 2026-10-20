import { describe, expect, it } from 'vitest';
import { followMaterial, type MaterialField, type Point } from './materialStrain';
import { polylineLength } from './speckleTracking';

const C = { x: 320, y: 200 };
/** Rounded to cells of 3 px: the 1 mm voxels of the volume heart on the bench's 0.34 mm pixels. */
const voxel = (v: number): number => 3 * Math.round(v / 3);
/** A U-shaped line of points on a voxel staircase: an ellipse's half, as a contour drawn on a voxel volume. */
const staircase = (): Point[] => {
  const pts: Point[] = [];
  for (let k = 0; k <= 60; k++) {
    const a = Math.PI * (k / 60);
    pts.push({ x: voxel(C.x + 70 * Math.cos(a)), y: voxel(C.y + 180 * Math.sin(a)) });
  }
  return pts;
};
/** The field of a tissue scaled by s (x) and t (y) about C and turned by phi: each point's position at the first frame. */
const affine =
  (s: number, t: number, phi = 0, w = 0): MaterialField =>
  (x, y) => {
    const dx = x - C.x,
      dy = y - C.y;
    const c = Math.cos(-phi),
      n = Math.sin(-phi);
    return [C.x + (c * dx - n * dy) / s, C.y + (n * dx + c * dy) / t, w];
  };
const strainOf = (positions: Point[][], f: number): number =>
  (100 * (polylineLength(positions[f]!) - polylineLength(positions[0]!))) /
  polylineLength(positions[0]!);

describe('followMaterial (decision 361)', () => {
  it('finds the tissue of a staircase line where a uniform contraction took it: the strain is the tissue’s', () => {
    const { positions, lost } = followMaterial(
      [affine(1, 1), affine(0.9, 0.9), affine(0.8, 0.8)],
      staircase(),
    );
    expect(lost).toBe(0);
    expect(strainOf(positions, 1)).toBeCloseTo(-10, 2);
    expect(strainOf(positions, 2)).toBeCloseTo(-20, 2);
    // the line redrawn on the voxels of the contracted ellipse, as a contour of each frame is, reads another strain
    const redrawn = staircase().map((p) => ({
      x: voxel(C.x + 0.8 * (p.x - C.x)),
      y: voxel(C.y + 0.8 * (p.y - C.y)),
    }));
    const redrawnStrain =
      (100 * (polylineLength(redrawn) - polylineLength(staircase()))) / polylineLength(staircase());
    expect(Math.abs(redrawnStrain + 20)).toBeGreaterThan(1);
  });

  it('carries each point with an anisotropic shortening and a twist', () => {
    const start = staircase();
    const { positions } = followMaterial([affine(1, 1), affine(0.7, 0.85, 0.12)], start);
    start.forEach((p, i) => {
      const dx = 0.7 * (p.x - C.x),
        dy = 0.85 * (p.y - C.y);
      expect(positions[1]![i]!.x).toBeCloseTo(C.x + Math.cos(0.12) * dx - Math.sin(0.12) * dy, 3);
      expect(positions[1]![i]!.y).toBeCloseTo(C.y + Math.sin(0.12) * dx + Math.cos(0.12) * dy, 3);
    });
  });

  it('solves a nonlinear field: the radial contraction of the volume heart (r₀² = λr² + A)', () => {
    const lambda = 0.85,
      A = 4000;
    const field: MaterialField = (x, y) => {
      const dx = x - C.x,
        dy = y - C.y,
        r = Math.hypot(dx, dy);
      const r0 = Math.sqrt(lambda * r * r + A);
      return [C.x + (dx * r0) / r, C.y + (dy * r0) / r, 0];
    };
    const start = [
      { x: C.x + 90, y: C.y },
      { x: C.x, y: C.y + 120 },
      { x: C.x - 60, y: C.y - 70 },
    ];
    const { positions, lost } = followMaterial([affine(1, 1), field], start);
    expect(lost).toBe(0);
    start.forEach((p, i) => {
      const m = field(positions[1]![i]!.x, positions[1]![i]!.y)!;
      expect(Math.hypot(m[0] - p.x, m[1] - p.y)).toBeLessThan(1e-3);
      expect(Math.hypot(positions[1]![i]!.x - C.x, positions[1]![i]!.y - C.y)).toBeLessThan(
        Math.hypot(p.x - C.x, p.y - C.y),
      );
    });
  });

  it('puts tissue that left the plane where the plane comes closest to it', () => {
    const start = staircase();
    const { positions } = followMaterial([affine(1, 1), affine(0.8, 0.8, 0, 0.6)], start);
    start.forEach((p, i) => {
      expect(positions[1]![i]!.x).toBeCloseTo(C.x + 0.8 * (p.x - C.x), 3);
      expect(positions[1]![i]!.y).toBeCloseTo(C.y + 0.8 * (p.y - C.y), 3);
    });
  });

  it('loses a point whose tissue would have to jump further than the frame allows', () => {
    const start = [
      { x: C.x + 10, y: C.y + 100 },
      { x: C.x + 60, y: C.y + 150 },
    ];
    // one frame contracts by 0.8 about C: the first point moves 20 px, the second 32 px
    const free = followMaterial([affine(1, 1), affine(0.8, 0.8)], start);
    expect(free.kept).toEqual([true, true]);
    const bounded = followMaterial([affine(1, 1), affine(0.8, 0.8)], start, 25);
    expect(bounded.kept).toEqual([true, false]);
    expect(bounded.lost).toBe(1);
    expect(bounded.positions[1]![1]).toEqual(start[1]);
    expect(bounded.positions[1]![0]!.y).toBeCloseTo(C.y + 80, 3);
  });

  it('counts a point whose tissue the field loses, once, and keeps it where it was', () => {
    const inside = affine(0.8, 0.8);
    const field: MaterialField = (x, y) => (x > C.x + 50 ? null : inside(x, y));
    const start = [
      { x: C.x + 10, y: C.y + 100 },
      { x: C.x + 69, y: C.y },
    ];
    const { positions, kept, lost } = followMaterial([affine(1, 1), field, field], start);
    expect(lost).toBe(1);
    expect(kept).toEqual([true, false]);
    expect(positions[2]![1]).toEqual(start[1]);
    expect(positions[2]![0]!.y).toBeCloseTo(C.y + 80, 3);
  });
});
