import type { CaseDefinitionInput } from './schema';
import { normalExcellentCase } from './normal-excellent';

/** Case 2 — Normal heart, technically difficult window (attenuation, lung overlap, clutter). */
export const normalDifficultWindowCase: CaseDefinitionInput = {
  ...normalExcellentCase,
  id: 'normal-difficult-window',
  title: 'Normal — ventana difícil (atenuación e interposición pulmonar)',
  seed: 202,
  history: 'Paciente sintético de 61 años, IMC 34, EPOC leve. Evaluación de disnea. Sin datos reales de paciente.',
  demographics: { ageYears: 61, sexForReference: 'female', heightCm: 162, weightKg: 89 },
  bodyHabitus: { chestWallThicknessCm: 3.4, chestWidthCm: 36, chestDepthCm: 25, ribSpacingCm: 2.4, intercostalWidthCm: 1.2 },
  acousticWindow: {
    chestWallAttenuation: 0.6,
    lungOverlapCm: 1.2,
    clutterLevel: 0.55,
    obesityAttenuation: 0.5,
    emphysemaScatter: 0.4,
    cardiacRotationDeg: 0,
  },
  learningObjectives: [
    'Optimizar una ventana difícil: espacio intercostal, espiración, decúbito lateral, frecuencia baja y armónicos.',
    'Reconocer sombra costal e interposición pulmonar y corregirlas con la sonda, no con la ganancia.',
  ],
  requiredViews: [
    { viewId: 'plax', minScore: 55 },
    { viewId: 'a4c', minScore: 55 },
  ],
  difficulty: 3,
};
