/**
 * The suspicion sheet of the review tools (decision 365): for one case, every canonical view and its neighbours (turns of
 * ±5°, ±15° and ±30°, tilts of ±7° and ±15°, at end-diastole and end-systole), the mechanical suspicions of
 * `planeSuspicions.ts` with a crop of the echo and the map, the plane, the phase, the figure and a sentence. Invariants
 * broken come first, then the mechanical hints by figure; what Daniel has dismissed (`KNOWN_SUSPICIONS` in
 * `planeSuspicions.test.ts`) is listed apart as «esto es normal».
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodePng } from '../render/png';
import type { Structure } from '@/simulator/anatomy/tissue';
import type { ProceduralSliceRenderer } from '@/simulator/renderer/procedural/sliceRenderer';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import { VIEW_TARGETS, type ViewTarget } from '@/simulator/windows/viewTargets';
import { viewLabel } from '@/simulator/windows/viewLabels';
import { structureLabel } from '@/app/review';
import { STRUCTURE_NAME } from '@/tests/coherence/structureNames';
import {
  appearing,
  brightBlood,
  CAVITIES,
  compareSuspicions,
  islands,
  offWhitelist,
  RODERO_EXTRA,
  WALL_RANGE_MM,
  wallThickness,
  type PlaneSample,
  type Suspicion,
} from '@/tests/coherence/planeSuspicions';
import {
  ascii,
  drawText,
  echoImage,
  fill,
  H,
  mapping,
  nudged,
  renderPolar,
  REVIEW_CHOICE,
  reviewChoiceLabel,
  reviewControl,
  structureMap,
  type ReviewModel,
  W,
} from './reviewFrame';

/** The planes of a view the sheet looks at: the canonical one and its neighbours, as (label, tilt, turn). */
export const NEIGHBOUR_PLANES: readonly [string, number, number][] = [
  ['0', 0, 0],
  ['giro+5', 0, 5],
  ['giro-5', 0, -5],
  ['giro+15', 0, 15],
  ['giro-15', 0, -15],
  ['giro+30', 0, 30],
  ['giro-30', 0, -30],
  ['incl+7', 7, 0],
  ['incl-7', -7, 0],
  ['incl+15', 15, 0],
  ['incl-15', -15, 0],
];
/** The pairs of planes 5° apart between which a structure may appear or vanish. */
const APART_PAIRS: readonly [string, string][] = [
  ['0', 'giro+5'],
  ['0', 'giro-5'],
];
/** How many suspicions get a crop and a place on the contact sheet. */
export const SHEET_IMAGES = 24;
/** Side (px) of the crop around a suspicion, in the sector's pixels. */
const CROP = 200;
const CAPTION = 18;
const COLUMNS = 3;
const GAP = 6;

export interface SheetSuspicion extends Suspicion {
  view: string;
  plane: string;
  phaseName: 'TD' | 'TS';
  /** `view plane phase kind Structure`: what KNOWN_SUSPICIONS declares. */
  key: string;
  /** The panels the crop is taken from. */
  eco: Uint8ClampedArray;
  map: Uint8ClampedArray;
}

const name = (s: Structure): string => structureLabel(s);

/** The sample of a plane: the structure grid, what lies behind the pleura, the echo grey, and both panels. */
function samplePlane(
  renderer: ProceduralSliceRenderer,
  m: ReviewModel,
  view: ViewTarget,
  tilt: number,
  turn: number,
  phase: number,
): { ps: PlaneSample; eco: Uint8ClampedArray; map: Uint8ClampedArray } {
  const ctrl = nudged(reviewControl(view, m), tilt, turn);
  const beam = beamFrameFromPose(poseFromControl(m.thorax, ctrl), 1);
  const frame = renderPolar(renderer, m, beam, phase);
  const eco = echoImage(frame, m);
  const grey = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p++) grey[p] = eco[4 * p]!;
  const { map, grid, behind } = structureMap(frame);
  return {
    ps: {
      W,
      H,
      pxPerCm: mapping.pxPerCm,
      apexX: mapping.apexX,
      apexY: mapping.apexY,
      grid,
      behind,
      grey,
    },
    eco,
    map,
  };
}

/** The suspicions of one view of a case over its planes and both phases. */
export function viewSuspicions(
  renderer: ProceduralSliceRenderer,
  m: ReviewModel,
  view: ViewTarget,
): SheetSuspicion[] {
  const extra = REVIEW_CHOICE.anatomy === 'rodero' ? RODERO_EXTRA : new Set<Structure>();
  const out: SheetSuspicion[] = [];
  for (const [phaseName, phase] of [
    ['TD', 0],
    ['TS', m.esPhase],
  ] as const) {
    const samples = new Map(
      NEIGHBOUR_PLANES.map(([label, tilt, turn]) => [
        label,
        samplePlane(renderer, m, view, tilt, turn, phase),
      ]),
    );
    const add = (plane: string, found: Suspicion[], from = samples.get(plane)!) =>
      out.push(
        ...found.map((s) => ({
          ...s,
          view: view.id,
          plane,
          phaseName,
          key: `${view.id} ${plane} ${phaseName} ${s.kind} ${STRUCTURE_NAME[s.structure] ?? s.structure}`,
          eco: from.eco,
          map: from.map,
        })),
      );
    for (const [plane, { ps }] of samples) {
      if (plane === '0') add(plane, offWhitelist(ps, view.id, extra, { name }));
      for (const c of CAVITIES) add(plane, brightBlood(ps, c, { name }));
      add(plane, islands(ps, { name }));
      for (const w of Object.keys(WALL_RANGE_MM).map(Number) as Structure[])
        add(plane, wallThickness(ps, w, phase > 0, { name }));
    }
    for (const [a, b] of APART_PAIRS) {
      const found = appearing(samples.get(a)!.ps, samples.get(b)!.ps, [a, b], { name });
      // the crop comes from the plane where the structure shows
      for (const s of found)
        add(`${a}/${b}`, [s], s.text.includes(` en ${b} `) ? samples.get(b)! : samples.get(a)!);
    }
  }
  return out;
}

/**
 * The entries of KNOWN_SUSPICIONS, read from the test's source (importing a test would run it): key → why it is normal.
 */
export function readKnownSuspicions(root = process.cwd()): Map<string, string> {
  const src = readFileSync(join(root, 'src/tests/coherence/planeSuspicions.test.ts'), 'utf8');
  const at = src.indexOf('const KNOWN_SUSPICIONS');
  const body = src.slice(src.indexOf('{', at), src.indexOf('\n};', at));
  return new Map([...body.matchAll(/'([^']+)':\s*\n?\s*'([^']*)'/g)].map((m) => [m[1]!, m[2]!]));
}

/** One crop: the echo and the map around the suspicion, side by side, with its box and a caption. */
function crop(
  s: SheetSuspicion,
  caption: string,
): { width: number; height: number; rgba: Uint8ClampedArray } {
  const width = 2 * CROP + GAP,
    height = CROP + CAPTION;
  const rgba = new Uint8ClampedArray(width * height * 4);
  fill(rgba, [28, 28, 32]);
  const cx = Math.round((s.box.x0 + s.box.x1) / 2),
    cy = Math.round((s.box.y0 + s.box.y1) / 2);
  const x0 = Math.max(0, Math.min(W - CROP, cx - CROP / 2)),
    y0 = Math.max(0, Math.min(H - CROP, cy - CROP / 2));
  for (const [panel, ox] of [
    [s.eco, 0],
    [s.map, CROP + GAP],
  ] as const)
    for (let y = 0; y < CROP; y++)
      for (let x = 0; x < CROP; x++) {
        const src = ((y0 + y) * W + x0 + x) * 4,
          dst = ((CAPTION + y) * width + ox + x) * 4;
        rgba[dst] = panel[src]!;
        rgba[dst + 1] = panel[src + 1]!;
        rgba[dst + 2] = panel[src + 2]!;
      }
  // the box, in yellow, on both panels
  for (const ox of [0, CROP + GAP])
    for (let y = s.box.y0 - 2; y <= s.box.y1 + 2; y++)
      for (let x = s.box.x0 - 2; x <= s.box.x1 + 2; x++) {
        const edge = y < s.box.y0 || y > s.box.y1 || x < s.box.x0 || x > s.box.x1;
        const px = x - x0,
          py = y - y0;
        if (!edge || px < 0 || py < 0 || px >= CROP || py >= CROP) continue;
        const o = ((CAPTION + py) * width + ox + px) * 4;
        rgba[o] = 255;
        rgba[o + 1] = 220;
        rgba[o + 2] = 60;
      }
  drawText(rgba, width, height, 2, 2, ascii(caption).toUpperCase().slice(0, 33), [255, 220, 120]);
  return { width, height, rgba };
}

/** Writes the sheet of a case: the markdown, one crop per suspicion up to SHEET_IMAGES, and the contact sheet. */
export function writeSuspicionSheet(
  outDir: string,
  m: ReviewModel,
  found: SheetSuspicion[],
  known: Map<string, string>,
  seconds: number,
): void {
  const dir = join(outDir, 'sospechas');
  mkdirSync(dir, { recursive: true });
  const fresh = found.filter((s) => !known.has(s.key)).sort(compareSuspicions);
  const normal = found.filter((s) => known.has(s.key)).sort(compareSuspicions);
  const stale = [...known.keys()].filter((k) => !found.some((s) => s.key === k));
  const lines: string[] = [
    `# Hoja de sospechas: ${m.c.id}${reviewChoiceLabel() ? ` (${reviewChoiceLabel()})` : ''}`,
    '',
    `Candidatos a defecto que las hojas encuentran solas sobre ${VIEW_TARGETS.length} vistas, ${NEIGHBOUR_PLANES.length} planos por vista (la canónica, giros ±5°, ±15° y ±30°, inclinaciones ±7° y ±15°) y dos fases (TD, TS en fase ${m.esPhase.toFixed(2)}); ${seconds.toFixed(0)} s. Cada uno es una sospecha mecánica para confirmar, descartar o nombrar, no un veredicto: brillo donde el mapa dice sangre (una cavidad ${'>'} 1,5× su propia mediana lejos de la pared), una estructura en más islas de las que su anatomía admite, una que aparece o desaparece entre planos a 5°, una etiqueta fuera de la lista blanca de la vista (decisión 325) y una pared cuyo espesor a través queda fuera de rango. Primero los invariantes rotos, después las sospechas por cifra. Lo que ya se descartó va al final («esto es normal», \`KNOWN_SUSPICIONS\`).`,
    '',
    `**${fresh.length} sospechas nuevas** (${fresh.filter((s) => s.invariant).length} invariantes), ${normal.length} ya descartadas${stale.length ? `, ${stale.length} descartes que ya no aparecen` : ''}.`,
    '',
  ];
  if (fresh.length) {
    lines.push('![hoja](sospechas/hoja-sospechas.png)', '', '## Sospechas', '');
    fresh.forEach((s, i) => {
      const n = i + 1;
      const caption = `${n}. ${viewLabel(s.view)} ${s.plane} ${s.phaseName}`;
      lines.push(
        `### ${n}. ${s.invariant ? 'Invariante' : 'Sospecha'} · ${s.kind} · ${viewLabel(s.view)}, plano ${s.plane}, ${s.phaseName}`,
        '',
        `${s.text}. Clave \`${s.key}\`.`,
        '',
      );
      if (i < SHEET_IMAGES) {
        const c = crop(s, caption);
        const file = `sospechas/${String(n).padStart(2, '0')}.png`;
        writeFileSync(join(outDir, file), encodePng(c.width, c.height, c.rgba));
        lines.push(`![${n}](${file})`, '');
      }
    });
    // the contact sheet: the first SHEET_IMAGES crops in COLUMNS columns
    const shown = fresh.slice(0, SHEET_IMAGES);
    const cw = 2 * CROP + GAP,
      ch = CROP + CAPTION;
    const rows = Math.ceil(shown.length / COLUMNS);
    const width = COLUMNS * cw + (COLUMNS + 1) * GAP,
      height = rows * ch + (rows + 1) * GAP;
    const sheet = new Uint8ClampedArray(width * height * 4);
    fill(sheet, [28, 28, 32]);
    shown.forEach((s, i) => {
      const c = crop(s, `${i + 1}. ${viewLabel(s.view)} ${s.plane} ${s.phaseName}`);
      const ox = GAP + (i % COLUMNS) * (cw + GAP),
        oy = GAP + Math.floor(i / COLUMNS) * (ch + GAP);
      for (let y = 0; y < ch; y++)
        sheet.set(c.rgba.subarray(y * cw * 4, (y + 1) * cw * 4), ((oy + y) * width + ox) * 4);
    });
    writeFileSync(join(dir, 'hoja-sospechas.png'), encodePng(width, height, sheet));
  }
  lines.push('## Esto es normal', '');
  if (!normal.length) lines.push('Nada descartado todavía.', '');
  for (const s of normal) lines.push(`- \`${s.key}\`: ${s.text}. ${known.get(s.key)}`);
  if (stale.length)
    lines.push(
      '',
      '## Descartes que ya no aparecen',
      '',
      ...stale.map((k) => `- \`${k}\`: ${known.get(k)}`),
    );
  writeFileSync(join(outDir, 'hoja-sospechas.md'), lines.join('\n') + '\n');
}
