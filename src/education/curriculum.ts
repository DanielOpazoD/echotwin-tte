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
  /** Best score of each view reached by moving the probe, without its preset (decision 174). */
  handViewProgress: Record<string, number>;
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
  /** The view the task is worked in: «Abrir tarea» sets it as the target view of the guided mode. */
  viewId?: string;
  /**
   * The tasks this one builds on (decision 260): it stays locked, and is not completed even when its check passes, until
   * they are done — the five-chamber view before the outflow-tract Doppler, the biplane volumes before grading the MR.
   */
  requires?: string[];
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

/**
 * A view reached by hand (decision 174): a score reached with the view's preset does not complete a task, or pressing the
 * button would teach nothing; after using it the learner reloads the case to try again.
 */
const viewAtLeast = (viewId: string, score: number) => (s: LearnerSnapshot) =>
  (s.handViewProgress[viewId] ?? 0) >= score;
const measuredOk =
  (measurementId: string, minTechnique = 0.75) =>
  (s: LearnerSnapshot) =>
    s.measurements.some(
      (m) => m.measurementId === measurementId && (m.technique?.score ?? 0) >= minTechnique,
    );
const measuredAny = (measurementId: string) => (s: LearnerSnapshot) =>
  s.measurements.some((m) => m.measurementId === measurementId);
/** A trace in both apical planes, each with adequate technique: what the biplane method of discs needs (decision 180). */
const measuredBiplane =
  (measurementId: string, minTechnique = 0.75) =>
  (s: LearnerSnapshot) =>
    ['a4c', 'a2c'].every((view) =>
      s.measurements.some(
        (m) =>
          m.measurementId === measurementId &&
          m.sourceViewId === view &&
          (m.technique?.score ?? 0) >= minTechnique,
      ),
    );

export const CURRICULUM: Module[] = [
  {
    id: 'fundamentals',
    title: '1 · Fundamentos: ventana, plano y referencias',
    lessons: [
      {
        id: 'parasternal',
        title: 'Ventana paraesternal',
        goal: 'Obtener PLAX y los tres niveles de PSAX moviendo la sonda, no con botones: una vista cuyo preajuste usaste no cuenta hasta que recargues el caso.',
        tasks: [
          {
            id: 'plax-70',
            title: 'PLAX con puntuación ≥ 70 (caso normal)',
            why: 'El eje largo es la referencia de todas las medidas lineales del VI y de la raíz aórtica; un plano oblicuo las sobreestima.',
            caseId: 'normal-excellent-window',
            viewId: 'plax',
            check: viewAtLeast('plax', 70),
          },
          {
            id: 'psax-mv-60',
            title: 'PSAX nivel mitral ≥ 60',
            why: 'Al rotar 90° sin desplazar la sonda se comprueba que el plano gira alrededor del mismo eje del haz.',
            caseId: 'normal-excellent-window',
            viewId: 'psax-mv',
            requires: ['plax-70'],
            check: viewAtLeast('psax-mv', 60),
          },
          {
            id: 'psax-pm-60',
            title: 'PSAX nivel papilar ≥ 60',
            why: 'Es el nivel donde se evalúan los 6 segmentos medios y la simetría del VI (circular = plano perpendicular).',
            caseId: 'normal-excellent-window',
            viewId: 'psax-pm',
            requires: ['plax-70'],
            check: viewAtLeast('psax-pm', 60),
          },
          {
            id: 'psax-av-55',
            title: 'PSAX nivel aórtico ≥ 55',
            why: 'Angular hacia la base muestra la válvula aórtica «de frente»: su eje está 30° inclinado respecto del VI.',
            caseId: 'normal-excellent-window',
            viewId: 'psax-av',
            requires: ['plax-70'],
            check: viewAtLeast('psax-av', 55),
          },
          {
            id: 'psax-apex-55',
            title: 'PSAX nivel apical ≥ 55',
            why: 'El eje corto del ápex muestra en un anillo pequeño los segmentos apicales que los cortes basales no ven; se llega angulando hacia el ápex sin perder el corte circular.',
            caseId: 'normal-excellent-window',
            viewId: 'psax-apex',
            requires: ['psax-pm-60'],
            check: viewAtLeast('psax-apex', 55),
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
            title: 'A4C con puntuación ≥ 70',
            why: 'El acortamiento apical es el error más frecuente: Simpson subestima volúmenes y la FE parece mejor.',
            caseId: 'normal-excellent-window',
            viewId: 'a4c',
            check: viewAtLeast('a4c', 70),
          },
          {
            id: 'a2c-55',
            title: 'A2C ≥ 55 rotando ~60° antihorario',
            why: 'Con 60° el VD desaparece y quedan las paredes anterior e inferior: la rotación correcta es geométrica, no estética.',
            caseId: 'normal-excellent-window',
            viewId: 'a2c',
            requires: ['a4c-70'],
            check: viewAtLeast('a2c', 55),
          },
          {
            id: 'a5c-60',
            title: 'A5C ≥ 60 angulando anterior',
            why: 'Abrir el TSVI desde el ápex es la única forma de alinear el Doppler con el flujo aórtico.',
            caseId: 'normal-excellent-window',
            viewId: 'a5c',
            requires: ['a4c-70'],
            check: viewAtLeast('a5c', 60),
          },
          {
            id: 'a3c-60',
            title: 'A3C ≥ 60 rotando ~60° más desde el A2C',
            why: 'El eje largo apical muestra el TSVI, la raíz y las paredes anteroseptal e inferolateral: completa los segmentos que el A4C y el A2C no ven.',
            caseId: 'normal-excellent-window',
            viewId: 'a3c',
            requires: ['a2c-55'],
            check: viewAtLeast('a3c', 60),
          },
          {
            id: 'apical-segments',
            title: 'Los tres apicales (A4C, A2C y A3C) ≥ 60',
            why: 'Juntos cubren los 17 segmentos del VI; una pared que no se ve en ninguno queda sin evaluar.',
            caseId: 'normal-excellent-window',
            viewId: 'a4c',
            requires: ['a3c-60'],
            check: (s) => ['a4c', 'a2c', 'a3c'].every((v) => viewAtLeast(v, 60)(s)),
          },
          {
            id: 'rv-focused-55',
            title: 'Apical enfocada en VD ≥ 55',
            why: 'Desplazar la sonda hacia lateral centra el VD: su diámetro basal y su pared libre sólo se miden bien aquí.',
            caseId: 'normal-excellent-window',
            viewId: 'rv-focused',
            requires: ['a4c-70'],
            check: viewAtLeast('rv-focused', 55),
          },
        ],
      },
      {
        id: 'subcostal',
        title: 'Ventana subcostal',
        goal: 'Bajo el xifoides: cuatro cámaras con el septo interauricular y la vena cava inferior.',
        tasks: [
          {
            id: 'subcostal-4c-60',
            title: 'Subcostal cuatro cámaras ≥ 60',
            why: 'Es la ventana de rescate cuando el tórax no deja ver, y la que pone el septo interauricular perpendicular al haz.',
            caseId: 'normal-excellent-window',
            viewId: 'subcostal-4c',
            check: viewAtLeast('subcostal-4c', 60),
          },
          {
            id: 'subcostal-ivc-60',
            title: 'Vena cava inferior en su eje largo ≥ 60',
            why: 'Su calibre y su colapso inspiratorio estiman la presión de la aurícula derecha.',
            caseId: 'normal-excellent-window',
            viewId: 'subcostal-ivc',
            requires: ['subcostal-4c-60'],
            check: viewAtLeast('subcostal-ivc', 60),
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
            viewId: 'plax',
            requires: ['plax-70'],
            check: (s) => s.caseId === 'normal-difficult-window' && viewAtLeast('plax', 55)(s),
          },
          {
            id: 'difficult-a4c-55',
            title: 'A4C ≥ 55 en ventana difícil',
            why: 'El pulmón interpuesto se esquiva deslizando medial y pidiendo espiración; la ganancia no atraviesa el aire.',
            caseId: 'normal-difficult-window',
            viewId: 'a4c',
            requires: ['a4c-70'],
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
            viewId: 'plax',
            requires: ['plax-70'],
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
            viewId: 'a4c',
            check: (s) => s.modality === 'color' && s.colorScaleMps <= 0.35,
          },
          {
            id: 'colour-normal-scale',
            title: 'Color con escala ≥ 0,55 m/s y ganancia ≤ 3 dB',
            why: 'La escala fisiológica y la ganancia justa muestran el flujo sin plegado ni rebose sobre el tejido.',
            viewId: 'a4c',
            requires: ['colour-low-scale'],
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
            viewId: 'a5c',
            requires: ['a5c-60'],
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
            viewId: 'a5c',
            requires: ['pw-lvot-aligned'],
            check: measuredOk('lvot-vti'),
          },
          {
            id: 'cw-as-vmax',
            title: 'Vmax aórtica por CW con técnica ≥ 0,75 en la estenosis severa',
            why: 'El chorro de una estenosis supera el límite del PW: sólo el continuo, alineado desde el ápex, mide su velocidad máxima y con ella el gradiente.',
            caseId: 'aortic-stenosis-severe',
            viewId: 'a5c',
            requires: ['lvot-vti-ok'],
            check: (s) =>
              s.caseId === 'aortic-stenosis-severe' &&
              s.measurements.some(
                (m) =>
                  m.measurementId === 'av-vmax' &&
                  m.modality === 'cw' &&
                  (m.technique?.score ?? 0) >= 0.75,
              ),
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
            viewId: 'plax',
            requires: ['plax-70'],
            check: measuredOk('lvot-diameter'),
          },
          {
            id: 'lv-edd-ok',
            title: 'DTDVI en telediástole con técnica ≥ 0,75',
            why: 'Medir en el cuadro equivocado (sístole) o sobre un plano oblicuo cambia el diámetro varios milímetros.',
            viewId: 'plax',
            requires: ['plax-70'],
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
            viewId: 'a4c',
            requires: ['a4c-70'],
            check: measuredAny('lv-edv-simpson'),
          },
          {
            id: 'simpson-esv',
            title: 'VTS por Simpson en telesístole',
            why: 'La FE deriva de dos trazados: el cuadro telesistólico es el de cavidad mínima antes de abrirse la mitral.',
            viewId: 'a4c',
            requires: ['simpson-edv'],
            check: measuredAny('lv-esv-simpson'),
          },
          {
            id: 'simpson-biplane',
            title: 'VTD biplano: Simpson en A4C y en A2C con técnica ≥ 0,75',
            why: 'Un solo plano supone un VI circular en su eje corto; el segundo plano, a 60°, corrige esa forma y es el método recomendado.',
            viewId: 'a4c',
            requires: ['simpson-edv', 'a2c-55'],
            check: measuredBiplane('lv-edv-simpson'),
          },
          {
            id: 'la-volume-biplane',
            title: 'Volumen de la AI en A4C y A2C con técnica ≥ 0,75',
            why: 'El volumen indexado de la AI resume la presión de llenado crónica; una AI dilatada puede salirse del sector a 16 cm y hay que ganar profundidad.',
            viewId: 'a4c',
            requires: ['simpson-biplane'],
            check: measuredBiplane('la-volume'),
          },
          {
            id: 'mitral-e-ok',
            title: 'Onda E con el gate en las puntas mitrales',
            why: 'Un gate en el anillo o en la aurícula cambia la forma y la velocidad de la onda E.',
            viewId: 'a4c',
            requires: ['a4c-70'],
            check: measuredOk('mitral-e'),
          },
          {
            id: 'e-prime-septal-ok',
            title: 'e′ septal por Doppler tisular con técnica ≥ 0,75',
            why: 'La relajación del VI se lee en el anillo, no en la sangre: E/e′ estima la presión de llenado.',
            viewId: 'a4c',
            requires: ['mitral-e-ok'],
            check: measuredOk('e-prime-septal'),
          },
          {
            id: 'tapse-ok',
            title: 'TAPSE en modo M con técnica ≥ 0,75',
            why: 'El desplazamiento del anillo tricuspídeo hacia el ápex es la medida más reproducible de la función del VD.',
            viewId: 'a4c',
            requires: ['rv-focused-55'],
            check: measuredOk('tapse'),
          },
        ],
      },
      {
        id: 'pressures',
        title: 'Presiones del corazón derecho',
        goal: 'Estimar la presión de la aurícula derecha por la cava en un corazón derecho sobrecargado.',
        tasks: [
          {
            id: 'ivc-collapse',
            title: 'Colapso de la cava: diámetro en espiración y en inspiración con técnica ≥ 0,75',
            why: 'El calibre de la cava y cuánto colapsa al inspirar estiman la presión de la aurícula derecha, la que se suma al gradiente de la insuficiencia tricuspídea.',
            caseId: 'pulmonary-hypertension-rv',
            viewId: 'subcostal-ivc',
            requires: ['subcostal-ivc-60'],
            check: (s) =>
              s.caseId === 'pulmonary-hypertension-rv' &&
              measuredOk('ivc-diameter')(s) &&
              measuredOk('ivc-diameter-inspiration')(s),
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
            requires: ['cw-as-vmax'],
            check: (s) => s.caseId === 'aortic-stenosis-severe' && (s.impressionScore ?? 0) >= 70,
          },
          {
            id: 'impression-hfref',
            title: 'Impresión ≥ 70 en la ICFEr',
            why: 'Distinguir disfunción severa con IM funcional y presiones de llenado elevadas.',
            caseId: 'hfref-severe-mr',
            requires: ['simpson-biplane'],
            check: (s) => s.caseId === 'hfref-severe-mr' && (s.impressionScore ?? 0) >= 70,
          },
          {
            id: 'impression-ph',
            title: 'Impresión ≥ 70 en la hipertensión pulmonar',
            why: 'El corazón derecho se juzga por tamaño, función, septo y PSVD, no por un solo número.',
            caseId: 'pulmonary-hypertension-rv',
            requires: ['ivc-collapse'],
            check: (s) =>
              s.caseId === 'pulmonary-hypertension-rv' && (s.impressionScore ?? 0) >= 70,
          },
          {
            id: 'impression-tamponade',
            title: 'Impresión ≥ 70 en el taponamiento',
            why: 'Reconocer colapsos y corazón oscilante convierte un derrame en una emergencia.',
            caseId: 'pericardial-effusion-tamponade',
            requires: ['subcostal-4c-60'],
            check: (s) =>
              s.caseId === 'pericardial-effusion-tamponade' && (s.impressionScore ?? 0) >= 70,
          },
          {
            id: 'rwma-inferior',
            title: 'Motilidad segmentaria: A2C ≥ 60 e impresión ≥ 70 en el infarto inferior',
            why: 'La pared inferior se juzga en el A2C y en los ejes cortos: la alteración segmentaria se reconoce pared por pared, no por la FEVI global.',
            caseId: 'inferior-rwma',
            viewId: 'a2c',
            requires: ['apical-segments'],
            check: (s) =>
              s.caseId === 'inferior-rwma' &&
              viewAtLeast('a2c', 60)(s) &&
              (s.impressionScore ?? 0) >= 70,
          },
          {
            id: 'mr-grading',
            title: 'Graduar la IM del prolapso: volumen de la AI biplano e impresión ≥ 70',
            why: 'La severidad de la IM se integra con el chorro en color, el tamaño de la AI y del VI y el mecanismo; un solo signo no la gradúa.',
            caseId: 'mvp-primary-mr',
            viewId: 'a4c',
            requires: ['la-volume-biplane', 'colour-normal-scale'],
            check: (s) =>
              s.caseId === 'mvp-primary-mr' &&
              measuredBiplane('la-volume')(s) &&
              (s.impressionScore ?? 0) >= 70,
          },
        ],
      },
    ],
  },
];

export function allTasks(): Task[] {
  return CURRICULUM.flatMap((m) => m.lessons.flatMap((l) => l.tasks));
}

/** Whether a task's prerequisites are all among the completed ones. */
export function isUnlocked(t: Task, completed: Readonly<Record<string, unknown>>): boolean {
  return (t.requires ?? []).every((id) => Boolean(completed[id]));
}

/**
 * Ids of the tasks whose check passes for this snapshot and whose prerequisites are done, the ones already completed or
 * completed in this same pass (decision 260): a task does not complete before the ones it builds on.
 */
export function evaluateTasks(
  s: LearnerSnapshot,
  completed: Readonly<Record<string, unknown>> = {},
): string[] {
  const passed = allTasks().filter((t) => t.check(s));
  const done: Record<string, true> = Object.fromEntries(
    Object.keys(completed)
      .filter((id) => completed[id])
      .map((id) => [id, true]),
  );
  const out: string[] = [];
  for (let changed = true; changed;) {
    changed = false;
    for (const t of passed)
      if (!done[t.id] && isUnlocked(t, done)) {
        done[t.id] = true;
        out.push(t.id);
        changed = true;
      }
  }
  return out;
}
