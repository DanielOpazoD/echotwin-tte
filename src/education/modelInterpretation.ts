import { assessDiastolic } from '@/clinical/guidelines/diastolicAssessment';
import { pulmonaryHypertensionEvidence } from '@/clinical/guidelines/pulmonaryHypertension';
import type { StructuredEchoTruth } from '@/simulator/hemodynamics/groundTruth';

/** Nominal synthetic truth, not measurements acquired and averaged by the learner. */
export function modelDiastolicAssessment(t: StructuredEchoTruth) {
  return assessDiastolic({
    ageYears: t.ageYears,
    rhythm: t.rhythm,
    eMps: t.mitral.ePeakMps,
    eOverA: t.mitral.eOverA,
    septalEPrimeCmps: t.mitral.ePrimeSeptalCmps,
    lateralEPrimeCmps: t.mitral.ePrimeLateralCmps,
    laviMlM2: t.la.volumeIndexMlM2,
    // AF and mitral regurgitation can enlarge the LA independently of filling pressure.
    laSizeReliable: t.rhythm !== 'atrial-fibrillation' && !t.regurgitation.mr,
    trMps: t.rightHeart.trVmaxMps,
    paspMmHg: t.rightHeart.rvspMmHg,
    decelerationTimeMs: t.mitral.decelerationTimeMs,
    pulmonaryVeinSd: t.pulmonaryVein.sdRatio,
    bmiKgM2: t.bmiKgM2,
  });
}

export function modelPulmonaryAssessment(t: StructuredEchoTruth) {
  return pulmonaryHypertensionEvidence({
    trVelocityMps: t.rightHeart.trVmaxMps,
    rvBasalDiameterCm: t.rv.basalDiameterCm,
    ivcDiameterCm: t.rightHeart.ivcCm,
  });
}
