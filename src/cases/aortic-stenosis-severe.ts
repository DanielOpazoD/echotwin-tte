import type { CaseDefinitionInput } from './schema';
import { normalExcellentCase } from './normal-excellent';

/**
 * Case 6 — Severe aortic stenosis with preserved flow. Ground truth emerges from the SAME model:
 * effective AVA 0.88 cm² with SV ~78 mL gives Vmax ≈ 4.7 m/s, mean gradient ≈ 44 mmHg, VTI ratio ≈ 0.25
 * (values are computed by `computeGroundTruth`, never typed by hand; see docs/CASE_SCHEMA.md).
 */
export const aorticStenosisSevereCase: CaseDefinitionInput = {
  ...normalExcellentCase,
  id: 'aortic-stenosis-severe',
  title: 'Estenosis aórtica severa con flujo conservado',
  seed: 606,
  history:
    'Paciente sintético de 74 años con disnea de esfuerzo y soplo sistólico eyectivo irradiado a carótidas. Sin datos reales de paciente.',
  demographics: { ageYears: 74, sexForReference: 'male', heightCm: 170, weightKg: 78 },
  rhythm: { type: 'sinus', heartRateBpm: 68, rrVariabilityPct: 2, pvcProbability: 0 },
  anatomy: {
    ...normalExcellentCase.anatomy,
    lv: {
      eddCm: 4.7,
      lengthEdCm: 8.5,
      ivsdCm: 1.4,
      lvpwdCm: 1.3,
      sphericity: 0.5,
      apexWallThicknessCm: 0.9,
    },
    la: { apDiameterCm: 4.2, volumeMl: 78 },
    aorta: { lvotDiameterCm: 2.1, annulusCm: 2.4, sinusCm: 3.4, ascendingCm: 3.8 },
    aorticValve: {
      maxOpeningFraction: 0.3,
      calcification: 0.85,
      cuspThicknessCm: 0.25,
      bicuspid: false,
    },
    mitral: { ...normalExcellentCase.anatomy.mitral, calcification: 0.3 },
  },
  physiology: {
    ...normalExcellentCase.physiology,
    edvMl: 125,
    esvMl: 47,
    mapseCm: 1.0, // reduced longitudinal function with preserved EF (concentric LVH)
    ePeakMps: 0.65,
    aPeakMps: 0.85,
    decelerationTimeMs: 240,
    ivrtMs: 100,
    ePrimeSeptalCmps: 5.5,
    ePrimeLateralCmps: 7,
  },
  hemodynamics: {
    systolicBpMmHg: 135,
    diastolicBpMmHg: 80,
    rapMmHg: 3,
    paspMmHg: 38,
    avEffectiveAreaCm2: 0.88, // computeGroundTruth: Vmax 4.69 m/s, mean 44 mmHg, AVA 0.88 cm² (all three severe criteria)
    trPresent: true,
    regurgitation: {},
  },
  flowPrimitives: [
    { id: 'mv', site: 'mitral-inflow', enabled: true, turbulence: 0.05 },
    { id: 'lvot', site: 'lvot', enabled: true, turbulence: 0.06 },
    { id: 'av', site: 'aortic-valve', enabled: true, turbulence: 0.45 },
    { id: 'tv', site: 'tricuspid-inflow', enabled: true, turbulence: 0.04 },
    { id: 'rvot', site: 'rvot', enabled: true, turbulence: 0.04 },
    { id: 'tr', site: 'tr-jet', enabled: true, turbulence: 0.25 },
  ],
  artifacts: [
    { type: 'rib-shadow', intensity: 1, enabled: true },
    { type: 'lung-reverberation', intensity: 1, enabled: true },
    { type: 'calcium-shadow', intensity: 1, enabled: true },
    { type: 'near-field-clutter', intensity: 0.3, enabled: true },
  ],
  learningObjectives: [
    'Identificar válvula aórtica engrosada, calcificada y con apertura restringida en PLAX y PSAX.',
    'Medir TSVI en PLAX (mesosístole, borde interno) y VTI TSVI con PW en A5C/A3C.',
    'Obtener Vmax y VTI transaórticos con CW bien alineado; demostrar la subestimación por mala alineación.',
    'Calcular AVA por continuidad y gradiente medio, y graduar la severidad con criterios ASE/EACVI 2017.',
  ],
  requiredViews: [
    { viewId: 'plax', minScore: 65 },
    { viewId: 'psax-av', minScore: 55 },
    { viewId: 'a5c', minScore: 55 },
  ],
  requiredMeasurements: [
    { measurementId: 'lvot-diameter', tolerancePct: 10 },
    { measurementId: 'lvot-vti', tolerancePct: 15 },
    { measurementId: 'av-vmax', tolerancePct: 10 },
    { measurementId: 'av-vti', tolerancePct: 15 },
  ],
  difficulty: 3,
  references: [
    {
      referenceId: 'ase-eacvi-aortic-stenosis-2017',
      usage: 'criterios de severidad y ecuación de continuidad',
    },
    { referenceId: 'ase-tte-2019', usage: 'sitio de medición del TSVI' },
  ],
  impressionTruth: [
    'Estenosis aórtica severa (Vmax ≥ 4 m/s, gradiente medio ≥ 40 mmHg, AVA ≤ 1,0 cm²) con flujo conservado.',
    'Hipertrofia concéntrica leve del ventrículo izquierdo con función sistólica conservada.',
    'Disfunción diastólica compatible con alteración de la relajación; aurícula izquierda dilatada.',
  ],
  // intended departures from the adult reference ranges (checked by proportions.test.ts)
  expectedDeviations: [
    'ivsd', // concentric hypertrophy
    'lvpwd',
    // enlarged left atrium (chronic pressure overload, diastolic dysfunction): by volume and across it; its AP and long
    // axes fell inside their ranges once the atrium was drawn at its declared volume (decision 161)
    'la-transverse',
    'lavi',
    // (its mass, over the range until decision 226, falls inside it with the base narrowed into the mitral annulus)
    'apex-thickness', // the hypertrophy reaches the apex
    'ao-ascending', // post-stenotic dilation of the ascending aorta
  ],
};
