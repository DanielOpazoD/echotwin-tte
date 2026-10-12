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

describe('the drawn heart matches the truth its measurements are scored against', () => {
  it('LVOT, LA dimensions and volume, and LV volumes of every case', () => {
    const outside: string[] = [];
    for (const input of CASE_INPUTS) {
      const c = loadCaseById(input.id);
      const m = measureModel(c, undefined, 60000);
      const row = (id: string) => m.rows.find((r) => r.id === id)!.value;
      const t = computeGroundTruth(c);
      const checks: [string, number, number, number, number][] = [
        ['lvot', row('lvot'), t.lvot.diameterCm, LVOT_TOL, 0],
        ['laMax', row('lavi') * m.bsaM2, t.la.volumeMl, LA_TOL, 0],
        ['laAP', row('la-ap'), t.la.apDiameterCm, 0.1, 0],
        ['edv', row('lv-edv'), t.lv.edvMl, LV_TOL, LV_TOL_ML],
        ['esv', row('lv-esv'), t.lv.esvMl, LV_TOL, LV_TOL_ML],
      ];
      for (const [what, drawn, truth, tol, tolAbs] of checks) {
        const key = `${c.id}:${what}`;
        const dev = drawn / truth - 1;
        const inside = Math.abs(dev) <= tol || Math.abs(drawn - truth) <= tolAbs;
        const text = `${key} drawn ${drawn.toFixed(2)} against ${truth.toFixed(2)} (${(dev * 100).toFixed(1)} %)`;
        if (!inside) outside.push(text);
      }
    }
    expect(outside, 'all declared left-heart dimensions and volumes meet their tolerances').toEqual(
      [],
    );
  });

  it('the right ventricle ejects what the left one sends forward (decision 220)', () => {
    // Without a shunt both ventricles move the same blood: the right ventricle's stroke volume equals the left one's
    // forward volume (its total less the mitral and aortic regurgitant volumes) plus any tricuspid regurgitant volume.
    // Until decision 220 the geometric right ventricle ejected 76-81 % of it in the normal hearts (61 of 75 mL in the
    // reference case): its radial contraction was calibrated with the tricuspid annulus descending by TAPSE all round.
    // Within 20 % in every case and 5 % in the reference one, except where the case's own right ventricle is larger than
    // its forward flow can explain, declared with the ratio as baseline (±0.05).
    const KNOWN_RATIOS: ReadonlyMap<string, number> = new Map([
      // Decision 297 put the regurgitant volume into the end-diastolic volume of the regurgitant cases: the forward flow
      // is plausible again and the ratios fell (HFrEF 3.63 → 2.05, HCM 2.14 → 1.52, prolapse 2.04 → 1.48; AF 1.32 and
      // the artifact case 1.36 now within 20 % and off the list). What remains is the right ventricle's geometry, which
      // its dimensions declare larger than the forward flow needs; its end-systole is pulmonary closure (decision 243).
      // enlarged right ventricle declared by its dimensions; trace tricuspid regurgitation without a declared EROA
      ['hfref-severe-mr', 2.05],
      // the systolic anterior motion's regurgitation (11 mL, decision 297) leaves 59 mL forward of a hyperdynamic 70
      ['hocm-sam', 1.52],
      // the primary regurgitation leaves 42 mL forward of the ventricle's stroke
      ['mvp-primary-mr', 1.48],
      // PH: quantified TR now participates in the target (decision 293); no exception is needed.
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
      const totalEjected = forward + t.regurgitation.trVolumeMl;
      const ratio = rvSv / totalEjected;
      const baseline = KNOWN_RATIOS.get(c.id);
      const tol = c.id === 'normal-excellent-window' ? 0.05 : 0.2;
      const text = `${c.id}: right ${rvSv.toFixed(0)} mL against ${totalEjected.toFixed(0)} total (${forward.toFixed(0)} forward + ${t.regurgitation.trVolumeMl.toFixed(0)} TR; ${ratio.toFixed(2)})`;
      if (baseline === undefined ? Math.abs(ratio - 1) > tol : Math.abs(ratio - baseline) > 0.05)
        problems.push(baseline === undefined ? text : `${text}, baseline ${baseline}`);
    }
    expect(problems).toEqual([]);
  });
});
