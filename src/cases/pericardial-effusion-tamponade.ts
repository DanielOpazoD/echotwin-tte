import type { CaseDefinitionInput } from './schema';
import { normalExcellentCase } from './normal-excellent';

/** Case 10 — Large circumferential pericardial effusion with tamponade physiology: RV early-diastolic and RA late-diastolic collapse, swinging heart, tachycardia, small LV. */
export const pericardialEffusionTamponadeCase: CaseDefinitionInput = {
  ...normalExcellentCase,
  id: 'pericardial-effusion-tamponade',
  title: 'Derrame pericárdico severo con signos de taponamiento',
  seed: 1010,
  history:
    'Paciente sintético de 48 años, disnea aguda, taquicardia e hipotensión tras pericarditis. Sin datos reales de paciente.',
  demographics: { ageYears: 48, sexForReference: 'male', heightCm: 176, weightKg: 75 },
  rhythm: { type: 'sinus-tachycardia', heartRateBpm: 108, rrVariabilityPct: 2, pvcProbability: 0 },
  anatomy: {
    ...normalExcellentCase.anatomy,
    lv: {
      eddCm: 4.2,
      lengthEdCm: 8.2,
      ivsdCm: 0.9,
      lvpwdCm: 0.9,
      sphericity: 0.5,
      apexWallThicknessCm: 0.7,
    },
    la: { apDiameterCm: 3.2, volumeMl: 42 },
    rv: { basalDiameterCm: 3.0, lengthCm: 7.0, freeWallThicknessCm: 0.35, septalFlattening: 0 },
    ra: { volumeMl: 40 },
    ivc: { diameterCm: 2.6, collapsePct: 10 },
    pericardium: { effusionCm: 2.2, tamponade: 0.8 },
  },
  physiology: {
    ...normalExcellentCase.physiology,
    edvMl: 88,
    esvMl: 38,
    mapseCm: 1.2,
    tapseCm: 1.8,
    ePeakMps: 0.75,
    aPeakMps: 0.5,
    decelerationTimeMs: 170,
    ivrtMs: 70,
  },
  hemodynamics: {
    systolicBpMmHg: 92,
    diastolicBpMmHg: 65,
    rapMmHg: 16,
    paspMmHg: 34,
    avEffectiveAreaCm2: 3.0,
    trPresent: true,
    lvotPeakGradientMmHg: 0,
    regurgitation: {},
  },
  learningObjectives: [
    'Reconocer un derrame pericárdico circunferencial severo (> 2 cm) y diferenciarlo del derrame pleural (relación con la aorta descendente en PLAX).',
    'Identificar los signos ecocardiográficos de taponamiento: colapso diastólico precoz del VD, colapso telediastólico de la AD, corazón oscilante y VCI dilatada sin colapso.',
    'Correlacionar con la taquicardia y la caída del volumen sistólico (VI pequeño e hiperdinámico).',
  ],
  requiredViews: [
    { viewId: 'plax', minScore: 60 },
    { viewId: 'psax-pm', minScore: 55 },
    { viewId: 'a4c', minScore: 60 },
  ],
  requiredMeasurements: [
    { measurementId: 'lv-edd', tolerancePct: 12 },
    { measurementId: 'mitral-e', tolerancePct: 15 },
  ],
  difficulty: 3,
  references: [{ referenceId: 'ase-tte-2019', usage: 'evaluación del derrame pericárdico' }],
  impressionTruth: [
    'Derrame pericárdico circunferencial severo (≈ 2,2 cm) con colapso diastólico del ventrículo derecho y colapso de la aurícula derecha: taponamiento cardíaco.',
    'Corazón oscilante; ventrículo izquierdo pequeño e hiperdinámico con taquicardia sinusal.',
    'Vena cava inferior dilatada sin colapso inspiratorio (presión de la AD elevada).',
  ],
  // the compressed LV is small in diastole (classic tamponade finding)
  expectedDeviations: ['lv-idd'],
};
