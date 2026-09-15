import type { CaseDefinitionInput } from './schema';
import { normalExcellentCase } from './normal-excellent';

/**
 * Case 12 — Artifact challenge: heavy mitral annular and aortic calcification (acoustic shadows), rib
 * shadows and lung reverberation in a poor window, near-field clutter, side lobes, mirror image beyond
 * the pericardium and beam-width smearing; colour blooming appears when the colour gain is raised.
 */
export const artifactChallengeCase: CaseDefinitionInput = {
  ...normalExcellentCase,
  id: 'artifact-challenge',
  title: 'Desafío de artefactos — calcificación, sombra, reverberación y blooming',
  seed: 1212,
  history:
    'Paciente sintético de 79 años, EPOC y calcificación valvular; estudio de difícil interpretación. Sin datos reales de paciente.',
  demographics: { ageYears: 79, sexForReference: 'male', heightCm: 168, weightKg: 80 },
  bodyHabitus: {
    chestWallThicknessCm: 3.0,
    chestWidthCm: 34,
    chestDepthCm: 24,
    ribSpacingCm: 2.4,
    intercostalWidthCm: 1.2,
  },
  rhythm: { type: 'sinus', heartRateBpm: 76, rrVariabilityPct: 3, pvcProbability: 0.03 },
  anatomy: {
    ...normalExcellentCase.anatomy,
    lv: {
      eddCm: 4.7,
      lengthEdCm: 8.4,
      ivsdCm: 1.1,
      lvpwdCm: 1.0,
      sphericity: 0.5,
      apexWallThicknessCm: 0.7,
    },
    la: { apDiameterCm: 3.9, volumeMl: 57 },
    aorta: { lvotDiameterCm: 2.0, annulusCm: 2.3, sinusCm: 3.4, ascendingCm: 3.5 },
    mitral: { ...normalExcellentCase.anatomy.mitral, calcification: 0.85, thickeningCm: 0.2 },
    aorticValve: {
      maxOpeningFraction: 0.6,
      calcification: 0.7,
      cuspThicknessCm: 0.2,
      bicuspid: false,
    },
  },
  physiology: {
    ...normalExcellentCase.physiology,
    edvMl: 115,
    esvMl: 46,
    mapseCm: 1.2,
    ePeakMps: 0.75,
    aPeakMps: 0.85,
    decelerationTimeMs: 230,
    ivrtMs: 100,
    ePrimeSeptalCmps: 5.5,
    ePrimeLateralCmps: 7.5,
  },
  hemodynamics: {
    systolicBpMmHg: 142,
    diastolicBpMmHg: 78,
    rapMmHg: 3,
    paspMmHg: 34,
    avEffectiveAreaCm2: 1.4,
    trPresent: true,
    lvotPeakGradientMmHg: 0,
    regurgitation: { mr: { eroaCm2: 0.1, jetDirectionDeg: 0 } },
  },
  acousticWindow: {
    chestWallAttenuation: 0.45,
    lungOverlapCm: 0.9,
    clutterLevel: 0.6,
    obesityAttenuation: 0.35,
    emphysemaScatter: 0.35,
    cardiacRotationDeg: 5,
  },
  artifacts: [
    { type: 'rib-shadow', intensity: 0.8, enabled: true },
    { type: 'lung-reverberation', intensity: 0.7, enabled: true },
    { type: 'near-field-clutter', intensity: 0.7, enabled: true },
    { type: 'calcium-shadow', intensity: 0.9, enabled: true },
    { type: 'mirror', intensity: 0.6, enabled: true },
    { type: 'side-lobe', intensity: 0.6, enabled: true },
    { type: 'beam-width', intensity: 0.5, enabled: true },
  ],
  flowPrimitives: [
    ...normalExcellentCase.flowPrimitives,
    { id: 'mr', site: 'mr-jet', enabled: true, turbulence: 0.3 },
  ],
  learningObjectives: [
    'Reconocer la sombra acústica de la calcificación anular mitral y aórtica y buscar ventanas alternativas antes de subir la ganancia.',
    'Identificar reverberación pulmonar (líneas A), clutter de campo cercano, lóbulos laterales y la imagen en espejo bajo el pericardio, y corregirlos con posición, frecuencia, armónicos y foco.',
    'Demostrar el blooming del color al subir la ganancia Doppler y su efecto sobre la aparente severidad de una IM leve.',
  ],
  requiredViews: [
    { viewId: 'plax', minScore: 55 },
    { viewId: 'a4c', minScore: 55 },
    { viewId: 'psax-av', minScore: 45 },
  ],
  requiredMeasurements: [
    { measurementId: 'av-vmax', tolerancePct: 12 },
    { measurementId: 'lvot-diameter', tolerancePct: 12 },
  ],
  difficulty: 5,
  references: [
    { referenceId: 'ase-tte-2019', usage: 'optimización de imagen y reconocimiento de artefactos' },
  ],
  impressionTruth: [
    'Esclerosis aórtica con estenosis leve (Vmax ≈ 2,5 m/s) y calcificación anular mitral severa con sombra acústica.',
    'Insuficiencia mitral leve; función sistólica conservada; aurícula izquierda levemente dilatada.',
    'Estudio técnicamente difícil por atenuación, interposición pulmonar y artefactos.',
  ],
  expectedDeviations: ['ivsd', 'lvpwd', 'ao-ascending'],
};
