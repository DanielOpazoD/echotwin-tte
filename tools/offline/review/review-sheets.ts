/**
 * Clinical review sheets (decision 326): one sheet per view with the normal case and three pathological ones
 * (pulmonary hypertension, HFrEF with severe MR, obstructive HCM). Each row holds the echo image and its labelled
 * structure map at end-diastole and end-systole. The map is drawn from the same polar frame as the image
 * (`frame.structure` through the scan LUT, as `clinicalImage.ts` reads it), so both share the sector geometry pixel
 * for pixel; what a line meets behind the pleura is dimmed on the map, because the image shows reverberation there.
 *   npx tsx tools/offline/review/review-sheets.ts [outDir] [viewIds,comma] [caseIds,comma]
 * Writes <outDir>/<view>.png (the sheet), <outDir>/<view>.md (the census of each frame) and <outDir>/index.md.
 * The render, the map and the text are shared with the review clips (`reviewFrame.ts`).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodePng } from '../render/png';
import { Structure } from '@/simulator/anatomy/tissue';
import { ProceduralSliceRenderer } from '@/simulator/renderer/procedural/sliceRenderer';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import { VIEW_TARGETS } from '@/simulator/windows/viewTargets';
import { viewLabel } from '@/simulator/windows/viewLabels';
import { structureLabel } from '@/app/review';
import {
  ascii,
  blit,
  buildReviewModels,
  CENSUS_MIN_SHARE,
  DEFAULT_CASES,
  drawText,
  echoImage,
  fill,
  H,
  renderPolar,
  reviewControl,
  reviewChoiceLabel,
  type ReviewModel,
  shortCase,
  structureMap,
  W,
} from './reviewFrame';

const GAP = 6;
const HEADER = 26;

const outDir = process.argv[2] ?? 'tools/offline/review/out/sheets';
mkdirSync(outDir, { recursive: true });
const viewIds = process.argv[3] ? process.argv[3].split(',') : VIEW_TARGETS.map((v) => v.id);
const caseIds = process.argv[4] ? process.argv[4].split(',') : DEFAULT_CASES;

const renderer = new ProceduralSliceRenderer();

interface Frame {
  phaseName: 'TD' | 'TS';
  phase: number;
  eco: Uint8ClampedArray;
  map: Uint8ClampedArray;
  /** Share of the sector's pixels in front of the pleura, per structure. */
  visible: Map<Structure, number>;
  /** Share of the sector's pixels behind the pleura, per structure. */
  hidden: Map<Structure, number>;
}

interface Row {
  m: ReviewModel;
  ctrl: unknown;
  frames: Frame[];
}

const models = buildReviewModels(caseIds);

const index: string[] = [
  '# Hojas de revisión clínica',
  '',
  `Casos: ${models.map((m) => `${m.c.id} (TS en fase ${m.esPhase.toFixed(2)})`).join(', ')}.`,
  ...(reviewChoiceLabel() ? [`Elección experimental del panel Dev: ${reviewChoiceLabel()}.`] : []),
  'Cada fila: eco y mapa de estructuras en telediástole (fase 0) y telesístole (menor volumen del VI), con la misma geometría',
  'de sector; el mapa sale del mismo fotograma polar que la imagen y se atenúa detrás de la pleura.',
  '',
];
for (const id of viewIds) {
  const view = VIEW_TARGETS.find((v) => v.id === id);
  if (!view) throw new Error(`unknown view ${id}`);
  const t0 = performance.now();
  const rows: Row[] = models.map((m) => {
    const ctrl = reviewControl(view, m);
    const beam = beamFrameFromPose(poseFromControl(m.thorax, ctrl), 1);
    const frames: Frame[] = (
      [
        ['TD', 0],
        ['TS', m.esPhase],
      ] as const
    ).map(([phaseName, phase]) => {
      const frame = renderPolar(renderer, m, beam, phase);
      const eco = echoImage(frame, m);
      const { map, visible, hidden } = structureMap(frame);
      return { phaseName, phase, eco, map, visible, hidden };
    });
    return { m, ctrl, frames };
  });
  const sheet = composeSheet(viewLabel(id), rows);
  const png = join(outDir, `${id}.png`);
  writeFileSync(png, encodePng(sheet.width, sheet.height, sheet.rgba));
  writeFileSync(join(outDir, `${id}.md`), censusSheet(id, rows).join('\n') + '\n');
  index.push(`- [${viewLabel(id)}](${id}.md) — ![${id}](${id}.png)`);
  process.stdout.write(`${png}  ${((performance.now() - t0) / 1000).toFixed(1)} s\n`);
}
writeFileSync(join(outDir, 'index.md'), index.join('\n') + '\n');
process.stdout.write(`escrito en ${outDir}\n`);

/** One sheet: a header row with the view and the columns, then a row per case with its four panels. */
function composeSheet(
  title: string,
  rows: Row[],
): { width: number; height: number; rgba: Uint8ClampedArray } {
  const width = 4 * W + 5 * GAP;
  const height = HEADER + rows.length * (HEADER + H + GAP) + GAP;
  const rgba = new Uint8ClampedArray(width * height * 4);
  fill(rgba, [28, 28, 32]);
  const columns = [
    'TELEDIASTOLE - ECO',
    'TELEDIASTOLE - MAPA',
    'TELESISTOLE - ECO',
    'TELESISTOLE - MAPA',
  ];
  drawText(rgba, width, height, GAP, 6, title.toUpperCase(), [255, 220, 120]);
  columns.forEach((c, k) =>
    drawText(rgba, width, height, GAP + k * (W + GAP) + 150, 6, c, [220, 220, 220]),
  );
  rows.forEach(({ m, frames }, r) => {
    const top = HEADER + r * (HEADER + H + GAP);
    // the Dev panel's experimental choices, when the sheet draws them (decisions 352–354)
    const choice = reviewChoiceLabel();
    const label = `${m.c.id}  ·  ${ascii(m.c.title)}  ·  TS EN FASE ${m.esPhase.toFixed(2)}${choice ? `  ·  ${ascii(choice)}` : ''}`;
    drawText(rgba, width, height, GAP, top + 6, label.toUpperCase(), [255, 220, 120]);
    frames.forEach((f, k) => {
      blit(rgba, width, f.eco, GAP + 2 * k * (W + GAP), top + HEADER);
      blit(rgba, width, f.map, GAP + (2 * k + 1) * (W + GAP), top + HEADER);
    });
  });
  return { width, height, rgba };
}

/** The census of the frames of a view: the share of the sector each structure covers, per case and phase. */
function censusSheet(id: string, rows: Row[]): string[] {
  const lines = [
    `# ${viewLabel(id)} (${id})`,
    '',
    `![${id}](${id}.png)`,
    '',
    'Porcentaje del sector (píxeles delante de la pleura) que ocupa cada estructura, por caso y fase; entre paréntesis, lo que',
    'queda detrás de la pleura. TD = telediástole (fase 0); TS = telesístole (menor volumen del VI).',
    '',
  ];
  const all = new Set<Structure>();
  for (const r of rows)
    for (const f of r.frames) {
      for (const [s, v] of f.visible) if (v >= CENSUS_MIN_SHARE) all.add(s);
      for (const [s, v] of f.hidden) if (v >= CENSUS_MIN_SHARE) all.add(s);
    }
  const header = rows.flatMap((r) => r.frames.map((f) => `${shortCase(r.m.c.id)} ${f.phaseName}`));
  lines.push(
    `| estructura | ${header.join(' | ')} |`,
    `|---|${header.map(() => '---:').join('|')}|`,
  );
  const sorted = [...all].sort(
    (a, b) =>
      Math.max(...rows.flatMap((r) => r.frames.map((f) => f.visible.get(b) ?? 0))) -
      Math.max(...rows.flatMap((r) => r.frames.map((f) => f.visible.get(a) ?? 0))),
  );
  for (const s of sorted) {
    const cells = rows.flatMap((r) =>
      r.frames.map((f) => {
        const v = f.visible.get(s) ?? 0,
          h = f.hidden.get(s) ?? 0;
        if (v < CENSUS_MIN_SHARE && h < CENSUS_MIN_SHARE) return '';
        return `${pct(v)}${h >= CENSUS_MIN_SHARE ? ` (${pct(h)})` : ''}`;
      }),
    );
    // a thorax sample without structure id is mediastinal fat and the like, not a hole in the model
    const name = s === Structure.None ? 'mediastino (sin estructura)' : structureLabel(s);
    lines.push(`| ${name} | ${cells.join(' | ')} |`);
  }
  lines.push('');
  for (const r of rows)
    lines.push(
      `- ${r.m.c.id}: sonda ${JSON.stringify(r.ctrl)}; TS en fase ${r.m.esPhase.toFixed(3)} (RR ${r.m.tables.rrS.toFixed(3)} s).`,
    );
  return lines;
}

function pct(x: number): string {
  return `${(100 * x).toFixed(x >= 0.1 ? 0 : 1)} %`;
}
