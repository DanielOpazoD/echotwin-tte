/**
 * Review-set export for the external validation protocol (docs/VALIDATION_PROTOCOL.md, study 1):
 * renders the canonical views of every case at three cardiac phases, writes the expert scoring
 * sheet (CSV, one row per case × view × phase with the rubric columns) and the review script.
 *   npm run review:export -- [outDir]
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodePng } from '../render/png';
import { CASE_INPUTS, loadCaseById } from '@/cases';
import { computeHeartPose, createHeartModel } from '@/simulator/anatomy/heartModel';
import { createThoraxModel } from '@/simulator/anatomy/thoraxModel';
import { buildBeatTables, cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { ProceduralSliceRenderer } from '@/simulator/renderer/procedural/sliceRenderer';
import {
  allocPolarFrame,
  DEFAULT_ACQUISITION,
  polarSpecFor,
  type Scene,
} from '@/simulator/renderer/types';
import { applyConsole, createConsoleState } from '@/simulator/renderer/postprocess/consolePipeline';
import { computeSectorMapping, scanConvert } from '@/simulator/renderer/scanConvert';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';

const outDir = process.argv[2] ?? 'tools/offline/validation/out';
mkdirSync(outDir, { recursive: true });
const commit = ((): string => {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
})();
const VIEWS = ['plax', 'psax-av', 'psax-mv', 'psax-pm', 'a4c', 'a2c', 'a3c', 'a5c'];
const PHASES: [
  string,
  (
    rr: number,
    t: { ejectionStartS: number; ejectionEndS: number; mitralOpenS: number; eAccelS: number },
  ) => number,
][] = [
  ['telediastole', () => 0],
  ['mesosistole', (rr, t) => (t.ejectionStartS + 0.45 * (t.ejectionEndS - t.ejectionStartS)) / rr],
  ['diastole-precoz', (rr, t) => (t.mitralOpenS + t.eAccelS) / rr],
];
const RUBRIC = [
  'anatomia_1_5',
  'movimiento_1_5',
  'textura_1_5',
  'artefactos_1_5',
  'doppler_1_5',
  'utilidad_docente_1_5',
  'defecto_principal',
];
const rows: string[] = [
  ['commit', 'caso', 'vista', 'cuadro', 'archivo', 'evaluador', ...RUBRIC].join(','),
];
const renderer = new ProceduralSliceRenderer();
const settings = { ...DEFAULT_ACQUISITION };
const spec = polarSpecFor(settings, 'high');
const W = 768,
  H = 660;
const rgba = new Uint8ClampedArray(W * H * 4);
const mapping = computeSectorMapping(spec, W, H, false);
let count = 0;
for (const input of CASE_INPUTS) {
  const c = loadCaseById(input.id);
  const thorax = createThoraxModel(c.bodyHabitus, c.acousticWindow, {
    position: 'left-lateral',
    respiration: 'expiration',
    headElevationDeg: 0,
  });
  const heart = createHeartModel(c.anatomy, c.physiology, thorax.heartOffset, c.seed);
  const tables = buildBeatTables(
    60 / c.rhythm.heartRateBpm,
    c.physiology,
    c.rhythm,
    c.hemodynamics,
  );
  const caseDir = join(outDir, c.id);
  mkdirSync(caseDir, { recursive: true });
  for (const viewId of VIEWS) {
    const view = getViewTarget(viewId);
    const ctrl = canonicalControl(view, heart, thorax);
    const beam = beamFrameFromPose(poseFromControl(thorax, ctrl), 1);
    for (const [label, phaseOf] of PHASES) {
      const phase = phaseOf(tables.rrS, tables.timings);
      const scene: Scene = {
        heart,
        heartPose: computeHeartPose(heart, cycleStateAt(tables, phase)),
        thorax,
        physics: {
          frequencyMHz: settings.frequencyMHz,
          harmonics: settings.harmonics,
          clutterLevel: c.acousticWindow.clutterLevel,
          windowAttenuation: c.acousticWindow.chestWallAttenuation,
          seed: c.seed,
        },
      };
      const frame = allocPolarFrame(spec);
      renderer.render(scene, beam, spec, phase, frame);
      const cs = createConsoleState(c.seed);
      const disp = new Uint8ClampedArray(spec.lines * spec.samples);
      applyConsole(frame, settings, cs, disp);
      scanConvert(disp, spec, mapping, rgba);
      const file = `${c.id}/${viewId}-${label}.png`;
      writeFileSync(join(outDir, file), encodePng(W, H, rgba));
      rows.push([commit, c.id, viewId, label, file, '', ...RUBRIC.map(() => '')].join(','));
      count++;
    }
  }
}
writeFileSync(join(outDir, 'review-sheet.csv'), rows.join('\n') + '\n');
writeFileSync(
  join(outDir, 'review-script.md'),
  `# Guion de revisión experta (estudio 1)

Commit: ${commit}. Imágenes: ${count} (${CASE_INPUTS.length} casos × ${VIEWS.length} vistas × ${PHASES.length} cuadros), sintéticas, sin datos de pacientes.

1. Abre \`review-sheet.csv\` y escribe tu código de evaluador en la columna \`evaluador\`.
2. Para cada fila, abre la imagen indicada y puntúa de 1 a 5 (1 inaceptable, 3 útil con reservas, 5 indistinguible de una imagen real de calidad media) los ítems anatomía, movimiento (usa el cine en la aplicación para la misma vista), textura, artefactos, Doppler (activa color y PW en la aplicación) y utilidad docente. Anota el defecto principal en texto libre.
3. En la aplicación (\`npm run dev\`), carga el mismo caso, pulsa la vista predeterminada correspondiente y observa el cine completo; los ítems de movimiento y Doppler se puntúan sobre el cine.
4. Devuelve el CSV; los resultados agregados se archivan en \`docs/validation/results/\`.
`,
);
process.stdout.write(`review set: ${count} images in ${outDir}\n`);
