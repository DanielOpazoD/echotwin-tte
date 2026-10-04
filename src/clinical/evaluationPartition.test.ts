// @tier fast
import { describe, expect, it } from 'vitest';
import { auditEvaluationPartition } from './evaluationPartition';

describe('patient-level external evaluation eligibility', () => {
  it('rejects reuse across splits even when different views would be scored', () => {
    const subject = { dataset: 'external-study', patientId: 'subject-17' };
    expect(
      auditEvaluationPartition({ calibration: [subject], development: [], evaluation: [subject] })
        .eligible,
    ).toBe(false);
  });
  it('cannot rebrand any of the 500 calibrated CAMUS subjects as held out', () => {
    const evaluation = Array.from({ length: 500 }, (_, i) => ({
      dataset: ' CAMUS ',
      patientId: 'patient' + String(i + 1).padStart(4, '0'),
    }));
    const result = auditEvaluationPartition({ calibration: [], development: [], evaluation });
    expect(result.eligible).toBe(false);
    expect(result.counts.evaluation).toBe(500);
    expect(result.issues).toContain('CAMUS subject already used by the historical calibration');
  });
  it('rejects frame identifiers and duplicate patients, including padded CAMUS aliases', () => {
    expect(() =>
      auditEvaluationPartition({
        calibration: [],
        development: [],
        evaluation: [{ dataset: 'camus', patientId: 'patient0001_4CH_ED' }],
      }),
    ).toThrow();
    const a = { dataset: 'camus', patientId: 'patient0001' },
      b = { dataset: 'camus', patientId: 'patient1' };
    expect(
      auditEvaluationPartition({ calibration: [a, b], development: [], evaluation: [] }).issues,
    ).toContain('Duplicate subject in calibration');
  });
  it('accepts a disjoint declared cohort without claiming that review has been performed', () => {
    const result = auditEvaluationPartition({
      calibration: [{ dataset: 'external-study', patientId: '01' }],
      development: [{ dataset: 'external-study', patientId: '02' }],
      evaluation: [{ dataset: 'external-study', patientId: '03' }],
    });
    expect(result).toEqual({
      eligible: true,
      counts: { calibration: 1, development: 1, evaluation: 1 },
      issues: [],
    });
  });
  it('an empty evaluation is explicitly ineligible', () => {
    expect(
      auditEvaluationPartition({ calibration: [], development: [], evaluation: [] }).eligible,
    ).toBe(false);
  });
});
