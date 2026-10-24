/**
 * Mechanical suspicions on a drawn plane (decision 365): signals a reviewer would check, found without being asked. On
 * the sector of a frame (its structure grid and its echo greys, pixel for pixel as the review sheets draw them):
 *
 * - brightness where the map says blood: a window of a cavity whose grey is BRIGHT_RATIO times the median of the same
 *   cavity far from its walls;
 * - a structure cut into more islands than anatomy allows in one plane;
 * - a structure that appears or disappears between two planes a few degrees apart;
 * - a label outside the view's white list (decision 325), extended to what the Rodero heart draws;
 * - a wall whose thickness in the plane, measured across it, lies outside its range.
 *
 * A suspicion is a candidate, not a verdict: the sheet hands it to Daniel with its crop, its figure and a sentence, and he
 * confirms, dismisses or names it. What he dismisses is declared in `KNOWN_SUSPICIONS` (`planeSuspicions.test.ts`), which
 * the sheet lists apart as «esto es normal».
 */
import { Structure } from '@/simulator/anatomy/tissue';
import { edt } from '@/simulator/anatomy/volumeHeart';
import {
  VIEW_ALLOWED,
  VIEW_BACKGROUND,
  VIEW_PRESENCE_THRESHOLD,
} from '@/simulator/windows/viewWhitelist';
import { STRUCTURE_NAME } from './structureNames';

/** Sentinel of the structure grid beyond the sector. */
export const OUTSIDE_SECTOR = 255;

/** A drawn plane: the sector's structure per pixel, what lies behind the pleura, and the echo grey. */
export interface PlaneSample {
  W: number;
  H: number;
  pxPerCm: number;
  apexX: number;
  apexY: number;
  grid: Uint8Array;
  behind: Uint8Array;
  grey: Uint8Array;
}
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export type SuspicionKind = 'lista blanca' | 'brillo en sangre' | 'islas' | 'aparece' | 'espesor';
export interface Suspicion {
  kind: SuspicionKind;
  /** An invariant of the model broken (the white list), above a mechanical hint. */
  invariant: boolean;
  structure: Structure;
  figure: number;
  text: string;
  /** Where to look, in sector pixels. */
  box: Box;
}
export interface SuspicionOptions {
  /** The name of a structure as the sentences say it. */
  name?: (s: Structure) => string;
}

/** A cavity window brighter than this times the cavity's median far from the walls is suspect. */
export const BRIGHT_RATIO = 1.5;
/** And at least this many grey levels over it: a ratio over a near-black median is noise. */
export const BRIGHT_MIN_DIFF = 10;
/** Blood this far (mm) from any wall gives the cavity's own grey; windows this far from a wall are judged. */
export const FAR_FROM_WALL_MM = 6;
export const NEAR_WALL_MM = 3;
/** Side of the windows (mm), and how many adjacent windows make a suspicion: one alone is speckle. */
export const WINDOW_MM = 4;
export const WINDOWS_MIN = 2;
/** The cavities whose blood is judged. */
export const CAVITIES: readonly Structure[] = [
  Structure.LvCavity,
  Structure.LaCavity,
  Structure.RvCavity,
  Structure.RaCavity,
];
/** An island smaller than this (cm²) is a corner of the cut, not a piece. */
export const ISLAND_MIN_CM2 = 0.3;
/**
 * How many separate pieces of a structure one plane may show; one unless said otherwise. The atrial walls are
 * interrupted by their veins' mouths, the right ventricular wall is a crescent a plane may cut twice.
 */
export const ALLOWED_ISLANDS: Partial<Record<Structure, number>> = {
  [Structure.LaWall]: 2,
  [Structure.RaWall]: 2,
  [Structure.RvWall]: 2,
  [Structure.PapillaryMuscle]: 3,
  [Structure.RvPapillary]: 3,
  [Structure.PulmonaryVein]: 4,
  [Structure.MitralAnnulus]: 2,
  [Structure.TricuspidAnnulus]: 2,
  [Structure.ModeratorBand]: 2,
  [Structure.Pericardium]: 4,
  [Structure.EpicardialFat]: 8,
  [Structure.Rib]: 4,
};
/** Thin sheets and background: never islands, never counted as appearing. */
export const SHEETS = new Set<Structure>([
  Structure.MitralAnterior,
  Structure.MitralPosterior,
  Structure.AorticValve,
  Structure.TricuspidValve,
  Structure.PulmonaryValve,
  Structure.Chordae,
]);
/** A structure present over this share of the sector in one plane and under APPEAR_ABSENT in the next has appeared. */
export const APPEAR_PRESENT = 0.003;
export const APPEAR_ABSENT = 0.0003;
/**
 * In-plane thickness (mm) a wall may show at end-diastole, measured across it; wider than Daniel's figures (LV 8–11, atria
 * 1.5–2.5) because a plane cuts walls obliquely. At end-systole the ventricular walls may be THICKENING times as thick.
 */
export const WALL_RANGE_MM: Partial<Record<Structure, [number, number]>> = {
  [Structure.LvWallSeptal]: [6, 14],
  [Structure.LvWallLateral]: [6, 14],
  [Structure.LvWallAnterior]: [6, 14],
  [Structure.LvWallInferior]: [6, 14],
  [Structure.RvWall]: [2, 8],
  [Structure.LaWall]: [1, 4],
  [Structure.RaWall]: [1, 4],
  [Structure.InteratrialSeptum]: [1, 8],
};
export const THICKENING = 1.5;
/** A run of wall out of range shorter than this (mm) is a corner or a cut end. */
export const RUN_MIN_MM = 10;
/** The myocardium: a wall's thickness is measured to its faces (blood, outside), not to the next wall segment. */
export const MYOCARDIUM = new Set<Structure>([
  Structure.LvWallSeptal,
  Structure.LvWallLateral,
  Structure.LvWallAnterior,
  Structure.LvWallInferior,
  Structure.LvApex,
  Structure.RvWall,
  Structure.LaWall,
  Structure.RaWall,
  Structure.InteratrialSeptum,
]);
/** What the Rodero heart draws that the white lists of decision 325 do not name: its annuli, its apparatus, its vessels. */
export const RODERO_EXTRA = new Set<Structure>([
  Structure.MitralAnnulus,
  Structure.TricuspidAnnulus,
  Structure.RvPapillary,
  Structure.ModeratorBand,
  Structure.PulmonaryValve,
  Structure.AorticValve,
]);

const defaultName = (s: Structure): string => STRUCTURE_NAME[s] ?? `#${s}`;
const f1 = (x: number) => x.toFixed(1);

/** Depth (cm from the probe) and lateral offset (cm) of a pixel, as the sentences place things. */
export function where(ps: PlaneSample, x: number, y: number): string {
  const depth = Math.hypot(x - ps.apexX, y - ps.apexY) / ps.pxPerCm;
  const lat = (x - ps.apexX) / ps.pxPerCm;
  return `a ${f1(depth)} cm de profundidad, ${f1(Math.abs(lat))} cm a la ${lat < 0 ? 'izquierda' : 'derecha'}`;
}
const centre = (b: Box): [number, number] => [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
const union = (a: Box, b: Box): Box => ({
  x0: Math.min(a.x0, b.x0),
  y0: Math.min(a.y0, b.y0),
  x1: Math.max(a.x1, b.x1),
  y1: Math.max(a.y1, b.y1),
});

/** The share of the sector's pixels in front of the pleura each structure covers. */
export function visibleShares(ps: PlaneSample): Map<Structure, number> {
  const counts = new Map<Structure, number>();
  let inSector = 0;
  for (let p = 0; p < ps.W * ps.H; p++) {
    const s = ps.grid[p]!;
    if (s === OUTSIDE_SECTOR) continue;
    inSector++;
    if (ps.behind[p]) continue;
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  return new Map([...counts].map(([s, n]) => [s, n / inSector]));
}

/** The 4-connected pieces of one structure in front of the pleura, largest first, each with its box and pixel count. */
export function pieces(ps: PlaneSample, s: Structure): { n: number; box: Box }[] {
  const { W, H } = ps;
  const seen = new Uint8Array(W * H);
  const out: { n: number; box: Box }[] = [];
  const stack: number[] = [];
  for (let p0 = 0; p0 < W * H; p0++) {
    if (ps.grid[p0] !== s || ps.behind[p0] || seen[p0]) continue;
    let n = 0;
    const box: Box = { x0: W, y0: H, x1: 0, y1: 0 };
    stack.push(p0);
    seen[p0] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      n++;
      const x = p % W,
        y = (p - x) / W;
      box.x0 = Math.min(box.x0, x);
      box.x1 = Math.max(box.x1, x);
      box.y0 = Math.min(box.y0, y);
      box.y1 = Math.max(box.y1, y);
      const nb = [x > 0 ? p - 1 : -1, x + 1 < W ? p + 1 : -1, p - W, p + W];
      for (const q of nb) {
        if (q < 0 || q >= W * H || seen[q] || ps.grid[q] !== s || ps.behind[q]) continue;
        seen[q] = 1;
        stack.push(q);
      }
    }
    out.push({ n, box });
  }
  return out.sort((a, b) => b.n - a.n);
}

/** The distance (px) of each pixel of `mask` to the nearest pixel outside it (0 outside). */
function insideDistance(W: number, H: number, mask: Uint8Array): Float32Array {
  const d = edt([W, H, 1], (v) => !mask[v]);
  for (let p = 0; p < W * H; p++) if (!mask[p]) d[p] = 0;
  return d;
}

/** Windows of a cavity brighter than the cavity's own grey (one suspicion per cluster of windows, the brightest first). */
export function brightBlood(
  ps: PlaneSample,
  cavity: Structure,
  o: SuspicionOptions = {},
): Suspicion[] {
  const { W, H, pxPerCm } = ps;
  const name = o.name ?? defaultName;
  const mask = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p++) if (ps.grid[p] === cavity && !ps.behind[p]) mask[p] = 1;
  const d = insideDistance(W, H, mask);
  const far = (FAR_FROM_WALL_MM / 10) * pxPerCm,
    near = (NEAR_WALL_MM / 10) * pxPerCm;
  const farGreys: number[] = [];
  for (let p = 0; p < W * H; p++) if (mask[p] && d[p]! >= far) farGreys.push(ps.grey[p]!);
  if (farGreys.length < 300) return [];
  farGreys.sort((a, b) => a - b);
  const median = farGreys[farGreys.length >> 1]!;
  // windows of WINDOW_MM wholly in the cavity and off the walls
  const w = Math.max(3, Math.round((WINDOW_MM / 10) * pxPerCm));
  const bw = Math.floor(W / w),
    bh = Math.floor(H / w);
  const ratio = new Float32Array(bw * bh);
  const mean = new Float32Array(bw * bh);
  for (let by = 0; by < bh; by++)
    for (let bx = 0; bx < bw; bx++) {
      let ok = true,
        sum = 0;
      for (let y = by * w; y < (by + 1) * w && ok; y++)
        for (let x = bx * w; x < (bx + 1) * w; x++) {
          const p = y * W + x;
          if (!mask[p] || d[p]! < near) {
            ok = false;
            break;
          }
          sum += ps.grey[p]!;
        }
      if (!ok) continue;
      const m = sum / (w * w);
      mean[by * bw + bx] = m;
      ratio[by * bw + bx] = m >= median + BRIGHT_MIN_DIFF ? m / median : 0;
    }
  // clusters of flagged windows (8-connected)
  const seen = new Uint8Array(bw * bh);
  const out: Suspicion[] = [];
  for (let b0 = 0; b0 < bw * bh; b0++) {
    if (seen[b0] || ratio[b0]! <= BRIGHT_RATIO) continue;
    const stack = [b0];
    seen[b0] = 1;
    let best = b0,
      count = 0;
    let box: Box | null = null;
    while (stack.length) {
      const b = stack.pop()!;
      count++;
      if (ratio[b]! > ratio[best]!) best = b;
      const bx = b % bw,
        by = (b - bx) / bw;
      const bb: Box = { x0: bx * w, y0: by * w, x1: (bx + 1) * w - 1, y1: (by + 1) * w - 1 };
      box = box ? union(box, bb) : bb;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = bx + dx,
            ny = by + dy;
          if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
          const q = ny * bw + nx;
          if (!seen[q] && ratio[q]! > BRIGHT_RATIO) {
            seen[q] = 1;
            stack.push(q);
          }
        }
    }
    if (count < WINDOWS_MIN) continue;
    const [cx, cy] = centre(box!);
    out.push({
      kind: 'brillo en sangre',
      invariant: false,
      structure: cavity,
      figure: ratio[best]!,
      text: `${name(cavity)}: ${count} ventana${count > 1 ? 's' : ''} de ${WINDOW_MM} mm con gris ${mean[best]!.toFixed(0)} donde la cavidad lejos de la pared da ${median} (×${f1(ratio[best]!)}), ${where(ps, cx, cy)}`,
      box: box!,
    });
  }
  return out.sort((a, b) => b.figure - a.figure);
}

/** Structures cut into more pieces than one plane allows. */
export function islands(ps: PlaneSample, o: SuspicionOptions = {}): Suspicion[] {
  const name = o.name ?? defaultName;
  const minPx = ISLAND_MIN_CM2 * ps.pxPerCm * ps.pxPerCm;
  const out: Suspicion[] = [];
  for (const s of visibleShares(ps).keys()) {
    if (s === Structure.None || SHEETS.has(s) || VIEW_BACKGROUND.has(s)) continue;
    const big = pieces(ps, s).filter((p) => p.n >= minPx);
    const allowed = ALLOWED_ISLANDS[s] ?? 1;
    if (big.length <= allowed) continue;
    const box = big.slice(1).reduce((b, p) => union(b, p.box), big[1]!.box);
    const [cx, cy] = centre(box);
    out.push({
      kind: 'islas',
      invariant: false,
      structure: s,
      figure: big.length,
      text: `${name(s)} cortada en ${big.length} islas de ${big.map((p) => (p.n / (ps.pxPerCm * ps.pxPerCm)).toFixed(1)).join(', ')} cm² (${allowed} permitida${allowed > 1 ? 's' : ''}); las menores ${where(ps, cx, cy)}`,
      box: union(big[0]!.box, box),
    });
  }
  return out.sort((a, b) => b.figure - a.figure);
}

/** Structures present in one plane and absent in the other, `apart` degrees away. */
export function appearing(
  a: PlaneSample,
  b: PlaneSample,
  labels: [string, string],
  o: SuspicionOptions = {},
): Suspicion[] {
  const name = o.name ?? defaultName;
  const sa = visibleShares(a),
    sb = visibleShares(b);
  const out: Suspicion[] = [];
  for (const [here, there, ps, from, to] of [
    [sa, sb, a, labels[0], labels[1]],
    [sb, sa, b, labels[1], labels[0]],
  ] as const)
    for (const [s, share] of here) {
      if (s === Structure.None || SHEETS.has(s) || VIEW_BACKGROUND.has(s)) continue;
      if (share < APPEAR_PRESENT || (there.get(s) ?? 0) >= APPEAR_ABSENT) continue;
      const box = pieces(ps, s)[0]!.box;
      const [cx, cy] = centre(box);
      out.push({
        kind: 'aparece',
        invariant: false,
        structure: s,
        figure: 100 * share,
        text: `${name(s)} ocupa el ${(100 * share).toFixed(2)} % del sector en ${from} y no está en ${to}, ${where(ps, cx, cy)}`,
        box,
      });
    }
  return out.sort((a, b) => b.figure - a.figure);
}

/** Labels outside the view's white list (decision 325), extended with `extra`. */
export function offWhitelist(
  ps: PlaneSample,
  viewId: string,
  extra: ReadonlySet<Structure> = new Set(),
  o: SuspicionOptions = {},
): Suspicion[] {
  const name = o.name ?? defaultName;
  const allowed = new Set(VIEW_ALLOWED[viewId] ?? []);
  const out: Suspicion[] = [];
  for (const [s, share] of visibleShares(ps)) {
    if (share < VIEW_PRESENCE_THRESHOLD || VIEW_BACKGROUND.has(s) || allowed.has(s) || extra.has(s))
      continue;
    const box = pieces(ps, s)[0]!.box;
    const [cx, cy] = centre(box);
    out.push({
      kind: 'lista blanca',
      invariant: true,
      structure: s,
      figure: 100 * share,
      text: `${name(s)} ocupa el ${(100 * share).toFixed(2)} % del sector de ${viewId}, que no la lista, ${where(ps, cx, cy)}`,
      box,
    });
  }
  return out.sort((a, b) => b.figure - a.figure);
}

/**
 * Runs of a wall whose in-plane thickness, measured across it (twice the distance from its middle to its border), lies
 * outside its range over at least RUN_MIN_MM.
 */
export function wallThickness(
  ps: PlaneSample,
  wall: Structure,
  systolic: boolean,
  o: SuspicionOptions = {},
): Suspicion[] {
  const range = WALL_RANGE_MM[wall];
  if (!range) return [];
  const name = o.name ?? defaultName;
  const { W, H, pxPerCm } = ps;
  const [lo, hi0] = range;
  const hi = systolic ? hi0 * THICKENING : hi0;
  // the distance of each myocardial pixel to a face of the myocardium (blood, outside: not the next wall segment), and
  // to the sector's edge or the pleura, beyond which the wall is unknown: a middle pixel nearer to those than to a face
  // is not measured
  const myo = new Uint8Array(W * H);
  const known = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p++) {
    if (MYOCARDIUM.has(ps.grid[p]!)) myo[p] = 1;
    if (ps.grid[p] !== OUTSIDE_SECTOR && !ps.behind[p]) known[p] = 1;
  }
  const d = insideDistance(W, H, myo);
  const dEdge = insideDistance(W, H, known);
  const mask = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p++) if (ps.grid[p] === wall && !ps.behind[p]) mask[p] = 1;
  const mmPerPx = 10 / pxPerCm;
  // the middle of the wall: pixels no nearer the border than their neighbours; their thickness across
  const thick = new Float32Array(W * H);
  const flagged = new Uint8Array(W * H);
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const p = y * W + x;
      if (!mask[p]) continue;
      const dp = d[p]!;
      if (dp < d[p - 1]! || dp < d[p + 1]! || dp < d[p - W]! || dp < d[p + W]!) continue;
      // a truncated wall's middle lies as near the edge as the face it has (one pixel of rounding either way)
      if (dEdge[p]! <= dp + 1) continue;
      const t = (2 * dp - 1) * mmPerPx;
      thick[p] = t;
      if (t < lo || t > hi) flagged[p] = 1;
    }
  // clusters of flagged middle pixels within 3 px of each other
  const seen = new Uint8Array(W * H);
  const out: Suspicion[] = [];
  for (let p0 = 0; p0 < W * H; p0++) {
    if (!flagged[p0] || seen[p0]) continue;
    const stack = [p0];
    seen[p0] = 1;
    const ts: number[] = [];
    let box: Box = { x0: W, y0: H, x1: 0, y1: 0 };
    while (stack.length) {
      const p = stack.pop()!;
      ts.push(thick[p]!);
      const x = p % W,
        y = (p - x) / W;
      box = union(box, { x0: x, y0: y, x1: x, y1: y });
      for (let dy = -3; dy <= 3; dy++)
        for (let dx = -3; dx <= 3; dx++) {
          const nx = x + dx,
            ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const q = ny * W + nx;
          if (flagged[q] && !seen[q]) {
            seen[q] = 1;
            stack.push(q);
          }
        }
    }
    const lengthMm = Math.hypot(box.x1 - box.x0, box.y1 - box.y0) * mmPerPx;
    if (lengthMm < RUN_MIN_MM) continue;
    ts.sort((a, b) => a - b);
    const median = ts[ts.length >> 1]!;
    const [cx, cy] = centre(box);
    out.push({
      kind: 'espesor',
      invariant: false,
      structure: wall,
      figure: median,
      text: `${name(wall)} de ${f1(median)} mm a través (rango ${lo}–${Number.isInteger(hi) ? hi : f1(hi)}${systolic ? ' en sístole' : ''}) a lo largo de ${f1(lengthMm)} mm, ${where(ps, cx, cy)}`,
      box,
    });
  }
  return out.sort(
    (a, b) =>
      Math.hypot(b.box.x1 - b.box.x0, b.box.y1 - b.box.y0) -
      Math.hypot(a.box.x1 - a.box.x0, a.box.y1 - a.box.y0),
  );
}

/** The order of the mechanical hints on a sheet: what Daniel has marked by eye before (brightness inside a cavity) first. */
export const KIND_ORDER: readonly SuspicionKind[] = [
  'lista blanca',
  'brillo en sangre',
  'aparece',
  'islas',
  'espesor',
];
/** The order of a sheet: invariants first, then by kind, then by figure. */
export function compareSuspicions(a: Suspicion, b: Suspicion): number {
  if (a.invariant !== b.invariant) return a.invariant ? -1 : 1;
  if (a.kind !== b.kind) return KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
  return b.figure - a.figure;
}
