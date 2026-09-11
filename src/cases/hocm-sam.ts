import type { CaseDefinitionInput } from './schema';
import { normalExcellentCase } from './normal-excellent';

/**
 * Case 7 — Hypertrophic obstructive cardiomyopathy: asymmetric septal hypertrophy (IVS 2.1 cm), small
 * hyperdynamic LV, systolic anterior motion of the mitral valve with a late-peaking dynamic LVOT
 * gradient of ≈ 64 mmHg and secondary posteriorly directed MR.
 */
export const hocmSamCase: CaseDefinitionInput = {
  ...normalExcellentCase,
  id: 'hocm-sam',
  title: 'Miocardiopatía hipertrófica obstructiva con SAM',
  seed: 707,
  history: 'Paciente sintético de 45 años con síncope de esfuerzo y soplo que aumenta con Valsalva. Sin datos reales de paciente.',
  demographics: { ageYears: 45, sexForReference: 'male', heightCm: 178, weightKg: 82 },
  rhythm: { type: 'sinus', heartRateBpm: 66, rrVariabilityPct: 2, pvcProbability: 0 },
  anatomy: {
    ...normalExcellentCase.anatomy,
    lv: { eddCm: 4.0, lengthEdCm: 8.2, ivsdCm: 2.1, lvpwdCm: 1.1, sphericity: 0.45, apexWallThicknessCm: 0.9 },
    la: { apDiameterCm: 4.3, volumeMl: 74 },
    aorta: { lvotDiameterCm: 2.0, annulusCm: 2.3, sinusCm: 3.2, ascendingCm: 3.0 },
    mitral: { ...normalExcellentCase.anatomy.mitral, anteriorLeafletLengthCm: 2.9, samSeverity: 0.7 },
  },
  physiology: { ...normalExcellentCase.physiology, edvMl: 100, esvMl: 30, mapseCm: 1.1, ePeakMps: 0.7, aPeakMps: 0.8, decelerationTimeMs: 230, ivrtMs: 100, ePrimeSeptalCmps: 5, ePrimeLateralCmps: 7 },
  hemodynamics: {
    systolicBpMmHg: 125,
    diastolicBpMmHg: 75,
    rapMmHg: 3,
    paspMmHg: 30,
    avEffectiveAreaCm2: 2.8,
    trPresent: true,
    lvotPeakGradientMmHg: 64,
    regurgitation: { mr: { eroaCm2: 0.15, jetDirectionDeg: 35 } },
  },
  flowPrimitives: [...normalExcellentCase.flowPrimitives.map((f) => (f.site === 'lvot' ? { ...f, turbulence: 0.3 } : f)), { id: 'mr', site: 'mr-jet', enabled: true, turbulence: 0.35 }],
  learningObjectives: [
    'Reconocer la hipertrofia septal asimétrica (SIV/PP > 1,3) y medir los grosores en PLAX en telediástole.',
    'Identificar el movimiento sistólico anterior de la mitral y la obstrucción dinámica del TSVI: envolvente en daga de pico tardío en Doppler continuo.',
    'Distinguir el gradiente dinámico del TSVI de una estenosis aórtica valvular (válvula aórtica normal en PSAX).',
  ],
  requiredViews: [
    { viewId: 'plax', minScore: 65 },
    { viewId: 'psax-mv', minScore: 55 },
    { viewId: 'a5c', minScore: 60 },
    { viewId: 'a3c', minScore: 55 },
  ],
  requiredMeasurements: [
    { measurementId: 'ivsd', tolerancePct: 12 },
    { measurementId: 'lvpwd', tolerancePct: 12 },
    { measurementId: 'lvot-peak-velocity', tolerancePct: 12 },
    { measurementId: 'mitral-e', tolerancePct: 12 },
  ],
  difficulty: 4,
  references: [
    { referenceId: 'ase-eacvi-chamber-2015', usage: 'grosores parietales y masa' },
    { referenceId: 'ase-tte-2019', usage: 'Doppler continuo del TSVI' },
  ],
  impressionTruth: [
    'Hipertrofia septal asimétrica severa (SIV 2,1 cm, SIV/PP ≈ 1,9) con cavidad pequeña e hiperdinámica.',
    'Movimiento sistólico anterior de la mitral con obstrucción dinámica del TSVI (gradiente pico ≈ 64 mmHg, pico tardío) e insuficiencia mitral leve posterior.',
    'Aurícula izquierda dilatada; alteración de la relajación.',
  ],
  expectedDeviations: ['ivsd', 'lvpwd', 'ivs-thickening', 'apex-thickness', 'lv-mass', 'la-ap', 'la-transverse', 'lavi', 'la-ao'],
};
