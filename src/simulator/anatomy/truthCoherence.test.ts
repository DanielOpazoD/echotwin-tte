// @tier slow
import { describe, expect, it } from 'vitest';
import { CASE_INPUTS, loadCaseById } from '@/cases';
import { measureModel } from './measureModel';
import { computeGroundTruth } from '@/simulator/hemodynamics/groundTruth';
import { buildBeatTables } from '@/simulator/cardiac-cycle/cycleModel';
import { caseOutflow } from '@/simulator/cardiac-cycle/outflow';

/**
 * The truth a measurement is scored against must be what the image shows (decision 161). The panel of 2026-09-22
 * found the drawn heart apart from its declaration: the LVOT measured 2.20–2.24 cm where the case and its flow said 2.1
 * (a well-placed caliper overestimated the stroke volume by 13 %) and the LA's maximum 13–19 % above its declared volume
 * in ten of twelve cases, and no test compared them. Here every case's model is measured the way an echocardiographer
 * would (`measureModel`) and set against `computeGroundTruth`: LVOT diameter at the protocol's level (0.5 cm proximal
 * to the annulus) within 3 %, LA maximal volume within 5 %, and LV end-diastolic and end-systolic volumes within 5 % or
 * 4 mL. The volumes count the papillary muscles as cavity, as the guidelines do, and the systolic wall thickening
 * conserves wall volume with a trabecular compaction that leaves every end-systolic cavity 1–4 mL above its
 * declaration (the end-diastolic ones within 1 mL): a bounded residual of the model, a third of the tolerance the
 * Simpson measurements are scored with (15–18 %).
 */
const LVOT_TOL = 0.03;
const LA_TOL = 0.05;
const LV_TOL = 0.05;
const LV_TOL_ML = 4;

/**
 * Deviations of a drawn heart from its declaration, each with its signed baseline (fraction) and the reason; a
 * declaration that holds no longer fails, and one that moves more than 0.02 from its baseline too.
 */
const KNOWN_TRUTH_DEVIATIONS: ReadonlyMap<string, number> = new Map([
  // (the LVOT of the HFrEF case, whose lumen the dilated base opened into the cavity, 2.5 cm against 2.1, measures 2.08
  // since the neck of the ventricle narrows into the mitral annulus, decision 226)
  // the same dilated base clips the LA ellipsoid: 88 mL drawn against 98 declared
  ['hfref-severe-mr:laMax', -0.106],
  // the pressure-overloaded RV flattens the septum into the LV (decision 32): the drawn cavity holds 7 mL less than the
  // declared end-diastolic volume, which the case's hemodynamics keep
  ['pulmonary-hypertension-rv:edv', -0.084],
]);

describe('the drawn heart matches the truth its measurements are scored against', () => {
  it('LVOT diameter, LA maximal volume and LV volumes of every case', () => {
    const out = { outside: [] as string[], stale: [] as string[], moved: [] as string[] };
    for (const input of CASE_INPUTS) {
      const c = loadCaseById(input.id);
      const m = measureModel(c, undefined, 60000);
      const row = (id: string) => m.rows.find((r) => r.id === id)!.value;
      const t = computeGroundTruth(c);
      const checks: [string, number, number, number, number][] = [
        ['lvot', row('lvot'), t.lvot.diameterCm, LVOT_TOL, 0],
        ['laMax', row('lavi') * m.bsaM2, t.la.volumeMl, LA_TOL, 0],
        ['edv', row('lv-edv'), t.lv.edvMl, LV_TOL, LV_TOL_ML],
        ['esv', row('lv-esv'), t.lv.esvMl, LV_TOL, LV_TOL_ML],
      ];
      for (const [what, drawn, truth, tol, tolAbs] of checks) {
        const key = `${c.id}:${what}`;
        const dev = drawn / truth - 1;
        const inside = Math.abs(dev) <= tol || Math.abs(drawn - truth) <= tolAbs;
        const baseline = KNOWN_TRUTH_DEVIATIONS.get(key);
        const text = `${key} drawn ${drawn.toFixed(2)} against ${truth.toFixed(2)} (${(dev * 100).toFixed(1)} %)`;
        if (!inside && baseline === undefined) out.outside.push(text);
        if (inside && baseline !== undefined) out.stale.push(`${text} is within tolerance`);
        if (!inside && baseline !== undefined && Math.abs(dev - baseline) > 0.02)
          out.moved.push(`${text}: baseline ${(baseline * 100).toFixed(1)} %`);
      }
    }
    expect(out, 'undeclared, stale and moved truth deviations').toEqual({
      outside: [],
      stale: [],
      moved: [],
    });
  });

  it('the right ventricle ejects what the left one sends forward (decision 220)', () => {
    // Without a shunt both ventricles move the same blood: the right ventricle's stroke volume equals the left one's
    // forward volume (its total less the mitral and aortic regurgitant volumes) plus any tricuspid regurgitant volume.
    // Until decision 220 the geometric right ventricle ejected 76-81 % of it in the normal hearts (61 of 75 mL in the
    // reference case): its radial contraction was calibrated with the tricuspid annulus descending by TAPSE all round.
    // Within 20 % in every case and 5 % in the reference one, except where the case's own right ventricle is larger than
    // its forward flow can explain, declared with the ratio as baseline (±0.05).
    const KNOWN_RATIOS: ReadonlyMap<string, number> = new Map([
      // Since decision 245 the mitral regurgitation runs through all of systole and the forward flow falls; the right
      // ventricle's geometry does not know it (its end-systole is pulmonary closure, with the free wall of decision 243).
      // enlarged right ventricle (192 mL declared by its dimensions) with 22 mL of forward flow after the regurgitant
      // mitral volume; its tricuspid regurgitation has no volume in the beat tables (2.24 before decisions 243 and 245)
      // (3.79 before its tricuspid annulus shortened by its own systolic function, decision 253)
      ['hfref-severe-mr', 3.63],
      // the systolic anterior motion's mitral regurgitation takes 30 mL of the 70 the ventricle ejects (1.68 before)
      ['hocm-sam', 2.14],
      // the primary regurgitation leaves 29 mL forward of the ventricle's stroke
      ['mvp-primary-mr', 2.04],
      // its mild regurgitation, through all of systole since decision 245, leaves 42 mL forward
      ['af-diastolic', 1.32],
      // the tricuspid regurgitation of the case (effective orifice 0.3 cm²) carries the difference (1.29 while its annulus
      // shortened as a normal one does, decision 253)
      ['pulmonary-hypertension-rv', 1.19],
      // it ejects what its left ventricle ejects in total (68 of 69 mL): the forward flow subtracts a regurgitant volume
      // the right ventricle's geometry does not know; the septal crest (decision 223) added the last mL
      ['artifact-challenge', 1.36],
    ]);
    const problems: string[] = [];
    for (const input of CASE_INPUTS) {
      const c = loadCaseById(input.id);
      // the tables the app draws, with the case's outflow obstruction (decision 245)
      const t = buildBeatTables(
        60 / c.rhythm.heartRateBpm,
        c.physiology,
        c.rhythm,
        c.hemodynamics,
        {
          outflow: caseOutflow(c),
        },
      );
      const forward = t.strokeVolumeMl - t.regurgitation.mrVolumeMl - t.regurgitation.arVolumeMl;
      const m = measureModel(c, undefined, 90000);
      const row = (id: string) => m.rows.find((r) => r.id === id)!.value;
      const rvSv = (row('rv-edv') * row('rv-ef')) / 100;
      const ratio = rvSv / forward;
      const baseline = KNOWN_RATIOS.get(c.id);
      const tol = c.id === 'normal-excellent-window' ? 0.05 : 0.2;
      const text = `${c.id}: right ${rvSv.toFixed(0)} mL against ${forward.toFixed(0)} forward (${ratio.toFixed(2)})`;
      if (baseline === undefined ? Math.abs(ratio - 1) > tol : Math.abs(ratio - baseline) > 0.05)
        problems.push(baseline === undefined ? text : `${text}, baseline ${baseline}`);
    }
    expect(problems).toEqual([]);
  });
});
