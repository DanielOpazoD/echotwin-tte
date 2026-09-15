import type { Measurement } from '@/simulator/measurements/types';
import type { ImagingModality } from '@/simulator/renderer/types';

/**
 * Staged curriculum (proposal 7): modules → lessons → tasks with automatic completion checks
 * evaluated against a snapshot of the learner's state. Tasks never move the probe for the learner;
 * each states why it matters (the causal thread of spec 91). Task ids are stable (progress keys).
 */
export interface LearnerSnapshot {
  caseId: string;
  mode: 'sandbox' | 'guided' | 'exam';
  viewProgress: Record<string, number>;
  bestView: { id: string; score: number } | null;
  modality: ImagingModality;
  colorScaleMps: number;
  colorGainDb: number;
  gateStructure: number | null;
  gateFlowAngleDeg: number | null;
  measurements: Measurement[];
  impressionScore: number | null;
  settings: { depthCm: number; gainDb: number; frequencyMHz: number; harmonics: boolean };
}

export interface Task {
  id: string;
  title: string;
  why: string;
  caseId?: string;
  check: (s: LearnerSnapshot) => boolean;
}

export interface Lesson {
  id: string;
  title: string;
  goal: string;
  tasks: Task[];
}

export interface Module {
  id: string;
  title: string;
  lessons: Lesson[];
}

const viewAtLeast = (viewId: string, score: number) => (s: LearnerSnapshot) =>
  (s.viewProgress[viewId] ?? 0) >= score;
const measuredOk =
  (measurementId: string, minTechnique = 0.75) =>
  (s: LearnerSnapshot) =>
    s.measurements.some(
      (m) => m.measurementId === measurementId && (m.technique?.score ?? 0) >= minTechnique,
    );
const measuredAny = (measurementId: string) => (s: LearnerSnapshot) =>
  s.measurements.some((m) => m.measurementId === measurementId);

export const CURRICULUM: Module[] = [
  {
    id: 'fundamentals',
    title: '1 · Fundamentos: ventana, plano y referencias',
    lessons: [
      {
        id: 'parasternal',
        title: 'Ventana paraesternal',
        goal: 'Obtener PLAX y los tres niveles de PSAX moviendo la sonda, no con botones.',
        tasks: [
          {
            id: 'plax-70',
            title: 'PLAX con score ≥ 70 (caso normal)',
            why: 'El eje largo es la referencia de todas las medidas lineales del VI y de la raíz aórtica; un plano oblicuo las sobreestima.',
            caseId: 'normal-excellent-window',
            check: viewAtLeast('plax', 70),
          },
          {
            id: 'psax-mv-60',
            title: 'PSAX nivel mitral ≥ 60',
            why: 'Al rotar 90° sin desplazar la sonda se comprueba que el plano gira alrededor del mismo eje del haz.',
            caseId: 'normal-excellent-window',
            check: viewAtLeast('psax-mv', 60),
          },
          {
            id: 'psax-pm-60',
            title: 'PSAX nivel papilar ≥ 60',
            why: 'Es el nivel donde se evalúan los 6 segmentos medios y la simetría del VI (circular = plano perpendicular).',
            caseId: 'normal-excellent-window',
            check: viewAtLeast('psax-pm', 60),
          },
          {
            id: 'psax-av-55',
            title: 'PSAX nivel aórtico ≥ 55',
            why: 'Angular hacia la base muestra la válvula aórtica «de frente»: su eje está 30° inclinado respecto del VI.',
            caseId: 'normal-excellent-window',
            check: viewAtLeast('psax-av', 55),
          },
        ],
      },
      {
        id: 'apical',
        title: 'Ventana apical',
        goal: 'Encontrar el ápex verdadero y rotar 60° entre A4C, A2C y A3C.',
        tasks: [
          {
            id: 'a4c-70',
            title: 'A4C con score ≥ 70',
            why: 'El acortamiento apical es el error más frecuente: Simpson subestima volúmenes y la FE parece mejor.',
            caseId: 'normal-excellent-window',
            check: viewAtLeast('a4c', 70),
          },
          {
            id: 'a2c-55',
            title: 'A2C ≥ 55 rotando ~60° antihorario',
            why: 'Con 60° el VD desaparece y quedan las paredes anterior e inferior: la rotación correcta es geométrica, no estética.',
            caseId: 'normal-excellent-window',
            check: viewAtLeast('a2c', 55),
          },
          {
            id: 'a5c-60',
            title: 'A5C ≥ 60 angulando anterior',
            why: 'Abrir el TSVI desde el ápex es la única forma de alinear el Doppler con el flujo aórtico.',
            caseId: 'normal-excellent-window',
            check: viewAtLeast('a5c', 60),
          },
        ],
      },
    ],
  },
  {
    id: 'optimisation',
    title: '2 · Optimización de imagen y artefactos',
    lessons: [
      {
        id: 'difficult-window',
        title: 'Ventana difícil',
        goal: 'Conseguir PLAX y A4C en el paciente con atenuación e interposición pulmonar.',
        tasks: [
          {
            id: 'difficult-plax-55',
            title: 'PLAX ≥ 55 en ventana difícil',
            why: 'La estrategia es posicional (espacio intercostal, espiración, presión, armónicos), no subir la ganancia.',
            caseId: 'normal-difficult-window',
            check: (s) => s.caseId === 'normal-difficult-window' && viewAtLeast('plax', 55)(s),
          },
          {
            id: 'difficult-a4c-55',
            title: 'A4C ≥ 55 en ventana difícil',
            why: 'El pulmón interpuesto se esquiva deslizando medial y pidiendo espiración; la ganancia no atraviesa el aire.',
            caseId: 'normal-difficult-window',
            check: (s) => s.caseId === 'normal-difficult-window' && viewAtLeast('a4c', 55)(s),
          },
        ],
      },
      {
        id: 'artifacts',
        title: 'Artefactos',
        goal: 'Reconocer sombra, reverberación, clutter, lóbulos laterales y espejo en el caso de artefactos.',
        tasks: [
          {
            id: 'artifact-plax-50',
            title: 'PLAX ≥ 50 en el caso de artefactos',
            why: 'Cada artefacto tiene una causa física y un remedio; identificarlos evita medir sobre ecos falsos.',
            caseId: 'artifact-challenge',
            check: (s) => s.caseId === 'artifact-challenge' && viewAtLeast('plax', 50)(s),
          },
        ],
      },
    ],
  },
  {
    id: 'doppler',
    title: '3 · Doppler: color, alineación y PRF',
    lessons: [
      {
        id: 'colour',
        title: 'Color y escala',
        goal: 'Localizar el flujo con color y entender aliasing y blooming.',
        tasks: [
          {
            id: 'colour-low-scale',
            title: 'Color activo con escala ≤ 0,35 m/s (aliasing visible)',
            why: 'Con PRF baja el flujo normal supera Nyquist y se pliega: el mosaico no es turbulencia.',
            check: (s) => s.modality === 'color' && s.colorScaleMps <= 0.35,
          },
          {
            id: 'colour-normal-scale',
            title: 'Color con escala ≥ 0,55 m/s y ganancia ≤ 3 dB',
            why: 'La escala fisiológica y la ganancia justa muestran el flujo sin plegado ni rebose sobre el tejido.',
            check: (s) => s.modality === 'color' && s.colorScaleMps >= 0.55 && s.colorGainDb <= 3,
          },
        ],
      },
      {
        id: 'alignment',
        title: 'Alineación del haz',
        goal: 'Colocar el volumen de muestra en el TSVI con un ángulo haz–flujo ≤ 20°.',
        tasks: [
          {
            id: 'pw-lvot-aligned',
            title: 'PW con gate en el TSVI y ángulo ≤ 20°',
            why: 'El Doppler mide v·cos θ: la alineación se consigue con la ventana y la angulación, no con un botón.',
            check: (s) =>
              s.modality === 'pw' &&
              s.gateStructure === 18 &&
              s.gateFlowAngleDeg !== null &&
              s.gateFlowAngleDeg <= 20,
          },
          {
            id: 'lvot-vti-ok',
            title: 'VTI del TSVI con técnica ≥ 0,75',
            why: 'El VTI es la base del volumen sistólico y de la ecuación de continuidad; su técnica se evalúa por vista, gate y ángulo.',
            check: measuredOk('lvot-vti'),
          },
        ],
      },
    ],
  },
  {
    id: 'measurements',
    title: '4 · Mediciones con técnica',
    lessons: [
      {
        id: 'linear',
        title: 'Medidas lineales',
        goal: 'Medir TSVI, DTDVI y grosores en el cuadro y el plano correctos.',
        tasks: [
          {
            id: 'lvot-diameter-ok',
            title: 'Diámetro del TSVI con técnica ≥ 0,75',
            why: 'Su error se eleva al cuadrado en el área: 1 mm de error son ~10 % del volumen sistólico.',
            check: measuredOk('lvot-diameter'),
          },
          {
            id: 'lv-edd-ok',
            title: 'DTDVI en telediástole con técnica ≥ 0,75',
            why: 'Medir en el cuadro equivocado (sístole) o sobre un plano oblicuo cambia el diámetro varios milímetros.',
            check: measuredOk('lv-edd'),
          },
        ],
      },
      {
        id: 'volumes',
        title: 'Volúmenes y función',
        goal: 'Simpson en A4C sin acortamiento; E/A y e′.',
        tasks: [
          {
            id: 'simpson-edv',
            title: 'VTD por Simpson trazado en A4C',
            why: 'El trazado del endocardio y la longitud del eje largo determinan el volumen; el acortamiento lo subestima.',
            check: measuredAny('lv-edv-simpson'),
          },
          {
            id: 'simpson-esv',
            title: 'VTS por Simpson en telesístole',
            why: 'La FE deriva de dos trazados: el cuadro telesistólico es el de cavidad mínima antes de abrirse la mitral.',
            check: measuredAny('lv-esv-simpson'),
          },
          {
            id: 'mitral-e-ok',
            title: 'Onda E con el gate en las puntas mitrales',
            why: 'Un gate en el anillo o en la aurícula cambia la forma y la velocidad de la onda E.',
            check: measuredOk('mitral-e'),
          },
        ],
      },
    ],
  },
  {
    id: 'cases',
    title: '5 · Casos integradores',
    lessons: [
      {
        id: 'pathology',
        title: 'Reconocer la patología y redactar la impresión',
        goal: 'Completar la impresión estructurada con puntuación ≥ 70 en cada caso.',
        tasks: [
          {
            id: 'impression-as',
            title: 'Impresión ≥ 70 en la estenosis aórtica severa',
            why: 'Vmax, gradiente medio y AVA deben integrarse en un solo juicio de severidad.',
            caseId: 'aortic-stenosis-severe',
            check: (s) => s.caseId === 'aortic-stenosis-severe' && (s.impressionScore ?? 0) >= 70,
          },
          {
            id: 'impression-hfref',
            title: 'Impresión ≥ 70 en la ICFEr',
            why: 'Distinguir disfunción severa con IM funcional y presiones de llenado elevadas.',
            caseId: 'hfref-severe-mr',
            check: (s) => s.caseId === 'hfref-severe-mr' && (s.impressionScore ?? 0) >= 70,
          },
          {
            id: 'impression-ph',
            title: 'Impresión ≥ 70 en la hipertensión pulmonar',
            why: 'El corazón derecho se juzga por tamaño, función, septo y PSVD, no por un solo número.',
            caseId: 'pulmonary-hypertension-rv',
            check: (s) =>
              s.caseId === 'pulmonary-hypertension-rv' && (s.impressionScore ?? 0) >= 70,
          },
          {
            id: 'impression-tamponade',
            title: 'Impresión ≥ 70 en el taponamiento',
            why: 'Reconocer colapsos y corazón oscilante convierte un derrame en una emergencia.',
            caseId: 'pericardial-effusion-tamponade',
            check: (s) =>
              s.caseId === 'pericardial-effusion-tamponade' && (s.impressionScore ?? 0) >= 70,
          },
        ],
      },
    ],
  },
];

export function allTasks(): Task[] {
  return CURRICULUM.flatMap((m) => m.lessons.flatMap((l) => l.tasks));
}

/** Ids of the tasks whose check passes for this snapshot. */
export function evaluateTasks(s: LearnerSnapshot): string[] {
  return allTasks()
    .filter((t) => t.check(s))
    .map((t) => t.id);
}
