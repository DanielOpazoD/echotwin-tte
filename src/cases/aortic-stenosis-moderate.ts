import type { CaseDefinitionInput } from './schema';
import { normalExcellentCase } from './normal-excellent';

/** Case 5 — Moderate calcific aortic stenosis in a 70-year-old woman: Vmax ≈ 3.2 m/s, mean gradient ≈ 22 mmHg, AVA ≈ 1.1 cm². */
export const aorticStenosisModerateCase: CaseDefinitionInput = {
  ...normalExcellentCase,
  id: 'aortic-stenosis-moderate',
  title: 'Estenosis aórtica moderada calcificada',
  seed: 505,
  history:
    'Paciente sintética de 70 años con soplo sistólico y disnea leve de esfuerzo. Sin datos reales de paciente.',
  demographics: { ageYears: 70, sexForReference: 'female', heightCm: 160, weightKg: 68 },
  bodyHabitus: {
    chestWallThicknessCm: 2.4,
    chestWidthCm: 32,
    chestDepthCm: 21,
    ribSpacingCm: 2.5,
    intercostalWidthCm: 1.5,
  },
  rhythm: { type: 'sinus', heartRateBpm: 72, rrVariabilityPct: 2, pvcProbability: 0 },
  anatomy: {
    ...normalExcellentCase.anatomy,
    lv: {
      eddCm: 4.5,
      lengthEdCm: 8.0,
      ivsdCm: 1.1,
      lvpwdCm: 1.0,
      sphericity: 0.5,
      apexWallThicknessCm: 0.7,
    },
    la: { apDiameterCm: 3.6, volumeMl: 54 },
    rv: { basalDiameterCm: 3.1, lengthCm: 7.2, freeWallThicknessCm: 0.35, septalFlattening: 0 },
    ra: { volumeMl: 38 },
    aorta: { lvotDiameterCm: 1.9, annulusCm: 2.2, sinusCm: 3.0, ascendingCm: 3.1 },
    mitral: { ...normalExcellentCase.anatomy.mitral, annulusDiameterCm: 2.85, calcification: 0.35 },
    aorticValve: {
      maxOpeningFraction: 0.5,
      calcification: 0.55,
      cuspThicknessCm: 0.18,
      bicuspid: false,
    },
    tricuspid: { annulusDiameterCm: 3.05 },
  },
  physiology: {
    ...normalExcellentCase.physiology,
    edvMl: 104,
    esvMl: 36,
    mapseCm: 1.2,
    ePeakMps: 0.7,
    aPeakMps: 0.8,
    decelerationTimeMs: 225,
    ivrtMs: 95,
    ePrimeSeptalCmps: 6,
    ePrimeLateralCmps: 8,
  },
  hemodynamics: {
    systolicBpMmHg: 140,
    diastolicBpMmHg: 80,
    rapMmHg: 3,
    paspMmHg: 30,
    avEffectiveAreaCm2: 1.1,
    trPresent: true,
    lvotPeakGradientMmHg: 0,
    regurgitation: {},
  },
  flowPrimitives: normalExcellentCase.flowPrimitives.map((f) =>
    f.site === 'aortic-valve' ? { ...f, turbulence: 0.3 } : f,
  ),
  learningObjectives: [
    'Graduar una estenosis aórtica con los tres parámetros (Vmax, gradiente medio, AVA por continuidad) y reconocer la concordancia moderada.',
    'Medir el TSVI en PLAX con zoom en mesosístole y el VTI del TSVI en A5C con el volumen de muestra bien posicionado.',
    'Reconocer el índice de velocidades (≈ 0,4) y la calcificación valvular en PSAX.',
  ],
  requiredViews: [
    { viewId: 'plax', minScore: 65 },
    { viewId: 'psax-av', minScore: 55 },
    { viewId: 'a5c', minScore: 60 },
  ],
  requiredMeasurements: [
    { measurementId: 'lvot-diameter', tolerancePct: 10 },
    { measurementId: 'lvot-vti', tolerancePct: 15 },
    { measurementId: 'av-vmax', tolerancePct: 10 },
    { measurementId: 'av-vti', tolerancePct: 15 },
  ],
  difficulty: 2,
  references: [
    {
      referenceId: 'ase-eacvi-aortic-stenosis-2017',
      usage: 'criterios de severidad moderada y ecuación de continuidad',
    },
  ],
  impressionTruth: [
    'Estenosis aórtica moderada calcificada (Vmax ≈ 3,2 m/s, gradiente medio ≈ 22 mmHg, AVA ≈ 1,1 cm²).',
    'Hipertrofia concéntrica leve con función sistólica conservada.',
    'Alteración de la relajación.',
  ],
  expectedDeviations: ['ivsd', 'lvpwd', 'lavi'], // mildly enlarged LA with impaired relaxation
};
