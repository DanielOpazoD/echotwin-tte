import { describe, expect, it } from 'vitest';
import { buildLvProfile, allocLvProfileTable, lvCavitySdf, lvProfileG, lvProfileGExact, lvProfileDG, lvProfileDGExact, lvShapeFor, lvShellVolume, lvCavityRadius, solveThickening, LV_PROF_BINS } from './lvShape';

describe('LV bullet profile', () => {
  const sh = lvShapeFor(0.5);
  it('has a basal neck, maximal width in the basal third and a broad apical half', () => {
    expect(lvProfileGExact(sh, 0)).toBeCloseTo(sh.g0, 6);
    expect(lvProfileGExact(sh, sh.zetaMax)).toBeCloseTo(1, 6);
    expect(lvProfileGExact(sh, 0.8)).toBeGreaterThan(0.7); // an ellipse would give 0.6 here
    expect(lvProfileGExact(sh, 1)).toBe(0);
    expect(lvProfileGExact(sh, sh.zetaTop)).toBeCloseTo(0, 6);
    expect(lvProfileGExact(sh, sh.zetaTop / 2)).toBeCloseTo(sh.g0 * Math.sqrt(0.75), 6);
    // the per-sample table reproduces the analytic profile and its slope
    for (const zeta of [-0.1, 0, 0.2, 0.4, 0.6, 0.8, 0.95]) {
      expect(Math.abs(lvProfileG(sh, zeta) - lvProfileGExact(sh, zeta))).toBeLessThan(2e-3);
      // the slope has a crease at the annular plane (dome ↔ neck), so the table is compared away from ζ = 0
      if (zeta !== 0) expect(Math.abs(lvProfileDG(sh, zeta) - lvProfileDGExact(sh, zeta))).toBeLessThan(0.05);
    }
    expect(sh.I).toBeGreaterThan(0.6);
    expect(sh.I).toBeLessThan(0.85);
  });
  it('spherical LVs move the widest level toward the middle and round the taper', () => {
    const sph = lvShapeFor(1);
    expect(sph.zetaMax).toBeGreaterThan(sh.zetaMax);
    expect(sph.n).toBeLessThan(sh.n);
  });
  it('tabulated polar surface reproduces the profile radius and gives signed distances of the right sign', () => {
    const tab = buildLvProfile(sh, 2.5, 8.6, 0, allocLvProfileTable());
    expect(tab.R.length).toBe(LV_PROF_BINS);
    for (const zeta of [0.05, 0.3, 0.6, 0.9]) {
      const z = zeta * 8.6;
      const r = lvCavityRadius(sh, tab, 0, z);
      expect(r).toBeCloseTo(2.5 * lvProfileG(sh, zeta), 6);
      expect(lvCavitySdf(tab, sh.ratio, r * 0.9, 0, z)).toBeLessThan(0);
      expect(lvCavitySdf(tab, sh.ratio, r * 1.1, 0, z)).toBeGreaterThan(0);
      // first-order accuracy: a point 0.3 cm outside along x reads ≈ 0.3 (within the slope correction)
      const d = lvCavitySdf(tab, sh.ratio, r + 0.3, 0, z);
      expect(Math.abs(d - 0.3)).toBeLessThan(0.08);
    }
    // anteroposterior axis is scaled by the ratio
    const rY = lvCavityRadius(sh, tab, Math.PI / 2, 4);
    expect(rY).toBeCloseTo(2.5 * lvProfileG(sh, 4 / 8.6) * sh.ratio, 6);
    expect(lvCavitySdf(tab, sh.ratio, 0, rY + 0.2, 4)).toBeGreaterThan(0.1);
    // beyond the apex on the axis: positive, ≈ distance to the tip
    expect(lvCavitySdf(tab, sh.ratio, 0, 0, 9.1)).toBeCloseTo(0.5, 1);
    expect(lvCavitySdf(tab, sh.ratio, 0, 0, 4)).toBeLessThan(-1.5);
  });
  it('shell volume grows with the thickening factor and the solver inverts it', () => {
    const tab = buildLvProfile(sh, 2.5, 8.6, 0, allocLvProfileTable());
    const tMean = (): number => 0.9;
    const v1 = lvShellVolume(tab, sh.ratio, tMean, 1);
    const v15 = lvShellVolume(tab, sh.ratio, tMean, 1.5);
    expect(v1).toBeGreaterThan(80);
    expect(v1).toBeLessThan(200);
    expect(v15).toBeGreaterThan(v1 * 1.4);
    expect(solveThickening(tab, sh.ratio, tMean, v15)).toBeCloseTo(1.5, 3);
    // a smaller cavity (systole) needs a thicker wall for the same shell volume
    const tabSys = buildLvProfile(sh, 2.0, 7.4, 1.2, allocLvProfileTable());
    expect(solveThickening(tabSys, sh.ratio, tMean, v1)).toBeGreaterThan(1.2);
  });
});
