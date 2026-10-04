import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { computeGroundTruth } from '@/simulator/hemodynamics/groundTruth';
import { expectedFindings } from '@/education/impression';
import { pulmonaryHypertensionEvidence } from './pulmonaryHypertension';

describe('ASE 2025 suggestive PH findings require TR and appropriate context', () => {
  const normal = { trVelocityMps: 2.7, rvBasalDiameterCm: 3.5, ivcDiameterCm: 1.8 };
  it('requires two adjunctive signs at 2.8, or a resting velocity of at least 2.9', () => {
    expect(pulmonaryHypertensionEvidence({ ...normal, trVelocityMps: 2.9 }).suggestive).toBe(true);
    expect(
      pulmonaryHypertensionEvidence({ ...normal, trVelocityMps: 2.8, rvBasalDiameterCm: 4.1 })
        .suggestive,
    ).toBe(false);
    expect(
      pulmonaryHypertensionEvidence({
        ...normal,
        trVelocityMps: 2.8,
        rvBasalDiameterCm: 4.1,
        ivcDiameterCm: 2.2,
      }).suggestive,
    ).toBe(true);
    expect(
      pulmonaryHypertensionEvidence({
        ...normal,
        trVelocityMps: 2.79,
        rvBasalDiameterCm: 5,
        ivcDiameterCm: 3,
      }).suggestive,
    ).toBe(false);
  });
  it('does not turn unavailable TR or RVOT obstruction into a pulmonary pressure diagnosis', () => {
    expect(pulmonaryHypertensionEvidence({ ...normal, trVelocityMps: null }).applicable).toBe(
      false,
    );
    expect(
      pulmonaryHypertensionEvidence({ ...normal, trVelocityMps: 4, rvotObstruction: true })
        .suggestive,
    ).toBe(false);
  });
  it('does not grade PH solely from RVSP >=50; a lower RVSP can still be suggestive', () => {
    const t = computeGroundTruth(loadCaseById('normal-excellent-window'));
    const raisedRap = { ...t, rightHeart: { ...t.rightHeart, trVmaxMps: 2.6, rvspMmHg: 50 } };
    expect(expectedFindings(raisedRap)).not.toContain('ph-probable');
    const highTr = { ...t, rightHeart: { ...t.rightHeart, trVmaxMps: 3, rvspMmHg: 41 } };
    expect(expectedFindings(highTr)).toContain('ph-probable');
  });
});
