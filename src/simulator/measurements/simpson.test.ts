import { describe, expect, it } from 'vitest';
import { discProfileFromContour } from './simpson';
import { simpsonBiplaneVolume, simpsonSinglePlaneVolume } from '@/clinical/formulas';

describe('method of discs from a traced contour', () => {
  it('reproduces the volume of a prolate half-ellipsoid (bullet-shaped LV) within 3 %', () => {
    // half-ellipsoid: semi-axes a (radius) and L (length); contour from base (y=0) around the apex
    const a = 2.4,
      L = 8.0,
      pxPerCm = 20;
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i <= 60; i++) {
      const th = -Math.PI / 2 + (Math.PI * i) / 60; // from base-left to base-right through the apex
      pts.push({ x: 300 + a * Math.sin(th) * pxPerCm, y: 100 + L * Math.cos(th) * pxPerCm });
    }
    const prof = discProfileFromContour(pts, pxPerCm)!;
    expect(prof.longAxisCm).toBeCloseTo(L, 1);
    const vol = simpsonSinglePlaneVolume(prof.diametersCm, prof.longAxisCm);
    const exact = (2 / 3) * Math.PI * a * a * L; // half of a prolate spheroid 4/3·π·a²·L
    expect(Math.abs(vol - exact) / exact).toBeLessThan(0.03);
    // biplane with the same contour = same volume
    expect(simpsonBiplaneVolume(prof.diametersCm, prof.diametersCm, prof.longAxisCm)).toBeCloseTo(vol, 6);
  });
  it('returns null for too few points and is orientation independent', () => {
    expect(discProfileFromContour([{ x: 0, y: 0 }, { x: 1, y: 1 }], 10)).toBeNull();
    const a = 2,
      L = 6,
      pxPerCm = 10;
    const mk = (rot: number) =>
      Array.from({ length: 41 }, (_, i) => {
        const th = -Math.PI / 2 + (Math.PI * i) / 40;
        const x = a * Math.sin(th),
          y = L * Math.cos(th);
        return { x: 200 + (x * Math.cos(rot) - y * Math.sin(rot)) * pxPerCm, y: 200 + (x * Math.sin(rot) + y * Math.cos(rot)) * pxPerCm };
      });
    const v0 = simpsonSinglePlaneVolume(discProfileFromContour(mk(0), pxPerCm)!.diametersCm, L);
    const v1 = simpsonSinglePlaneVolume(discProfileFromContour(mk(1.1), pxPerCm)!.diametersCm, L);
    expect(Math.abs(v0 - v1) / v0).toBeLessThan(0.02);
  });
});
