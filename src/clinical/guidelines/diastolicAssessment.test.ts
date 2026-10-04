import { describe, expect, it } from 'vitest';
import { assessDiastolic, type DiastolicInputs } from './diastolicAssessment';
import { loadCaseById } from '@/cases';
import { computeGroundTruth } from '@/simulator/hemodynamics/groundTruth';
import { pathologyImpressions } from '@/education/report';
import { expectedFindings } from '@/education/impression';
const normal: DiastolicInputs = {
  ageYears: 60,
  rhythm: 'sinus',
  eMps: 0.6,
  eOverA: 1,
  septalEPrimeCmps: 8,
  lateralEPrimeCmps: 10,
  laviMlM2: 30,
  laSizeReliable: true,
  trMps: 2.5,
  paspMmHg: 30,
  decelerationTimeMs: 190,
  pulmonaryVeinSd: 1.2,
  bmiKgM2: 24,
};
describe('ASE 2025 separates dysfunction from filling pressure', () => {
  it('requires concordant markers and does not treat an isolated E/e′ as dysfunction', () => {
    expect(assessDiastolic(normal).dysfunctionPresent).toBe(false);
    expect(assessDiastolic({ ...normal, eMps: 1.5 }).dysfunctionPresent).toBe(false);
    expect(assessDiastolic({ ...normal, eMps: 1.5, laviMlM2: 45 }).dysfunctionPresent).toBe(true);
    const relaxation = assessDiastolic({ ...normal, septalEPrimeCmps: 5, eOverA: 0.8 });
    expect(relaxation.dysfunctionPresent).toBe(true);
    expect(relaxation.fillingPressure).toBe('not-assessed');
  });
  it('excludes LA size when unreliable and uses the age-specific relaxation limit', () => {
    const x = {
      ...normal,
      ageYears: 70,
      septalEPrimeCmps: 6.5,
      lateralEPrimeCmps: 8,
      laviMlM2: 45,
    };
    expect(assessDiastolic(x).dysfunctionPresent).toBe(false);
    expect(assessDiastolic({ ...x, ageYears: 32 }).dysfunctionPresent).toBe(true);
    expect(assessDiastolic({ ...x, ageYears: 32, laSizeReliable: false }).dysfunctionPresent).toBe(
      false,
    );
  });
  it('retains the AF case as indeterminate without inventing an absent strain measurement', () => {
    const t = computeGroundTruth(loadCaseById('af-diastolic'));
    const findings = expectedFindings(t);
    expect(findings).toContain('diastolic-dysfunction');
    expect(findings).toContain('filling-pressure-indeterminate');
    expect(findings).not.toContain('filling-pressure-elevated');
    expect(
      pathologyImpressions(t).some((s) => s.includes('Presión de llenado izquierda indeterminada')),
    ).toBe(true);
  });
  it('uses the four AF criteria and the secondary branch, including missing evidence', () => {
    const af = { ...normal, rhythm: 'atrial-fibrillation', eOverA: null, laSizeReliable: false };
    expect(assessDiastolic(af).fillingPressure).toBe('normal');
    const two = { ...af, eMps: 1, septalEPrimeCmps: 8, pulmonaryVeinSd: 0.7 };
    expect(assessDiastolic(two).pressureEvidence).toHaveLength(2);
    expect(assessDiastolic(two).fillingPressure).toBe('indeterminate');
    expect(assessDiastolic({ ...two, bmiKgM2: 31 }).fillingPressure).toBe('elevated');
    expect(
      assessDiastolic({ ...two, pulmonaryVeinSd: 1, laReservoirStrainPct: 18 }).fillingPressure,
    ).toBe('normal');
    expect(assessDiastolic({ ...two, trMps: 2.81 }).fillingPressure).toBe('elevated');
    expect(assessDiastolic({ ...two, trMps: null, paspMmHg: null }).fillingPressure).toBe(
      'indeterminate',
    );
  });
  it('rejects zero or nonfinite core measurements rather than producing a diagnosis', () => {
    for (const v of [0, NaN, Infinity])
      expect(() => assessDiastolic({ ...normal, septalEPrimeCmps: v })).toThrow(RangeError);
  });
});
