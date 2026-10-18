// @tier fast
/**
 * Review mode's regions (decision 340), on a synthetic polar map: the piece of the structure a click picks is the
 * connected run of it, not every piece; its outline is its edge; a lasso holds the cells whose centre it encloses, with
 * their area and shares; a long hand-drawn path is thinned.
 */
import { describe, expect, it } from 'vitest';
import {
  cellAt,
  cellAreaCm2,
  cellCentre,
  insideLasso,
  lassoCells,
  lassoCentroid,
  LASSO_MAX_POINTS,
  regionOutline,
  regionSummary,
  structureComponent,
  thinLasso,
  type PolarMap,
} from './reviewRegion';

/**
 * 40 lines × 100 samples, 1 rad, 10 cm: structure 5 in two separate blocks, 9 glued to the first one's deep side, 7 in a
 * block of its own, 0 elsewhere.
 */
function map(): PolarMap {
  const lines = 40,
    samples = 100;
  const structure = new Uint8Array(lines * samples);
  for (let li = 0; li < lines; li++)
    for (let si = 0; si < samples; si++) {
      const c = li * samples + si;
      if (li >= 5 && li < 15 && si >= 30 && si < 50) structure[c] = 5;
      if (li >= 25 && li < 35 && si >= 30 && si < 50) structure[c] = 5;
      if (li >= 15 && li < 25 && si >= 60 && si < 80) structure[c] = 7;
      if (li >= 5 && li < 15 && si >= 50 && si < 55) structure[c] = 9;
    }
  return { lines, samples, sectorRad: 1, depthCm: 10, structure };
}

describe('review regions (decision 340)', () => {
  it('picks the connected piece of the structure under the click, not its other pieces', () => {
    const p = map();
    const c = cellCentre(p, 10 * 100 + 40);
    const piece = structureComponent(p, cellAt(p, c.rCm, c.thetaRad));
    expect(piece.length).toBe(10 * 20);
    expect([...piece].every((k) => Math.floor(k / 100) < 15 && k % 100 < 50)).toBe(true);
    // its outline is the block's edge: 2 × 10 + 2 × 18 cells
    expect(regionOutline(p, piece).length).toBe(2 * 20 + 2 * 8);
  });

  it('summarises a region by area, shares and grey', () => {
    const p = map();
    const piece = structureComponent(p, 20 * 100 + 70);
    const area = [...piece].reduce((a, k) => a + cellAreaCm2(p, k), 0);
    const s = regionSummary(p, piece, () => 100)!;
    expect(s.areaCm2).toBeCloseTo(area, 6);
    expect(s.structures).toEqual([{ id: 7, share: 1 }]);
    expect(s.grey).toEqual({ p10: 100, median: 100, p90: 100 });
    expect(regionSummary(p, new Int32Array(0))).toBeNull();
  });

  it('holds in a lasso the cells whose centre it encloses, with the shares of what they are', () => {
    const p = map();
    // a lasso around the middle block (lines 15–25, samples 60–80) and half of the empty band beside it
    const poly = [
      { rCm: 5.5, thetaRad: -0.15 },
      { rCm: 5.5, thetaRad: 0.15 },
      { rCm: 8.5, thetaRad: 0.15 },
      { rCm: 8.5, thetaRad: -0.15 },
    ];
    expect(insideLasso(poly, 7, 0)).toBe(true);
    expect(insideLasso(poly, 7, 0.4)).toBe(false);
    expect(insideLasso(poly, 3, 0)).toBe(false);
    const cells = lassoCells(p, poly);
    const s = regionSummary(p, cells)!;
    const seven = s.structures.find((x) => x.id === 7)!;
    expect(seven.share).toBeGreaterThan(0.5);
    expect(seven.share).toBeLessThan(0.75);
    expect(s.structures.reduce((a, x) => a + x.share, 0)).toBeCloseTo(1, 9);
    const c = lassoCentroid(p, cells, poly);
    expect(Math.abs(c.thetaRad)).toBeLessThan(0.02);
    expect(c.rCm).toBeGreaterThan(6.5);
    expect(c.rCm).toBeLessThan(7.5);
  });

  it('thins a long hand-drawn path and keeps a short one', () => {
    const long = Array.from({ length: 1000 }, (_, i) => ({ rCm: 5, thetaRad: i / 1000 }));
    expect(thinLasso(long).length).toBe(LASSO_MAX_POINTS);
    expect(thinLasso(long.slice(0, 50)).length).toBe(50);
  });
});
