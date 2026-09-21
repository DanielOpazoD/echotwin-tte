import type { CaseDefinitionInput } from './schema';

/** Case 1 — Normal adult, excellent acoustic window, sinus rhythm 65 bpm. */
export const normalExcellentCase: CaseDefinitionInput = {
  schemaVersion: 1,
  id: 'normal-excellent-window',
  title: 'Normal — ventana excelente, sinusal 65 lpm',
  seed: 101,
  history:
    'Paciente sintético de 32 años, sin antecedentes, evaluación por soplo funcional. Sin datos reales de paciente.',
  demographics: { ageYears: 32, sexForReference: 'male', heightCm: 176, weightKg: 72 },
  bodyHabitus: {
    chestWallThicknessCm: 2.0,
    chestWidthCm: 32,
    chestDepthCm: 21,
    ribSpacingCm: 2.6,
    intercostalWidthCm: 1.7,
  },
  rhythm: { type: 'sinus', heartRateBpm: 65, rrVariabilityPct: 2, pvcProbability: 0 },
  anatomy: {
    lv: {
      eddCm: 4.8,
      lengthEdCm: 8.6,
      ivsdCm: 0.9,
      lvpwdCm: 0.9,
      sphericity: 0.5,
      apexWallThicknessCm: 0.7,
    },
    la: { apDiameterCm: 3.5, volumeMl: 52 },
    rv: { basalDiameterCm: 3.4, lengthCm: 7.4, freeWallThicknessCm: 0.4 },
    ra: { volumeMl: 45 },
    aorta: { lvotDiameterCm: 2.1, annulusCm: 2.4, sinusCm: 3.2, ascendingCm: 3.0 },
    mitral: {
      annulusDiameterCm: 3.0,
      anteriorLeafletLengthCm: 2.4,
      posteriorLeafletLengthCm: 1.3,
      maxOpeningDeg: 70,
      calcification: 0,
      thickeningCm: 0.1,
      samSeverity: 0,
    },
    aorticValve: {
      maxOpeningFraction: 1,
      calcification: 0,
      cuspThicknessCm: 0.08,
      bicuspid: false,
    },
    tricuspid: { annulusDiameterCm: 3.3 },
    ivc: { diameterCm: 1.7, collapsePct: 70 },
    pericardium: { effusionCm: 0 },
    // The long axis (mitral centre → apex) projects 36° below the leftward horizontal in the frontal plane and 47° anterior
    // of leftward in the transverse plane: healthy adults measure 38 ± 10° and 46 ± 7° by cardiac MRI (Engblom et al., Am
    // Heart J 2005;150:507, n = 94). Until decision 139 the transverse angle was 37°: the axis ran too close to the chest
    // wall, left the skin 3.4 cm lateral of the apex and kept the apex 2.1 cm behind the wall along it, so no probe on
    // the apex looked down the ventricle. The axis turned 9° forward about the apex tip, and the heart moved 0.8 cm out
    // along it: the tip rests 0.9 cm behind the chest wall along the axis (the apex beat), which puts the cavity apex
    // 25-28 mm under the apical probe, as in clinical four-chamber images (CAMUS Good, median 27 mm). The mitral centre
    // sits behind the fourth costal cartilage, 1.7 cm left of the midline (2.3 cm with the lateral decubitus shift).
    heartPosition: {
      baseCm: { x: 1.682, y: -0.269, z: -8.458 },
      longAxis: { x: 0.611, y: -0.45, z: 0.651 },
      anterior: { x: 0.092, y: 0.858, z: 0.506 },
    },
    wallMotion: [],
  },
  physiology: {
    edvMl: 120,
    esvMl: 45,
    mapseCm: 1.4,
    tapseCm: 2.2,
    ePeakMps: 0.8,
    aPeakMps: 0.55,
    decelerationTimeMs: 180,
    ivrtMs: 75,
    ePrimeSeptalCmps: 11,
    ePrimeLateralCmps: 14,
    sPrimeTricuspidCmps: 13,
    contractility: 1,
  },
  hemodynamics: {
    systolicBpMmHg: 120,
    diastolicBpMmHg: 75,
    rapMmHg: 3,
    paspMmHg: 25,
    avEffectiveAreaCm2: 3.0,
    trPresent: true,
    regurgitation: {},
  },
  acousticWindow: {
    chestWallAttenuation: 0.1,
    lungOverlapCm: 0,
    clutterLevel: 0.1,
    obesityAttenuation: 0.05,
    emphysemaScatter: 0,
    cardiacRotationDeg: 0,
  },
  flowPrimitives: [
    { id: 'mv', site: 'mitral-inflow', enabled: true, turbulence: 0.04 },
    { id: 'lvot', site: 'lvot', enabled: true, turbulence: 0.04 },
    { id: 'av', site: 'aortic-valve', enabled: true, turbulence: 0.05 },
    { id: 'tv', site: 'tricuspid-inflow', enabled: true, turbulence: 0.04 },
    { id: 'rvot', site: 'rvot', enabled: true, turbulence: 0.04 },
    { id: 'tr', site: 'tr-jet', enabled: true, turbulence: 0.2 },
  ],
  artifacts: [
    { type: 'rib-shadow', intensity: 1, enabled: true },
    { type: 'lung-reverberation', intensity: 1, enabled: true },
    { type: 'near-field-clutter', intensity: 0.3, enabled: true },
  ],
  learningObjectives: [
    'Obtener PLAX con septum, pared posterior, válvula mitral, LVOT, válvula aórtica y AI alineados.',
    'Rotar 90° en sentido horario hacia PSAX y recorrer los niveles aórtico, mitral y papilar.',
    'Adquirir A4C con ápex verdadero y evitar acortamiento.',
    'Medir LVOT y VTI con un Doppler pulsado bien alineado.',
  ],
  requiredViews: [
    { viewId: 'plax', minScore: 70 },
    { viewId: 'psax-mv', minScore: 60 },
    { viewId: 'psax-pm', minScore: 60 },
    { viewId: 'a4c', minScore: 70 },
  ],
  requiredMeasurements: [
    { measurementId: 'lvot-diameter', tolerancePct: 10 },
    { measurementId: 'lv-edd', tolerancePct: 10 },
    { measurementId: 'lvot-vti', tolerancePct: 15 },
    { measurementId: 'mitral-e', tolerancePct: 15 },
  ],
  difficulty: 1,
  references: [
    { referenceId: 'ase-tte-2019', usage: 'protocolo de vistas y sitios de medición' },
    { referenceId: 'ase-eacvi-chamber-2015', usage: 'rangos normales de cavidades' },
  ],
  impressionTruth: [
    'Ventrículo izquierdo de dimensiones y función sistólica normales.',
    'Válvulas morfológica y funcionalmente normales.',
    'Sin derrame pericárdico.',
  ],
};
