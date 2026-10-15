/**
 * Clinical review sheets (decision 326): one sheet per view with the normal case and three pathological ones
 * (pulmonary hypertension, HFrEF with severe MR, obstructive HCM). Each row holds the echo image and its labelled
 * structure map at end-diastole and end-systole. The map is drawn from the same polar frame as the image
 * (`frame.structure` through the scan LUT, as `clinicalImage.ts` reads it), so both share the sector geometry pixel
 * for pixel; what a line meets behind the pleura is dimmed on the map, because the image shows reverberation there.
 *   npx tsx tools/offline/review/review-sheets.ts [outDir] [viewIds,comma] [caseIds,comma]
 * Writes <outDir>/<view>.png (the sheet), <outDir>/<view>.md (the census of each frame) and <outDir>/index.md.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodePng } from '../render/png';
import { loadCaseById } from '@/cases';
import { buildCaseModels } from '@/simulator/anatomy/caseModels';
import { computeHeartPose } from '@/simulator/anatomy/heartModel';
import { STRUCTURE_RGB, TISSUE_RGB, type Rgb } from '@/simulator/anatomy/structurePalette';
import { Structure, Tissue } from '@/simulator/anatomy/tissue';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { ProceduralSliceRenderer } from '@/simulator/renderer/procedural/sliceRenderer';
import {
  allocPolarFrame,
  DEFAULT_ACQUISITION,
  polarSpecFor,
  type PolarFrame,
  type Scene,
} from '@/simulator/renderer/types';
import { applyConsole, createConsoleState } from '@/simulator/renderer/postprocess/consolePipeline';
import {
  caseArtifactLevels,
  consoleArtifacts,
  scenePhysicsFor,
} from '@/simulator/renderer/scenePhysics';
import {
  buildScanLut,
  computeSectorMapping,
  scanConvertLut,
  type ScanLut,
} from '@/simulator/renderer/scanConvert';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import { canonicalControl, VIEW_TARGETS } from '@/simulator/windows/viewTargets';
import { viewLabel } from '@/simulator/windows/viewLabels';
import { structureLabel } from '@/app/review';

/** The four cases of the clinical review, in the order of the rows. */
const DEFAULT_CASES = [
  'normal-excellent-window',
  'pulmonary-hypertension-rv',
  'hfref-severe-mr',
  'hocm-sam',
];

/** Short upper-case names drawn over the map (the bitmap font has no lower case nor accents). */
const MAP_LABELS: Partial<Record<Structure, string>> = {
  [Structure.LvCavity]: 'VI',
  [Structure.LvWallSeptal]: 'SEPTO',
  [Structure.LvWallLateral]: 'LATERAL',
  [Structure.LvWallAnterior]: 'ANTERIOR',
  [Structure.LvWallInferior]: 'INFERIOR',
  [Structure.LvApex]: 'APEX',
  [Structure.RvCavity]: 'VD',
  [Structure.RvWall]: 'PARED VD',
  [Structure.LaCavity]: 'AI',
  [Structure.LaWall]: 'PARED AI',
  [Structure.RaCavity]: 'AD',
  [Structure.RaWall]: 'PARED AD',
  [Structure.MitralAnterior]: 'VM ANT',
  [Structure.MitralPosterior]: 'VM POST',
  [Structure.AorticValve]: 'VAO',
  [Structure.TricuspidValve]: 'VT',
  [Structure.AorticRoot]: 'RAIZ AO',
  [Structure.Lvot]: 'TSVI',
  [Structure.Rvot]: 'TSVD',
  [Structure.PapillaryMuscle]: 'MP',
  [Structure.Pericardium]: 'PERICARDIO',
  [Structure.PericardialEffusion]: 'DERRAME',
  [Structure.DescendingAorta]: 'AO DESC',
  [Structure.Ivc]: 'VCI',
  [Structure.ChestWall]: 'PARED TORACICA',
  [Structure.Rib]: 'COSTILLA',
  [Structure.Sternum]: 'ESTERNON',
  [Structure.Lung]: 'PULMON',
  [Structure.Liver]: 'HIGADO',
  [Structure.Spine]: 'COLUMNA',
  [Structure.InteratrialSeptum]: 'TIA',
  [Structure.PulmonaryValve]: 'VALV PULM',
  [Structure.MitralAnnulus]: 'ANILLO M',
  [Structure.TricuspidAnnulus]: 'ANILLO T',
  [Structure.Chordae]: 'CUERDAS',
  [Structure.ModeratorBand]: 'BANDA MOD',
  [Structure.LaAppendage]: 'OREJUELA I',
  [Structure.RaAppendage]: 'OREJUELA D',
  [Structure.PulmonaryVein]: 'V PULMONAR',
  [Structure.CoronarySinus]: 'SENO COR',
  [Structure.PulmonaryArtery]: 'AP',
  [Structure.RvPapillary]: 'MP VD',
  [Structure.Svc]: 'VCS',
  [Structure.HepaticVein]: 'V HEPATICA',
  [Structure.Diaphragm]: 'DIAFRAGMA',
  [Structure.EpicardialFat]: 'GRASA',
  [Structure.Stomach]: 'ESTOMAGO',
  [Structure.AscendingAorta]: 'AO ASC',
  [Structure.AorticArch]: 'ARCO AO',
  [Structure.BrachiocephalicArtery]: 'TBC',
  [Structure.LeftCommonCarotid]: 'CAROTIDA I',
  [Structure.LeftSubclavian]: 'SUBCLAVIA I',
};

/** A structure is labelled on the map when it covers at least this share of the sector's pixels. */
const LABEL_MIN_SHARE = 0.001;
/** Structures below this share are left out of the census table (they are listed, with the rest, in the frame line). */
const CENSUS_MIN_SHARE = 0.0005;
/** Dimming of the map behind the first lung sample of a line. */
const BEHIND_LUNG = 0.3;

const W = 512,
  H = 440;
const GAP = 6;
const HEADER = 26;
const SCALE = 2; // bitmap font scale: 10×14 px per character

const outDir = process.argv[2] ?? 'tools/offline/review/out/sheets';
mkdirSync(outDir, { recursive: true });
const viewIds = process.argv[3] ? process.argv[3].split(',') : VIEW_TARGETS.map((v) => v.id);
const caseIds = process.argv[4] ? process.argv[4].split(',') : DEFAULT_CASES;

const settings = { ...DEFAULT_ACQUISITION };
const spec = polarSpecFor(settings, 'high');
const mapping = computeSectorMapping(spec, W, H, false);
const lut = buildScanLut(spec, mapping);
const renderer = new ProceduralSliceRenderer();
const OUTSIDE = 255; // sentinel of the structure grid outside the sector

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

// the app's chain (with the diaphragm fitted under the heart, decision 229), as render-views.ts
const models = caseIds.map((id) => {
  const c = loadCaseById(id);
  const built = buildCaseModels(c, {
    position: 'left-lateral',
    respiration: 'expiration',
    headElevationDeg: 0,
  });
  return { c, ...built, esPhase: built.tables.endSystoleS / built.tables.rrS };
});

const index: string[] = [
  '# Hojas de revisión clínica',
  '',
  `Casos: ${models.map((m) => `${m.c.id} (TS en fase ${m.esPhase.toFixed(2)})`).join(', ')}.`,
  'Cada fila: eco y mapa de estructuras en telediástole (fase 0) y telesístole (menor volumen del VI), con la misma geometría',
  'de sector; el mapa sale del mismo fotograma polar que la imagen y se atenúa detrás de la pleura.',
  '',
];
for (const id of viewIds) {
  const view = VIEW_TARGETS.find((v) => v.id === id);
  if (!view) throw new Error(`unknown view ${id}`);
  const t0 = performance.now();
  const rows = models.map((m) => {
    const ctrl = canonicalControl(view, m.heart, m.thorax);
    const beam = beamFrameFromPose(poseFromControl(m.thorax, ctrl), 1);
    const frames: Frame[] = (
      [
        ['TD', 0],
        ['TS', m.esPhase],
      ] as const
    ).map(([phaseName, phase]) => {
      const pose = computeHeartPose(m.heart, cycleStateAt(m.tables, phase));
      const scene: Scene = {
        heart: m.heart,
        heartPose: pose,
        thorax: m.thorax,
        physics: scenePhysicsFor(m.c, settings),
      };
      const frame = allocPolarFrame(spec);
      renderer.render(scene, beam, spec, phase, frame);
      const cs = createConsoleState(m.c.seed);
      const disp = new Uint8ClampedArray(spec.lines * spec.samples);
      applyConsole(frame, settings, cs, disp, consoleArtifacts(caseArtifactLevels(m.c)));
      const eco = new Uint8ClampedArray(W * H * 4);
      scanConvertLut(disp, lut, eco);
      const { map, visible, hidden } = structureMap(frame, lut);
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

/**
 * The structure map of a frame on the sector: each pixel takes the structure of its nearest polar sample (as
 * `clinicalImage.ts` does), coloured with the palette the navigator uses; a thorax sample without structure takes its
 * tissue colour. From the first lung sample of a line on, the map is dimmed. Returns the share of the sector's pixels
 * each structure covers, in front of and behind the pleura.
 */
function structureMap(
  frame: PolarFrame,
  lut: ScanLut,
): { map: Uint8ClampedArray; visible: Map<Structure, number>; hidden: Map<Structure, number> } {
  const N = frame.spec.samples;
  const lines = frame.spec.lines;
  // first lung sample of each line: the pleura, from which the image is reverberation (`drawLung`)
  const lungEntry = new Int32Array(lines).fill(-1);
  for (let li = 0; li < lines; li++)
    for (let si = 0; si < N; si++)
      if (frame.tissue[li * N + si] === Tissue.Lung) {
        lungEntry[li] = si;
        break;
      }
  const map = new Uint8ClampedArray(W * H * 4);
  const grid = new Uint8Array(W * H).fill(OUTSIDE);
  const behind = new Uint8Array(W * H);
  const visibleCount = new Map<Structure, number>();
  const hiddenCount = new Map<Structure, number>();
  let inSector = 0;
  for (let p = 0, o = 0; p < W * H; p++, o += 4) {
    map[o + 3] = 255;
    if (lut.idx[p]! < 0) continue;
    const li = lut.li[p]!,
      si = lut.si[p]!;
    const i = li * N + si;
    const st: Structure = frame.structure[i]!;
    const tissue: Tissue = frame.tissue[i]!;
    const col: Rgb = STRUCTURE_RGB[st] ?? TISSUE_RGB[tissue] ?? [80, 80, 80];
    const e = lungEntry[li]!;
    const dim = e >= 0 && si > e;
    const k = dim ? BEHIND_LUNG : 1;
    map[o] = col[0] * k;
    map[o + 1] = col[1] * k;
    map[o + 2] = col[2] * k;
    grid[p] = st;
    behind[p] = dim ? 1 : 0;
    inSector++;
    const counts = dim ? hiddenCount : visibleCount;
    counts.set(st, (counts.get(st) ?? 0) + 1);
  }
  drawDepthTicks(map);
  drawLabels(map, grid, behind, visibleCount, hiddenCount, inSector);
  const share = (m: Map<Structure, number>) =>
    new Map([...m].map(([s, n]) => [s, n / inSector] as const));
  return { map, visible: share(visibleCount), hidden: share(hiddenCount) };
}

/** Depth ticks along the sector's left edge: one per centimetre, longer every five. */
function drawDepthTicks(rgba: Uint8ClampedArray): void {
  for (let cm = 0; cm <= mapping.depthCm; cm++) {
    const y = Math.round(mapping.apexY + cm * mapping.pxPerCm);
    if (y >= H) continue;
    for (let x = 0; x < (cm % 5 === 0 ? 12 : 6); x++) putPixel(rgba, W, x, y, [255, 255, 255]);
  }
}

/**
 * Writes the name of each structure over the largest connected patch it draws, when the structure covers at least
 * `LABEL_MIN_SHARE` of the sector. A label that would overlap another is moved down or up until it is free.
 */
function drawLabels(
  rgba: Uint8ClampedArray,
  grid: Uint8Array,
  behind: Uint8Array,
  visible: Map<Structure, number>,
  hidden: Map<Structure, number>,
  inSector: number,
): void {
  const ids = new Set<Structure>([...visible.keys(), ...hidden.keys()]);
  const entries = [...ids]
    .filter((s) => s !== Structure.None)
    .map((s) => ({ s, n: (visible.get(s) ?? 0) + (hidden.get(s) ?? 0) }))
    .filter((e) => e.n / inSector >= LABEL_MIN_SHARE)
    .sort((a, b) => b.n - a.n);
  const seen = new Uint8Array(W * H);
  const boxes: { x0: number; y0: number; x1: number; y1: number }[] = [];
  for (const { s } of entries) {
    const patch = largestPatch(grid, seen, s);
    if (!patch) continue;
    const text = labelOf(s);
    const tw = text.length * 6 * SCALE - SCALE,
      th = 7 * SCALE;
    const anchors: [number, number][] = [
      [patch.x, patch.y],
      [patch.x, patch.y + 18],
      [patch.x, patch.y - 18],
      [patch.x, patch.y + 36],
      [patch.x, patch.y - 36],
      [patch.x + 30, patch.y],
      [patch.x - 30, patch.y],
    ];
    const candidates = anchors.map(([ax, ay]) => {
      const x0 = Math.max(2, Math.min(W - tw - 2, Math.round(ax - tw / 2)));
      const y0 = Math.max(2, Math.min(H - th - 2, Math.round(ay - th / 2)));
      return { x0, y0, x1: x0 + tw, y1: y0 + th };
    });
    const free = candidates.find(
      (box) =>
        !boxes.some(
          (b) => b.x0 < box.x1 + 4 && b.x1 + 4 > box.x0 && b.y0 < box.y1 + 4 && b.y1 + 4 > box.y0,
        ),
    );
    const box = free ?? candidates[0]!;
    boxes.push(box);
    const dimmed = behind[patch.y * W + patch.x] === 1;
    drawText(rgba, W, H, box.x0, box.y0, text, dimmed ? [170, 170, 170] : [255, 255, 255]);
  }
}

/**
 * The largest 4-connected patch of pixels with structure `s`, and the pixel of that patch nearest its centroid (a wall
 * or an annulus is concave, and its centroid may fall in the cavity). `seen` marks the pixels already visited.
 */
function largestPatch(
  grid: Uint8Array,
  seen: Uint8Array,
  s: Structure,
): { x: number; y: number; size: number } | null {
  let best: { x: number; y: number; size: number } | null = null;
  const stack: number[] = [];
  for (let p0 = 0; p0 < W * H; p0++) {
    if (grid[p0] !== s || seen[p0]) continue;
    let size = 0,
      sx = 0,
      sy = 0;
    const members: number[] = [];
    stack.push(p0);
    seen[p0] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      members.push(p);
      size++;
      const x = p % W,
        y = (p - x) / W;
      sx += x;
      sy += y;
      for (const q of [p - 1, p + 1, p - W, p + W]) {
        if (q < 0 || q >= W * H) continue;
        if ((q === p - 1 && x === 0) || (q === p + 1 && x === W - 1)) continue;
        if (grid[q] === s && !seen[q]) {
          seen[q] = 1;
          stack.push(q);
        }
      }
    }
    if (!best || size > best.size) {
      const cx = sx / size,
        cy = sy / size;
      let nearest = members[0]!,
        d2 = Infinity;
      for (const p of members) {
        const x = p % W,
          y = (p - x) / W;
        const d = (x - cx) ** 2 + (y - cy) ** 2;
        if (d < d2) {
          d2 = d;
          nearest = p;
        }
      }
      best = { x: nearest % W, y: Math.floor(nearest / W), size };
    }
  }
  return best;
}

function labelOf(s: Structure): string {
  return MAP_LABELS[s] ?? structureLabel(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
}

/** One sheet: a header row with the view and the columns, then a row per case with its four panels. */
function composeSheet(
  title: string,
  rows: {
    m: (typeof models)[number];
    ctrl: unknown;
    frames: Frame[];
  }[],
): { width: number; height: number; rgba: Uint8ClampedArray } {
  const width = 4 * W + 5 * GAP;
  const height = HEADER + rows.length * (HEADER + H + GAP) + GAP;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = 28;
    rgba[i + 1] = 28;
    rgba[i + 2] = 32;
    rgba[i + 3] = 255;
  }
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
    const label = `${m.c.id}  ·  ${ascii(m.c.title)}  ·  TS EN FASE ${m.esPhase.toFixed(2)}`;
    drawText(rgba, width, height, GAP, top + 6, label.toUpperCase(), [255, 220, 120]);
    frames.forEach((f, k) => {
      blit(rgba, width, f.eco, GAP + 2 * k * (W + GAP), top + HEADER);
      blit(rgba, width, f.map, GAP + (2 * k + 1) * (W + GAP), top + HEADER);
    });
  });
  return { width, height, rgba };
}

/** The census of the frames of a view: the share of the sector each structure covers, per case and phase. */
function censusSheet(
  id: string,
  rows: { m: (typeof models)[number]; ctrl: unknown; frames: Frame[] }[],
): string[] {
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

function shortCase(id: string): string {
  return (
    {
      'normal-excellent-window': 'normal',
      'pulmonary-hypertension-rv': 'HTP',
      'hfref-severe-mr': 'ICFEr',
      'hocm-sam': 'MCHO',
    }[id] ?? id
  );
}

function ascii(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/—/g, '-');
}

function blit(
  dst: Uint8ClampedArray,
  dstW: number,
  src: Uint8ClampedArray,
  x0: number,
  y0: number,
): void {
  for (let y = 0; y < H; y++)
    dst.set(src.subarray(y * W * 4, (y + 1) * W * 4), ((y0 + y) * dstW + x0) * 4);
}

function putPixel(rgba: Uint8ClampedArray, width: number, x: number, y: number, c: Rgb): void {
  const o = (y * width + x) * 4;
  rgba[o] = c[0];
  rgba[o + 1] = c[1];
  rgba[o + 2] = c[2];
}

/** 5×7 upper-case bitmap text, scaled ×SCALE, with a one-pixel dark outline so it reads on any colour. */
function drawText(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  x0: number,
  y0: number,
  text: string,
  colour: Rgb,
): void {
  const put = (x: number, y: number, c: Rgb) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    putPixel(rgba, width, x, y, c);
  };
  const cells: [number, number][] = [];
  const FONT = buildFont();
  for (let d = 0; d < text.length; d++) {
    const glyph = FONT[text[d]!] ?? FONT['?']!;
    for (let row = 0; row < 7; row++)
      for (let col = 0; col < 5; col++)
        if (glyph[row]![col] === '#')
          for (let sy = 0; sy < SCALE; sy++)
            for (let sx = 0; sx < SCALE; sx++)
              cells.push([x0 + d * 6 * SCALE + col * SCALE + sx, y0 + row * SCALE + sy]);
  }
  for (const [x, y] of cells)
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) put(x + dx, y + dy, [0, 0, 0]);
  for (const [x, y] of cells) put(x, y, colour);
}

/** 5×7 glyphs of the labels; a hoisted function, because the sheets are drawn at module load, before a const here exists. */
function buildFont(): Record<string, string[]> {
  return {
    A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
    B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
    C: ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
    D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
    E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
    F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
    G: ['.####', '#....', '#....', '#.###', '#...#', '#...#', '.####'],
    H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
    I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
    J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
    K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
    L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
    M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
    N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
    O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
    P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
    Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
    R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
    S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
    T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
    U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
    V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
    W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
    X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
    Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
    Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
    '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
    '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
    '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
    '3': ['#####', '...#.', '..#..', '...#.', '....#', '#...#', '.###.'],
    '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
    '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
    '6': ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
    '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
    '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
    '9': ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
    ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
    '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
    ',': ['.....', '.....', '.....', '.....', '.##..', '.##..', '..#..'],
    '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
    ':': ['.....', '.##..', '.##..', '.....', '.##..', '.##..', '.....'],
    '(': ['..#..', '.#...', '#....', '#....', '#....', '.#...', '..#..'],
    ')': ['..#..', '...#.', '....#', '....#', '....#', '...#.', '..#..'],
    '/': ['....#', '....#', '...#.', '..#..', '.#...', '#....', '#....'],
    '%': ['##..#', '##..#', '...#.', '..#..', '.#...', '#..##', '#..##'],
    '·': ['.....', '.....', '.....', '.##..', '.##..', '.....', '.....'],
    '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'],
  };
}
