import type { CaseDefinitionInput } from './schema';
import { normalExcellentCase } from './normal-excellent';

/** Case 9 — Pulmonary hypertension with RV dilation/dysfunction: PASP ≈ 72 mmHg, TR, D-shaped LV, reduced TAPSE and S′, dilated RA and IVC. */
export const pulmonaryHypertensionRvCase: CaseDefinitionInput = {
  ...normalExcellentCase,
  id: 'pulmonary-hypertension-rv',
  title: 'Hipertensión pulmonar con dilatación y disfunción del VD',
  seed: 909,
  history:
    'Paciente sintética de 61 años con disnea progresiva, edema de miembros inferiores y segundo ruido reforzado. Sin datos reales de paciente.',
  demographics: { ageYears: 61, sexForReference: 'female', heightCm: 163, weightKg: 70 },
  bodyHabitus: {
    chestWallThicknessCm: 2.3,
    chestWidthCm: 32,
    chestDepthCm: 21,
    ribSpacingCm: 2.5,
    intercostalWidthCm: 1.5,
  },
  rhythm: { type: 'sinus', heartRateBpm: 84, rrVariabilityPct: 2, pvcProbability: 0 },
  anatomy: {
    ...normalExcellentCase.anatomy,
    lv: {
      eddCm: 4.0,
      lengthEdCm: 8.0,
      ivsdCm: 0.85,
      lvpwdCm: 0.78,
      sphericity: 0.45,
      apexWallThicknessCm: 0.6,
    },
    la: { apDiameterCm: 3.3, volumeMl: 46 },
    rv: { basalDiameterCm: 4.9, lengthCm: 8.6, freeWallThicknessCm: 0.7, septalFlattening: 0.8 },
    ra: { volumeMl: 78 },
    aorta: { lvotDiameterCm: 1.9, annulusCm: 2.2, sinusCm: 2.9, ascendingCm: 2.8 },
    mitral: { ...normalExcellentCase.anatomy.mitral, annulusDiameterCm: 2.8 },
    tricuspid: { annulusDiameterCm: 4.4 },
    // main pulmonary artery dilated: above 25 mm is an echocardiographic sign of pulmonary hypertension (ESC/ERS 2022)
    pulmonaryArtery: { trunkDiameterCm: 3.2 },
    ivc: { diameterCm: 2.5, collapsePct: 20 },
  },
  physiology: {
    ...normalExcellentCase.physiology,
    edvMl: 85,
    esvMl: 35,
    mapseCm: 1.2,
    tapseCm: 1.3,
    ePeakMps: 0.6,
    aPeakMps: 0.7,
    decelerationTimeMs: 220,
    ivrtMs: 95,
    ePrimeSeptalCmps: 6,
    ePrimeLateralCmps: 9,
    sPrimeTricuspidCmps: 7,
  },
  hemodynamics: {
    systolicBpMmHg: 115,
    diastolicBpMmHg: 72,
    rapMmHg: 10,
    paspMmHg: 72,
    avEffectiveAreaCm2: 2.8,
    trPresent: true,
    lvotPeakGradientMmHg: 0,
    regurgitation: { tr: { eroaCm2: 0.3 } },
  },
  flowPrimitives: normalExcellentCase.flowPrimitives.map((f) =>
    f.site === 'tr-jet' ? { ...f, turbulence: 0.35 } : f,
  ),
  learningObjectives: [
    'Reconocer la dilatación del VD (relación VD/VI basal > 1) y el septo aplanado en «D» en el eje corto (sobrecarga de presión).',
    'Cuantificar la función del VD con TAPSE en modo M y S′ tisular, y la PSVD con la Vmax de la IT más la presión de la AD por la VCI.',
    'Alinear el Doppler continuo con el chorro de IT desde la ventana apical o paraesternal para no subestimar la velocidad.',
  ],
  requiredViews: [
    { viewId: 'a4c', minScore: 65 },
    { viewId: 'rv-focused', minScore: 55 },
    { viewId: 'psax-pm', minScore: 55 },
    { viewId: 'psax-av', minScore: 50 },
  ],
  requiredMeasurements: [
    { measurementId: 'tapse', tolerancePct: 12 },
    { measurementId: 'tr-vmax', tolerancePct: 10 },
    { measurementId: 'lv-edd', tolerancePct: 10 },
  ],
  difficulty: 3,
  references: [
    {
      referenceId: 'ase-right-heart-2025',
      usage: 'dimensiones y función del VD; estimación de la PSVD',
    },
  ],
  impressionTruth: [
    'Ventrículo derecho severamente dilatado con hipertrofia de la pared libre y disfunción sistólica (TAPSE ≈ 1,3 cm, S′ ≈ 7 cm/s).',
    'Septo interventricular aplanado en sístole (sobrecarga de presión); ventrículo izquierdo pequeño con llenado reducido.',
    'Insuficiencia tricuspídea moderada con PSVD estimada ≈ 72 mmHg; aurícula derecha dilatada y VCI dilatada con colapso reducido.',
  ],
  expectedDeviations: [
    'lv-idd',
    'rv-edvi',
    // a right ventricle 4.9 cm wide at the base is dilated at mid-cavity and in absolute volume too (decision 138:
    // the inflow below the 4.4 cm annulus keeps its width over the leaflets)
    'rv-edv',
    // systolic dysfunction of the case (TAPSE 1.3 cm, S′ 7 cm/s): 44 % once the outflow tract contracts less than the
    // body (decision 214); 48 % before, on the edge of normal
    'rv-ef',
    'rv-mid',
    'rv-basal',
    'rv-lv-basal-ratio',
    'rv-wall',
    'rv-plax',
    'ravi',
    'ra-transverse',
    'ra-long',
    'tv-annulus',
    'tv-mv-ratio',
    'pa',
  ],
};
