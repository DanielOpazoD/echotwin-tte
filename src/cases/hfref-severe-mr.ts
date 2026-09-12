import type { CaseDefinitionInput } from './schema';
import { normalExcellentCase } from './normal-excellent';

/**
 * Case 3 — Severe global HFrEF: dilated, spherical LV with EF ≈ 24 %, reduced longitudinal function,
 * restrictive-like filling, enlarged LA and mild–moderate functional (central) MR. Sinus 88 bpm.
 */
export const hfrefSevereMrCase: CaseDefinitionInput = {
  ...normalExcellentCase,
  id: 'hfref-severe-mr',
  title: 'Insuficiencia cardíaca con FE reducida — VI dilatado, IM funcional',
  seed: 303,
  history: 'Paciente sintético de 66 años con miocardiopatía dilatada, disnea NYHA III y ortopnea. Sin datos reales de paciente.',
  demographics: { ageYears: 66, sexForReference: 'male', heightCm: 172, weightKg: 84 },
  bodyHabitus: { chestWallThicknessCm: 2.4, chestWidthCm: 34, chestDepthCm: 23, ribSpacingCm: 2.6, intercostalWidthCm: 1.5 },
  rhythm: { type: 'sinus', heartRateBpm: 88, rrVariabilityPct: 3, pvcProbability: 0 },
  anatomy: {
    ...normalExcellentCase.anatomy,
    lv: { eddCm: 6.6, lengthEdCm: 9.8, ivsdCm: 0.8, lvpwdCm: 0.8, sphericity: 0.8, apexWallThicknessCm: 0.5 },
    la: { apDiameterCm: 4.7, volumeMl: 98 },
    rv: { basalDiameterCm: 3.9, lengthCm: 7.8, freeWallThicknessCm: 0.4, septalFlattening: 0 },
    ra: { volumeMl: 58 },
    aorta: { lvotDiameterCm: 2.1, annulusCm: 2.4, sinusCm: 3.3, ascendingCm: 3.2 },
    mitral: { ...normalExcellentCase.anatomy.mitral, annulusDiameterCm: 3.6, maxOpeningDeg: 55 },
    tricuspid: { annulusDiameterCm: 3.8 },
    ivc: { diameterCm: 2.2, collapsePct: 40 },
  },
  physiology: {
    edvMl: 250,
    esvMl: 190,
    mapseCm: 0.6,
    tapseCm: 1.6,
    ePeakMps: 0.95,
    aPeakMps: 0.4,
    decelerationTimeMs: 140,
    ivrtMs: 60,
    ePrimeSeptalCmps: 4,
    ePrimeLateralCmps: 5,
    sPrimeTricuspidCmps: 9,
    contractility: 0.45,
  },
  hemodynamics: {
    systolicBpMmHg: 105,
    diastolicBpMmHg: 70,
    rapMmHg: 8,
    paspMmHg: 48,
    avEffectiveAreaCm2: 2.8,
    trPresent: true,
    lvotPeakGradientMmHg: 0,
    regurgitation: { mr: { eroaCm2: 0.25, jetDirectionDeg: 0 } },
  },
  acousticWindow: { chestWallAttenuation: 0.3, lungOverlapCm: 0.4, clutterLevel: 0.3, obesityAttenuation: 0.25, emphysemaScatter: 0.1, cardiacRotationDeg: 0 },
  flowPrimitives: [...normalExcellentCase.flowPrimitives, { id: 'mr', site: 'mr-jet', enabled: true, turbulence: 0.35 }],
  learningObjectives: [
    'Reconocer un VI dilatado y esférico con hipocinesia global y cuantificar la FEVI por Simpson biplano.',
    'Diferenciar el volumen sistólico total (Simpson) del volumen sistólico anterógrado (TSVI) en presencia de insuficiencia mitral.',
    'Caracterizar la IM funcional central con color y Doppler continuo y estimar la PSVD con la IT.',
  ],
  requiredViews: [
    { viewId: 'plax', minScore: 65 },
    { viewId: 'a4c', minScore: 65 },
    { viewId: 'a2c', minScore: 55 },
  ],
  requiredMeasurements: [
    { measurementId: 'lv-edv-simpson', tolerancePct: 15 },
    { measurementId: 'lv-esv-simpson', tolerancePct: 18 },
    { measurementId: 'lvot-vti', tolerancePct: 15 },
    { measurementId: 'mitral-e', tolerancePct: 12 },
  ],
  difficulty: 3,
  references: [
    { referenceId: 'ase-eacvi-chamber-2015', usage: 'volúmenes y FEVI por Simpson; dilatación del VI y la AI' },
    { referenceId: 'ase-eacvi-diastolic-2016', usage: 'patrón de llenado restrictivo' },
  ],
  impressionTruth: [
    'Ventrículo izquierdo severamente dilatado con disfunción sistólica severa (FEVI ≈ 24 %) e hipocinesia global.',
    'Insuficiencia mitral funcional central de grado moderado (ORE ≈ 0,25 cm²) por dilatación anular.',
    'Aurícula izquierda severamente dilatada; patrón de llenado restrictivo con presiones de llenado elevadas; hipertensión pulmonar moderada por IT.',
  ],
  expectedDeviations: ['lv-edv', 'lv-esv', 'lv-ef', 'lv-edvi', 'lv-idd', 'lv-ids', 'lv-shortening', 'ivs-thickening', 'apex-thickness', 'rv-edvi', 'la-ap', 'la-transverse', 'la-long', 'lavi', 'la-emptying', 'la-ao', 'mv-annulus'],
};
