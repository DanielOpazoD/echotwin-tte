import type { CaseDefinitionInput } from './schema';
import { normalExcellentCase } from './normal-excellent';

/**
 * Case 4 — Old inferior/inferolateral infarction: akinesia of the basal and mid inferior and
 * inferolateral segments with mildly reduced EF; otherwise normal chamber sizes.
 */
export const inferiorRwmaCase: CaseDefinitionInput = {
  ...normalExcellentCase,
  id: 'inferior-rwma',
  title: 'Alteración segmentaria inferior e inferolateral (infarto antiguo)',
  seed: 404,
  history: 'Paciente sintético de 58 años, infarto inferior hace 8 meses, control de función ventricular. Sin datos reales de paciente.',
  demographics: { ageYears: 58, sexForReference: 'male', heightCm: 175, weightKg: 80 },
  rhythm: { type: 'sinus', heartRateBpm: 70, rrVariabilityPct: 2, pvcProbability: 0.02 },
  anatomy: {
    ...normalExcellentCase.anatomy,
    lv: { eddCm: 5.2, lengthEdCm: 8.8, ivsdCm: 0.95, lvpwdCm: 0.9, sphericity: 0.55, apexWallThicknessCm: 0.7 },
    la: { apDiameterCm: 3.7, volumeMl: 56 },
    wallMotion: [
      { segment: 4, amplitude: 0.05, delayPhase: 0.05 },
      { segment: 5, amplitude: 0.1, delayPhase: 0.05 },
      { segment: 10, amplitude: 0.1, delayPhase: 0.04 },
      { segment: 11, amplitude: 0.25, delayPhase: 0.03 },
      { segment: 15, amplitude: 0.45, delayPhase: 0.02 },
    ],
  },
  physiology: { ...normalExcellentCase.physiology, edvMl: 145, esvMl: 78, mapseCm: 1.1, ePeakMps: 0.7, aPeakMps: 0.75, decelerationTimeMs: 215, ivrtMs: 95, ePrimeSeptalCmps: 6, ePrimeLateralCmps: 8 },
  hemodynamics: { ...normalExcellentCase.hemodynamics, systolicBpMmHg: 130, diastolicBpMmHg: 78, paspMmHg: 32, lvotPeakGradientMmHg: 0, regurgitation: {} },
  learningObjectives: [
    'Identificar acinesia de los segmentos inferior e inferolateral en PSAX papilar, A2C y A3C usando el modelo de 17 segmentos.',
    'Estimar la FEVI por Simpson biplano cuando la disfunción es regional (la FE global subestima la magnitud del daño).',
    'Reconocer el patrón de alteración de la relajación (E/A < 0,8) asociado.',
  ],
  requiredViews: [
    { viewId: 'plax', minScore: 65 },
    { viewId: 'psax-pm', minScore: 60 },
    { viewId: 'a4c', minScore: 65 },
    { viewId: 'a2c', minScore: 55 },
  ],
  requiredMeasurements: [
    { measurementId: 'lv-edd', tolerancePct: 10 },
    { measurementId: 'lv-edv-simpson', tolerancePct: 15 },
    { measurementId: 'lv-esv-simpson', tolerancePct: 18 },
  ],
  difficulty: 3,
  references: [{ referenceId: 'ase-eacvi-chamber-2015', usage: 'modelo de 17 segmentos y puntuación de motilidad' }],
  impressionTruth: [
    'Acinesia de los segmentos inferior e inferolateral basal y medio con hipocinesia del segmento inferior apical, compatible con infarto inferior antiguo.',
    'Función sistólica global levemente reducida (FEVI ≈ 46 %); ventrículo izquierdo de tamaño normal.',
    'Alteración de la relajación (E/A < 1).',
  ],
  expectedDeviations: ['lv-esv', 'lv-ef'],
};
