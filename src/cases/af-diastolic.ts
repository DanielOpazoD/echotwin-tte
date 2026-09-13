import type { CaseDefinitionInput } from './schema';
import { normalExcellentCase } from './normal-excellent';

/** Case 11 — Atrial fibrillation: irregular RR, no A wave (E-only filling), dilated LA, mild LVH; diastolic grading limited to E/e′ and LA size. */
export const afDiastolicCase: CaseDefinitionInput = {
  ...normalExcellentCase,
  id: 'af-diastolic',
  title: 'Fibrilación auricular — limitaciones de la evaluación diastólica',
  seed: 1111,
  history: 'Paciente sintética de 74 años con FA persistente e hipertensión; evaluación de presiones de llenado. Sin datos reales de paciente.',
  demographics: { ageYears: 74, sexForReference: 'female', heightCm: 158, weightKg: 71 },
  bodyHabitus: { chestWallThicknessCm: 2.6, chestWidthCm: 32, chestDepthCm: 22, ribSpacingCm: 2.4, intercostalWidthCm: 1.4 },
  rhythm: { type: 'atrial-fibrillation', heartRateBpm: 92, rrVariabilityPct: 22, pvcProbability: 0 },
  anatomy: {
    ...normalExcellentCase.anatomy,
    lv: { eddCm: 4.6, lengthEdCm: 8.0, ivsdCm: 1.1, lvpwdCm: 1.0, sphericity: 0.5, apexWallThicknessCm: 0.7 },
    la: { apDiameterCm: 4.6, volumeMl: 92 },
    rv: { basalDiameterCm: 3.2, lengthCm: 7.2, freeWallThicknessCm: 0.35, septalFlattening: 0 },
    ra: { volumeMl: 60 },
    aorta: { lvotDiameterCm: 1.9, annulusCm: 2.2, sinusCm: 3.0, ascendingCm: 2.9 },
    mitral: { ...normalExcellentCase.anatomy.mitral, annulusDiameterCm: 3.2, calcification: 0.3 },
    tricuspid: { annulusDiameterCm: 3.3 },
  },
  physiology: { ...normalExcellentCase.physiology, edvMl: 100, esvMl: 38, mapseCm: 1.2, ePeakMps: 0.95, aPeakMps: 0, decelerationTimeMs: 170, ivrtMs: 70, ePrimeSeptalCmps: 5.5, ePrimeLateralCmps: 7.5 },
  hemodynamics: { systolicBpMmHg: 138, diastolicBpMmHg: 82, rapMmHg: 5, paspMmHg: 40, avEffectiveAreaCm2: 2.6, trPresent: true, lvotPeakGradientMmHg: 0, regurgitation: { mr: { eroaCm2: 0.12, jetDirectionDeg: 0 } } },
  flowPrimitives: [...normalExcellentCase.flowPrimitives, { id: 'mr', site: 'mr-jet', enabled: true, turbulence: 0.3 }],
  learningObjectives: [
    'Reconocer la variabilidad latido a latido del llenado y del volumen sistólico en FA: promediar ≥ 5 latidos (o usar latidos de RR similar).',
    'Entender qué parámetros diastólicos no son aplicables sin onda A (E/A, duración de A) y cuáles sí (E/e′, tiempo de desaceleración, volumen de la AI, IT).',
    'Estimar presiones de llenado con E/e′ septal ≥ 11 y la AI dilatada.',
  ],
  requiredViews: [
    { viewId: 'a4c', minScore: 65 },
    { viewId: 'plax', minScore: 65 },
  ],
  requiredMeasurements: [
    { measurementId: 'mitral-e', tolerancePct: 15 },
    { measurementId: 'e-prime-septal', tolerancePct: 15 },
    { measurementId: 'e-prime-lateral', tolerancePct: 15 },
    { measurementId: 'la-ap', tolerancePct: 10 },
  ],
  difficulty: 3,
  references: [{ referenceId: 'ase-eacvi-diastolic-2016', usage: 'evaluación diastólica en fibrilación auricular' }],
  impressionTruth: [
    'Fibrilación auricular con respuesta ventricular controlada; llenado mitral con onda E única y variable.',
    'Hipertrofia concéntrica leve; función sistólica conservada.',
    'Aurícula izquierda severamente dilatada y E/e′ promedio ≈ 15: presiones de llenado probablemente elevadas.',
  ],
  expectedDeviations: ['ivsd', 'lvpwd', 'la-ap', 'la-transverse', 'la-long', 'lavi', 'la-emptying', 'ravi', 'ra-long', 'la-ao'],
};
