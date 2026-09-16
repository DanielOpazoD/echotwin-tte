/**
 * Reproduce a review report offline (decision 134): renders the frame the report describes with the CPU
 * tracer at the report's exact input and phase (and 0.15 of the cycle before and after), draws its
 * markers, classifies each marker point again with the same code the worker used and writes a check
 * sheet next to the images.
 *   npm run review:render -- <informe.md|informe.json> [outDir]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { encodePng } from '../render/png';
import { markerPlace, parseReviewReport, structureLabel, tissueLabel } from '@/app/review';
import { loadCaseById } from '@/cases';
import { buildCaseModels } from '@/simulator/anatomy/caseModels';
import { computeHeartPose } from '@/simulator/anatomy/heartModel';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { ProceduralSliceRenderer } from '@/simulator/renderer/procedural/sliceRenderer';
import { allocPolarFrame, polarSpecFor, type Scene } from '@/simulator/renderer/types';
import { applyConsole, createConsoleState } from '@/simulator/renderer/postprocess/consolePipeline';
import { computeSectorMapping, polarToPixel, scanConvert } from '@/simulator/renderer/scanConvert';
import { beamFrameFromPose, contactQuality, poseFromControl } from '@/simulator/probe/pose';
import { probePointAt, probeTorsoPointAt } from '@/simulator/core/probePoint';

/** 3×5 pixel digits for the marker numbers drawn into the raw RGBA buffer. */
const FONT: Record<string, string[]> = {
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['###', '..#', '###', '#..', '###'],
  '3': ['###', '..#', '###', '..#', '###'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '###', '..#', '###'],
  '6': ['###', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '..#', '..#', '..#'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '###'],
};

const [, , file, outArg] = process.argv;
if (!file) {
  console.error('uso: npm run review:render -- <informe.md|informe.json> [outDir]');
  process.exit(1);
}
const report = parseReviewReport(readFileSync(file, 'utf8'));
if (!report) {
  console.error('el archivo no contiene un informe echotwin-review (falta el bloque JSON)');
  process.exit(1);
}
const outDir = outArg ?? 'tools/offline/review/out';
mkdirSync(outDir, { recursive: true });

const c = loadCaseById(report.caseId);
const input = report.input;
const { heart, thorax, tables } = buildCaseModels(c, input.patient);
const settings = input.settings;
const spec = polarSpecFor(settings, input.quality);
const W = input.display.width,
  H = input.display.height;
const mapping = computeSectorMapping(spec, W, H, settings.invertLR, settings.zoom);
const beam = beamFrameFromPose(
  poseFromControl(thorax, input.probe),
  contactQuality(input.probe.pressure),
);
const renderer = new ProceduralSliceRenderer();
const phase0 = report.frame?.phase ?? 0;
const stem = basename(file).replace(/\.[^.]+$/, '');
const p = input.probe;
const lines: string[] = [
  `# Reproducción de ${basename(file)}`,
  '',
  `Caso ${report.caseId} · ${report.author} · fase ${phase0.toFixed(2)} · ${input.modality} · sonda u ${p.u.toFixed(1)} v ${p.v.toFixed(1)} cm, rotación ${p.rotationDeg}°, tilt ${p.tiltDeg}°, rock ${p.rockDeg}°, presión ${p.pressure} · paciente ${input.patient.position}, ${input.patient.respiration} · calidad ${input.quality} · ${W}×${H}`,
  '',
];
if (report.note.trim()) lines.push(`Nota general: ${report.note.trim()}`, '');

// Each marker was placed on its own frame: it is classified and drawn at that phase, not at the phase of the
// frame the report was copied on (a wall that was under the click at 0.70 has moved by 0.56).
const markerPhases = [
  ...new Set(report.markers.map((m) => Number((m.point?.phase ?? m.phase).toFixed(2)))),
];
const renders: { phase: number; suffix: string }[] = [
  { phase: phase0, suffix: '' },
  ...markerPhases
    .filter((ph) => Math.abs(ph - phase0) > 0.02)
    .map((ph) => ({ phase: ph, suffix: `-marcadores-fase${ph.toFixed(2)}` })),
  { phase: (((phase0 - 0.15) % 1) + 1) % 1, suffix: '-antes' },
  { phase: (phase0 + 0.15) % 1, suffix: '-despues' },
];
lines.push(
  '| # | fase | informe (lo que vio quien marcó) | modelo (CPU, a la fase del marcador) | nota |',
  '|---|---|---|---|---|',
);
for (const m of report.markers) {
  const note = m.note.replace(/\|/g, '/').replace(/\n/g, ' ');
  const ph = m.point?.phase ?? m.phase;
  const pose = computeHeartPose(heart, cycleStateAt(tables, ph));
  if (m.space === 'model' && m.torso) {
    const q = probeTorsoPointAt(heart, thorax, pose, beam, m.torso, ph);
    lines.push(
      `| ${m.n} | ${ph.toFixed(2)} | ${markerPlace(m)} | 3D · ${structureLabel(q.structure)} · ${tissueLabel(q.tissue)} · corazón (${q.heart.x.toFixed(1)}, ${q.heart.y.toFixed(1)}, ${q.heart.z.toFixed(1)}) · ${Math.abs(q.offPlaneCm) < 0.3 ? 'en el plano' : `a ${Math.abs(q.offPlaneCm).toFixed(1)} cm del plano`} | ${note} |`,
    );
    continue;
  }
  if (m.rCm === null || m.thetaRad === null) {
    lines.push(`| ${m.n} | ${ph.toFixed(2)} | ${markerPlace(m)} | (tira) | ${note} |`);
    continue;
  }
  const q = probePointAt(heart, thorax, pose, beam, m.rCm, m.thetaRad, ph);
  lines.push(
    `| ${m.n} | ${ph.toFixed(2)} | ${markerPlace(m)} | ${structureLabel(q.structure)} · ${tissueLabel(q.tissue)} · corazón (${q.heart.x.toFixed(1)}, ${q.heart.y.toFixed(1)}, ${q.heart.z.toFixed(1)})${q.rootT !== null && q.rootR !== null ? ` · raíz t ${q.rootT.toFixed(2)} r ${q.rootR.toFixed(2)}` : ''} | ${note} |`,
  );
}

for (const { phase, suffix } of renders) {
  const pose = computeHeartPose(heart, cycleStateAt(tables, phase));
  const scene: Scene = {
    heart,
    heartPose: pose,
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
  const rgba = new Uint8ClampedArray(W * H * 4);
  scanConvert(disp, spec, mapping, rgba);
  for (const m of report.markers) {
    // a model marker is drawn where it projects onto the image only when it lies close to the plane
    const pm =
      m.space === 'model' && m.torso
        ? probeTorsoPointAt(heart, thorax, pose, beam, m.torso, phase)
        : null;
    if (pm && Math.abs(pm.offPlaneCm) > 0.5) continue;
    const rCm = pm ? pm.rCm : m.rCm;
    const thetaRad = pm ? pm.thetaRad : m.thetaRad;
    if (rCm === null || thetaRad === null) continue;
    const q = polarToPixel(mapping, rCm, thetaRad);
    drawMarker(rgba, W, H, Math.round(q.x), Math.round(q.y), m.n);
  }
  const f = join(outDir, `${stem}-fase${phase.toFixed(2)}${suffix}.png`);
  writeFileSync(f, encodePng(W, H, rgba));
  lines.push('', `![fase ${phase.toFixed(2)}](${basename(f)})`);
}
const sheet = join(outDir, `${stem}-verificacion.md`);
writeFileSync(sheet, lines.join('\n') + '\n');
console.info(lines.join('\n'));
console.info(`\nescrito en ${outDir}`);

/** Magenta ring with the marker number in a 3×5 pixel font, scaled ×2. */
function drawMarker(
  rgba: Uint8ClampedArray,
  W: number,
  H: number,
  cx: number,
  cy: number,
  n: number,
): void {
  const put = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4;
    rgba[i] = 255;
    rgba[i + 1] = 106;
    rgba[i + 2] = 213;
    rgba[i + 3] = 255;
  };
  for (let a = 0; a < 360; a += 2) {
    const r = a * (Math.PI / 180);
    for (const rad of [9, 10])
      put(Math.round(cx + rad * Math.cos(r)), Math.round(cy + rad * Math.sin(r)));
  }
  const digits = String(n);
  const x0 = cx + 14;
  for (let d = 0; d < digits.length; d++) {
    const glyph = FONT[digits[d]!] ?? FONT['0']!;
    for (let row = 0; row < 5; row++)
      for (let col = 0; col < 3; col++)
        if (glyph[row]![col] === '#')
          for (let sy = 0; sy < 2; sy++)
            for (let sx = 0; sx < 2; sx++) put(x0 + d * 8 + col * 2 + sx, cy - 5 + row * 2 + sy);
  }
}
