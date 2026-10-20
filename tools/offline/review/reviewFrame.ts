/**
 * What the clinical review tools share (decisions 326 and 329): the four cases of the review, the sector geometry of
 * the CPU chain (the polar spec at high quality, its sector mapping and scan LUT at 512×440), the render of one polar
 * frame through the app's chain, the structure map drawn from that same frame (`frame.structure` through the LUT, as
 * `clinicalImage.ts` reads it) with its labels, and the bitmap text the sheets and clips write with.
 */
import { loadCaseById } from '@/cases';
import { buildCaseModels } from '@/simulator/anatomy/caseModels';
import { computeHeartPose, type HeartModel } from '@/simulator/anatomy/heartModel';
import { STRUCTURE_RGB, TISSUE_RGB, type Rgb } from '@/simulator/anatomy/structurePalette';
import type { ThoraxModel } from '@/simulator/anatomy/thoraxModel';
import { Structure, Tissue } from '@/simulator/anatomy/tissue';
import type { BeatTables } from '@/simulator/cardiac-cycle/cycleModel';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import type { BeamFrame } from '@/simulator/probe/pose';
import type { ProceduralSliceRenderer } from '@/simulator/renderer/procedural/sliceRenderer';
import {
  allocPolarFrame,
  DEFAULT_ACQUISITION,
  polarSpecFor,
  type PolarFrame,
  type Scene,
} from '@/simulator/renderer/types';
import {
  applyConsole,
  createConsoleState,
  type ConsoleState,
} from '@/simulator/renderer/postprocess/consolePipeline';
import {
  caseArtifactLevels,
  consoleArtifacts,
  scenePhysicsFor,
} from '@/simulator/renderer/scenePhysics';
import {
  buildScanLut,
  computeSectorMapping,
  scanConvertLut,
} from '@/simulator/renderer/scanConvert';
import { structureLabel } from '@/app/review';
import {
  controlThroughCrux,
  type ViewTarget,
} from '@/simulator/windows/viewTargets';
import type { ProbeControl } from '@/simulator/probe/pose';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadRoderoVolume } from '@/simulator/anatomy/roderoAsset';
import { volumeHeart, type VolumeHeart } from '@/simulator/anatomy/volumeHeart';
import type { HeartPose } from '@/simulator/anatomy/heartModel';
import { COLE_FORMATION } from '@/simulator/core/coleImage';
import {
  ANATOMY_CHOICES,
  IMAGE_FORMATION_CHOICES,
  type AnatomyChoice,
  type ImageFormationChoice,
} from '@/simulator/core/protocol';
import type { CaseDefinition } from '@/cases/schema';

/** The four cases of the clinical review, in the order of the rows. */
export const DEFAULT_CASES = [
  'normal-excellent-window',
  'pulmonary-hypertension-rv',
  'hfref-severe-mr',
  'hocm-sam',
];

/** Short upper-case names drawn over the map (the bitmap font has no lower case nor accents). */
export const MAP_LABELS: Partial<Record<Structure, string>> = {
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
export const LABEL_MIN_SHARE = 0.001;
/** Structures below this share are left out of the census table (they are listed, with the rest, in the frame line). */
export const CENSUS_MIN_SHARE = 0.0005;
/** Dimming of the map behind the first lung sample of a line. */
const BEHIND_LUNG = 0.3;

/** The panel: the sector of the app's canvas at 512×440. */
export const W = 512,
  H = 440;
/** Bitmap font scale: 10×14 px per character. */
export const SCALE = 2;

export const settings = { ...DEFAULT_ACQUISITION };
export const spec = polarSpecFor(settings, 'high');
export const mapping = computeSectorMapping(spec, W, H, false);
export const lut = buildScanLut(spec, mapping);
const OUTSIDE = 255; // sentinel of the structure grid outside the sector

/** A case of the review with its models, as the app builds them. */
export interface ReviewModel {
  c: CaseDefinition;
  heart: HeartModel;
  thorax: ThoraxModel;
  tables: BeatTables;
  /** End-systole as a phase of the cycle: the least LV volume. */
  esPhase: number;
}

/** The app's chain (with the diaphragm fitted under the heart, decision 229), as render-views.ts. */
export function buildReviewModels(caseIds: string[]): ReviewModel[] {
  return caseIds.map((id) => {
    const c = loadCaseById(id);
    const built = buildCaseModels(c, {
      position: 'left-lateral',
      respiration: 'expiration',
      headElevationDeg: 0,
    });
    return { c, ...built, esPhase: built.tables.endSystoleS / built.tables.rrS };
  });
}

/**
 * The Dev panel's experimental choices for the review tools (decisions 352–354), from REVIEW_ANATOMY (analytic,
 * rodero) and REVIEW_IMAGE (lattice, cole): the shipped Rodero volume that the app loads, moved by each case's cycle, and
 * the convolution image formation.
 */
export const REVIEW_CHOICE = {
  anatomy: (process.env['REVIEW_ANATOMY'] ?? 'analytic') as AnatomyChoice,
  image: (process.env['REVIEW_IMAGE'] ?? 'lattice') as ImageFormationChoice,
};
if (!ANATOMY_CHOICES.includes(REVIEW_CHOICE.anatomy))
  throw new Error(`REVIEW_ANATOMY: ${REVIEW_CHOICE.anatomy} (${ANATOMY_CHOICES.join(', ')})`);
if (!IMAGE_FORMATION_CHOICES.includes(REVIEW_CHOICE.image))
  throw new Error(`REVIEW_IMAGE: ${REVIEW_CHOICE.image} (${IMAGE_FORMATION_CHOICES.join(', ')})`);

/** The choices as the sheets name them, empty for the app's defaults. */
export function reviewChoiceLabel(): string {
  return [
    REVIEW_CHOICE.anatomy === 'rodero' ? 'corazón de Rodero' : '',
    REVIEW_CHOICE.image === 'cole' ? 'imagen por convolución' : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

const roderoVolume =
  REVIEW_CHOICE.anatomy === 'rodero'
    ? await loadRoderoVolume((path) => {
        const b = readFileSync(join(process.cwd(), 'public', path));
        return Promise.resolve(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
      })
    : null;
const boundRodero = new WeakMap<ReviewModel, { vh: VolumeHeart; endDiastole: HeartPose }>();

/** The bound Rodero heart of a case, when the review draws it. */
function boundRoderoOf(m: ReviewModel): { vh: VolumeHeart; endDiastole: HeartPose } | null {
  if (!roderoVolume) return null;
  let b = boundRodero.get(m);
  if (!b) {
    const endDiastole = computeHeartPose(m.heart, cycleStateAt(m.tables, 0));
    b = { vh: volumeHeart(roderoVolume, m.heart, endDiastole), endDiastole };
    boundRodero.set(m, b);
  }
  return b;
}

/** A view's preset as the app sets it: for the Rodero heart, the four-chamber plane through its crux (decision 359). */
export function reviewControl(view: ViewTarget, m: ReviewModel): ProbeControl {
  const c = boundRoderoOf(m)?.vh.crux();
  return controlThroughCrux(view, m.heart, m.thorax, c ? { x: c[0], y: c[1], z: c[2] } : null);
}

/** One polar frame of a case at a phase, from a beam, through the CPU tracer at high quality. */
export function renderPolar(
  renderer: ProceduralSliceRenderer,
  m: ReviewModel,
  beam: BeamFrame,
  phase: number,
): PolarFrame {
  const heartPose = computeHeartPose(m.heart, cycleStateAt(m.tables, phase));
  const scene: Scene = {
    heart: m.heart,
    heartPose,
    thorax: m.thorax,
    physics: scenePhysicsFor(m.c, settings),
  };
  const b = boundRoderoOf(m);
  if (b) {
    scene.heartClassifier = b.vh.classifier({
      apparatus: heartPose,
      motion: { pose: heartPose, endDiastole: b.endDiastole },
    });
  }
  if (REVIEW_CHOICE.image === 'cole') scene.imageFormation = COLE_FORMATION;
  const frame = allocPolarFrame(spec);
  renderer.render(scene, beam, spec, phase, frame);
  return frame;
}

/** The console state of a case: a fresh one draws a frame without persistence history. */
export function consoleStateFor(m: ReviewModel): ConsoleState {
  return createConsoleState(m.c.seed);
}

/** The echo image of a polar frame on the sector (RGBA, W×H): the console of the case, then the scan LUT. */
export function echoImage(
  frame: PolarFrame,
  m: ReviewModel,
  cs: ConsoleState = consoleStateFor(m),
): Uint8ClampedArray {
  const disp = new Uint8ClampedArray(spec.lines * spec.samples);
  applyConsole(frame, settings, cs, disp, consoleArtifacts(caseArtifactLevels(m.c)));
  const eco = new Uint8ClampedArray(W * H * 4);
  scanConvertLut(disp, lut, eco);
  return eco;
}

export interface StructureMap {
  map: Uint8ClampedArray;
  /** Share of the sector's pixels in front of the pleura, per structure. */
  visible: Map<Structure, number>;
  /** Share of the sector's pixels behind the pleura, per structure. */
  hidden: Map<Structure, number>;
}

/**
 * The structure map of a frame on the sector: each pixel takes the structure of its nearest polar sample (as
 * `clinicalImage.ts` does), coloured with the palette the navigator uses; a thorax sample without structure takes its
 * tissue colour. From the first lung sample of a line on, the map is dimmed. Returns the share of the sector's pixels
 * each structure covers, in front of and behind the pleura.
 */
export function structureMap(frame: PolarFrame): StructureMap {
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

export function labelOf(s: Structure): string {
  return MAP_LABELS[s] ?? ascii(structureLabel(s)).toUpperCase();
}

export function shortCase(id: string): string {
  return (
    {
      'normal-excellent-window': 'normal',
      'pulmonary-hypertension-rv': 'HTP',
      'hfref-severe-mr': 'ICFEr',
      'hocm-sam': 'MCHO',
    }[id] ?? id
  );
}

/** Strips the accents and the dashes the bitmap font has no glyph for. */
export function ascii(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/—/g, '-');
}

/** Copies a W×H panel into a larger RGBA canvas at (x0, y0). */
export function blit(
  dst: Uint8ClampedArray,
  dstW: number,
  src: Uint8ClampedArray,
  x0: number,
  y0: number,
): void {
  for (let y = 0; y < H; y++)
    dst.set(src.subarray(y * W * 4, (y + 1) * W * 4), ((y0 + y) * dstW + x0) * 4);
}

export function putPixel(
  rgba: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  c: Rgb,
): void {
  const o = (y * width + x) * 4;
  rgba[o] = c[0];
  rgba[o + 1] = c[1];
  rgba[o + 2] = c[2];
}

/** Fills an RGBA canvas with one opaque colour. */
export function fill(rgba: Uint8ClampedArray, c: Rgb): void {
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = c[0];
    rgba[i + 1] = c[1];
    rgba[i + 2] = c[2];
    rgba[i + 3] = 255;
  }
}

/** 5×7 upper-case bitmap text, scaled ×SCALE, with a one-pixel dark outline so it reads on any colour. */
export function drawText(
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

/** 5×7 glyphs of the labels. */
const FONT: Record<string, string[]> = {
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
  '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
  ':': ['.....', '.##..', '.##..', '.....', '.##..', '.##..', '.....'],
  '(': ['..#..', '.#...', '#....', '#....', '#....', '.#...', '..#..'],
  ')': ['..#..', '...#.', '....#', '....#', '....#', '...#.', '..#..'],
  '/': ['....#', '....#', '...#.', '..#..', '.#...', '#....', '#....'],
  '%': ['##..#', '##..#', '...#.', '..#..', '.#...', '#..##', '#..##'],
  '·': ['.....', '.....', '.....', '.##..', '.##..', '.....', '.....'],
  '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'],
};
