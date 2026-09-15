import { describe, expect, it } from 'vitest';
import { CASE_INPUTS, listCases, loadCaseById } from '.';
import { validateCase } from './schema';
import { VIEW_TARGETS } from '@/simulator/windows/viewTargets';
import { getMeasurementSpec } from '@/simulator/measurements/protocol';
import { computeGroundTruth } from '@/simulator/hemodynamics/groundTruth';
import { pathologyImpressions } from '@/clinical/reporting/report';

/** The 12 mandatory cases (spec 56): schema-valid, distinct, teachable and consistent with their impressions. */
describe('case library', () => {
  it('has the 12 cases of the specification in order, with unique ids and seeds', () => {
    const ids = CASE_INPUTS.map((c) => c.id);
    expect(ids).toEqual([
      'normal-excellent-window',
      'normal-difficult-window',
      'hfref-severe-mr',
      'inferior-rwma',
      'aortic-stenosis-moderate',
      'aortic-stenosis-severe',
      'hocm-sam',
      'mvp-primary-mr',
      'pulmonary-hypertension-rv',
      'pericardial-effusion-tamponade',
      'af-diastolic',
      'artifact-challenge',
    ]);
    expect(new Set(ids).size).toBe(12);
    expect(new Set(CASE_INPUTS.map((c) => c.seed)).size).toBe(12);
    expect(listCases().length).toBe(12);
  });
  for (const input of CASE_INPUTS) {
    it(`${input.id}: validates, references known views/measurements and has objectives + impression`, () => {
      const v = validateCase(input);
      expect(v.ok, v.errors.join('; ')).toBe(true);
      const c = loadCaseById(input.id);
      expect(c.learningObjectives.length).toBeGreaterThanOrEqual(2);
      expect(c.impressionTruth.length).toBeGreaterThanOrEqual(2);
      expect(c.requiredViews.length).toBeGreaterThanOrEqual(2);
      for (const rv of c.requiredViews)
        expect(
          VIEW_TARGETS.some((t) => t.id === rv.viewId),
          rv.viewId,
        ).toBe(true);
      for (const rm of c.requiredMeasurements)
        expect(getMeasurementSpec(rm.measurementId), rm.measurementId).toBeDefined();
      expect(c.history).toContain('sintétic');
    });
  }
  it('ground truth matches the intent of each pathological case', () => {
    const gt = (id: string) => computeGroundTruth(loadCaseById(id));
    const hf = gt('hfref-severe-mr');
    expect(hf.lv.efPct).toBeLessThan(30);
    expect(hf.regurgitation.mr?.eroaCm2).toBeCloseTo(0.25, 2);
    expect(hf.lvot.strokeVolumeMl).toBeLessThan(hf.lv.strokeVolumeMl - 10);
    const rw = gt('inferior-rwma');
    expect(rw.wallMotion.abnormalSegments).toEqual([4, 5, 10, 11, 15]);
    expect(rw.lv.efPct).toBeGreaterThan(40);
    const asm = gt('aortic-stenosis-moderate');
    expect(asm.aorticValve.vmaxMps).toBeGreaterThan(3.0);
    expect(asm.aorticValve.vmaxMps).toBeLessThan(4.0);
    expect(asm.aorticValve.meanGradientMmHg).toBeGreaterThan(20);
    expect(asm.aorticValve.meanGradientMmHg).toBeLessThan(40);
    const ass = gt('aortic-stenosis-severe');
    expect(ass.aorticValve.vmaxMps).toBeGreaterThanOrEqual(4);
    expect(ass.aorticValve.meanGradientMmHg).toBeGreaterThanOrEqual(40);
    expect(ass.aorticValve.continuityAvaCm2).toBeLessThan(1.0);
    const ho = gt('hocm-sam');
    expect(ho.lvot.dynamicObstruction).toBe(true);
    expect(ho.lvot.peakGradientMmHg).toBeGreaterThan(50);
    expect(ho.lv.ivsdCm / ho.lv.lvpwdCm).toBeGreaterThan(1.3);
    const mvp = gt('mvp-primary-mr');
    expect(mvp.regurgitation.mr?.eroaCm2).toBeGreaterThanOrEqual(0.4);
    expect(Math.abs(mvp.regurgitation.mr?.jetDirectionDeg ?? 0)).toBeGreaterThan(15);
    const ph = gt('pulmonary-hypertension-rv');
    expect(ph.rightHeart.rvspMmHg!).toBeGreaterThan(60);
    expect(ph.rightHeart.tapseCm).toBeLessThan(1.7);
    expect(ph.rv.septalFlattening).toBeGreaterThan(0.5);
    const tp = gt('pericardial-effusion-tamponade');
    expect(tp.pericardium.effusionCm).toBeGreaterThanOrEqual(2);
    expect(tp.pericardium.tamponade).toBeGreaterThan(0.5);
    const af = gt('af-diastolic');
    expect(af.rhythm).toBe('atrial-fibrillation');
    expect(af.mitral.aPeakMps).toBe(0);
    expect(af.mitral.eOverEPrimeAvg).toBeGreaterThan(13);
    const ar = gt('artifact-challenge');
    expect(ar.aorticValve.vmaxMps).toBeGreaterThan(2);
    expect(ar.aorticValve.vmaxMps).toBeLessThan(3);
    // every pathological case yields at least one impression line beyond the aortic valve statement
    for (const id of [
      'hfref-severe-mr',
      'inferior-rwma',
      'hocm-sam',
      'mvp-primary-mr',
      'pulmonary-hypertension-rv',
      'pericardial-effusion-tamponade',
      'af-diastolic',
    ])
      expect(pathologyImpressions(gt(id)).length, id).toBeGreaterThan(0);
  });
});
