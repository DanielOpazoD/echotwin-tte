import { describe, expect, it } from 'vitest';
import { CASE_INPUTS, loadCaseById } from '@/cases';
import { computeGroundTruth } from './groundTruth';
import { RIGHT_HEART_RULES } from '@/clinical/reference-values';

/**
 * What the ground truth says must agree with what its own echo would show. The HFrEF case read «normal wall motion»
 * (WMSI 1.00) at an EF of 24 %, and the pulmonary hypertension case declared an RAP of 10 mmHg with a 2.5 cm IVC that
 * collapses 20 %, which the ASE rule reads as 15: its report's RVSP disagreed with its truth by 5 mmHg.
 */
describe('the ground truth reads like its echo', () => {
  it('a uniformly weak ventricle is globally hypokinetic, not normal, and not a regional abnormality', () => {
    const hf = computeGroundTruth(loadCaseById('hfref-severe-mr'));
    expect(hf.lv.efPct).toBeLessThan(40);
    expect(hf.wallMotion.wmsi).toBeCloseTo(2, 6);
    expect(hf.wallMotion.abnormalSegments).toEqual([]);
    expect(hf.wallMotion.description).toMatch(/Hipocinesia global/);
    // a regional case keeps its declared segments and a normal one stays normal
    expect(
      computeGroundTruth(loadCaseById('inferior-rwma')).wallMotion.abnormalSegments.length,
    ).toBeGreaterThan(0);
    expect(computeGroundTruth(loadCaseById('normal-excellent-window')).wallMotion.wmsi).toBe(1);
  });

  it('every case declares an RAP within 2 mmHg of what its IVC reads by the ASE rule', () => {
    const R = RIGHT_HEART_RULES.rapFromIvc.value;
    const off: string[] = [];
    for (const input of CASE_INPUTS) {
      const c = loadCaseById(input.id);
      const { diameterCm: d, collapsePct: col } = c.anatomy.ivc;
      const small = d <= R.normal.ivcMaxCm;
      const collapses = col > R.normal.collapsePct;
      const rule =
        small && collapses
          ? R.normal.rapMmHg
          : !small && !collapses
            ? R.high.rapMmHg
            : R.intermediate.rapMmHg;
      if (Math.abs(c.hemodynamics.rapMmHg - rule) > 2)
        off.push(
          `${input.id}: declares ${c.hemodynamics.rapMmHg}, IVC ${d} cm / ${col} % reads ${rule}`,
        );
    }
    expect(off).toEqual([]);
  });
});
