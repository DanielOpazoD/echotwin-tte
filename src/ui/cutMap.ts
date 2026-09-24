import type { Structure } from '@/simulator/anatomy/tissue';
import { CUT_MAP_LABELS, STRUCTURE_RGB, type Rgb } from '@/simulator/anatomy/structurePalette';
import type { SectorMapping } from '@/simulator/renderer/scanConvert';

/**
 * The cut map: the structures the imaging plane passes through, drawn as a colour-coded sector from the
 * frame's own polar structure map (`SimOutput.structure`), so it is the plane of the image by construction —
 * same beam, same phase, same sector, same left–right convention — and never a second plane (decision 141).
 * Pure functions; `CutMapView` puts them on a canvas.
 */
export interface PolarGeometry {
  lines: number;
  samples: number;
  sectorRad: number;
  depthCm: number;
}

/** Sector background: soft tissue the model does not name. Outside the sector the canvas shows its own colour. */
const NONE_RGB: Rgb = [46, 50, 60];
/** The panel behind the map: the outlines and the muted palette lean towards it. */
const INK_RGB: Rgb = [10, 13, 18];
/** The interface's accent (`--accent`): the outline of the structure under the pointer. */
export const ACCENT_RGB: Rgb = [92, 200, 255];

/**
 * The cut map's own palette (decision 202): the shared structure colours, a quarter less saturated and leaning a
 * little towards the panel, so the map reads as a drawing of the interface and not as a poster beside the image.
 * The offline slice maps keep the full colours.
 */
export const CUT_MAP_RGB: Partial<Record<Structure, Rgb>> = Object.fromEntries(
  Object.entries(STRUCTURE_RGB).map(([k, c]) => [k, muted(c)]),
);

function muted([r, g, b]: Rgb): Rgb {
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  const mix = (v: number, ink: number) => Math.round((v * 0.75 + lum * 0.25) * 0.88 + ink * 0.12);
  return [mix(r, INK_RGB[0]), mix(g, INK_RGB[1]), mix(b, INK_RGB[2])];
}

/** Polar index of the sample nearest to each pixel (−1 outside the sector). */
export function nearestSampleLut(p: PolarGeometry, m: SectorMapping): Int32Array {
  const lut = new Int32Array(m.width * m.height).fill(-1);
  const half = p.sectorRad / 2;
  const invPx = 1 / m.pxPerCm;
  const tanHalf = Math.tan(half);
  for (let y = 0; y < m.height; y++) {
    const dy = y + 0.5 - m.apexY;
    if (dy < 0) continue;
    const xLimit = dy * tanHalf;
    for (let x = 0; x < m.width; x++) {
      let dx = x + 0.5 - m.apexX;
      if (m.invertLR) dx = -dx;
      if (dx > xLimit || dx < -xLimit) continue;
      const r = Math.sqrt(dx * dx + dy * dy) * invPx;
      if (r > p.depthCm) continue;
      const th = Math.atan2(dx, dy);
      if (th < -half || th > half) continue;
      const li = Math.min(
        p.lines - 1,
        Math.max(0, Math.round(((th + half) / p.sectorRad) * p.lines - 0.5)),
      );
      const si = Math.min(
        p.samples - 1,
        Math.max(0, Math.round((r / p.depthCm) * p.samples - 0.5)),
      );
      lut[y * m.width + x] = li * p.samples + si;
    }
  }
  return lut;
}

export interface RegionStat {
  id: Structure;
  count: number;
  /** Pixel centroid of the region. */
  cx: number;
  cy: number;
  /** Vertical extent of the region (rows). */
  minY: number;
  maxY: number;
}

/**
 * Paints the structure colours into `rgba` (w×h, premultiplied nothing) and returns the regions found. A thin dark
 * outline separates neighbouring structures, and the structure under the pointer (`hovered`) is lit and outlined in
 * the accent (decision 202).
 */
export function paintCutMap(
  rgba: Uint8ClampedArray,
  lut: Int32Array,
  structure: Uint8Array,
  width: number,
  hovered: number | null = null,
): RegionStat[] {
  const n = lut.length;
  const ids = new Uint8Array(n);
  const count = new Float64Array(256);
  const sx = new Float64Array(256);
  const sy = new Float64Array(256);
  const minY = new Int32Array(256).fill(0x7fffffff);
  const maxY = new Int32Array(256).fill(-1);
  for (let i = 0; i < n; i++) {
    const k = lut[i]!;
    const o = i * 4;
    if (k < 0) {
      rgba[o + 3] = 0;
      continue;
    }
    const id: Structure = structure[k] ?? 0;
    ids[i] = id;
    const c = CUT_MAP_RGB[id] ?? NONE_RGB;
    const lit = hovered !== null && id === hovered;
    rgba[o] = lit ? c[0] + (255 - c[0]) * 0.28 : c[0];
    rgba[o + 1] = lit ? c[1] + (255 - c[1]) * 0.28 : c[1];
    rgba[o + 2] = lit ? c[2] + (255 - c[2]) * 0.28 : c[2];
    rgba[o + 3] = 255;
    const y = (i / width) | 0;
    count[id]! += 1;
    sx[id]! += i % width;
    sy[id]! += y;
    if (y < minY[id]!) minY[id] = y;
    if (y > maxY[id]!) maxY[id] = y;
  }
  // outlines: a pixel whose right or lower neighbour belongs to another structure darkens; beside the hovered one it
  // takes the accent
  for (let i = 0; i < n; i++) {
    if (lut[i]! < 0) continue;
    const id = ids[i]!;
    const right = i % width < width - 1 && lut[i + 1]! >= 0 ? ids[i + 1]! : id;
    const below = i + width < n && lut[i + width]! >= 0 ? ids[i + width]! : id;
    if (right === id && below === id) continue;
    const o = i * 4;
    if (hovered !== null && (id === hovered || right === hovered || below === hovered)) {
      rgba[o] = ACCENT_RGB[0];
      rgba[o + 1] = ACCENT_RGB[1];
      rgba[o + 2] = ACCENT_RGB[2];
    } else {
      rgba[o] = rgba[o]! * 0.45 + INK_RGB[0] * 0.55;
      rgba[o + 1] = rgba[o + 1]! * 0.45 + INK_RGB[1] * 0.55;
      rgba[o + 2] = rgba[o + 2]! * 0.45 + INK_RGB[2] * 0.55;
    }
  }
  const stats: RegionStat[] = [];
  for (let id = 1; id < 256; id++) {
    const c = count[id]!;
    if (c > 0)
      stats.push({
        id,
        count: c,
        cx: sx[id]! / c,
        cy: sy[id]! / c,
        minY: minY[id]!,
        maxY: maxY[id]!,
      });
  }
  return stats;
}

export interface CutMapLabel {
  id: Structure;
  text: string;
  x: number;
  y: number;
}

/**
 * Labels of the regions large enough to name, each on a pixel of its own region (the centroid of a curved
 * wall falls in the cavity), largest first, and none over another label: a label that would cover one
 * already placed slides along its region (a third of the region's height up or down) before giving up.
 * Regions labelled last time keep their label down to half the size threshold, so a wall that breathes
 * around the threshold does not blink. `ids` is the per-sample id the regions were counted on (the structure map, or
 * the LV segments of `segmentMap.ts`) and `labelOf` names an id (the structure's short name by default).
 */
export function placeLabels(
  stats: RegionStat[],
  lut: Int32Array,
  ids: Uint8Array,
  width: number,
  minPixels: number,
  measure: (text: string) => { w: number; h: number },
  keep: ReadonlySet<number> = new Set(),
  labelOf: (id: Structure) => string | undefined = (id) => CUT_MAP_LABELS[id],
): CutMapLabel[] {
  const wanted = stats
    .filter(
      (s) => s.count >= (keep.has(s.id) ? minPixels / 2 : minPixels) && labelOf(s.id) !== undefined,
    )
    .sort((a, b) => b.count - a.count);
  if (!wanted.length) return [];
  // one pass over the map: for every wanted region, the pixels nearest to its centroid and to the centroid
  // shifted a third of the region's height up and down (the fallbacks when the first spot is taken)
  const anchors = new Map<number, { ax: number; ay: number; d: number; x: number; y: number }[]>();
  for (const s of wanted) {
    const dy = (s.maxY - s.minY) / 3;
    anchors.set(
      s.id,
      [0, -dy, dy].map((o) => ({ ax: s.cx, ay: s.cy + o, d: Infinity, x: s.cx, y: s.cy + o })),
    );
  }
  const n = lut.length;
  for (let i = 0; i < n; i++) {
    const k = lut[i]!;
    if (k < 0) continue;
    const list = anchors.get(ids[k] ?? 0);
    if (!list) continue;
    const x = i % width,
      y = (i / width) | 0;
    for (const a of list) {
      const d = (x - a.ax) ** 2 + (y - a.ay) ** 2;
      if (d < a.d) {
        a.d = d;
        a.x = x;
        a.y = y;
      }
    }
  }
  const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
  const out: CutMapLabel[] = [];
  for (const s of wanted) {
    const text = labelOf(s.id)!;
    const { w, h } = measure(text);
    for (const a of anchors.get(s.id)!) {
      const box = {
        x0: a.x - w / 2 - 2,
        y0: a.y - h / 2 - 1,
        x1: a.x + w / 2 + 2,
        y1: a.y + h / 2 + 1,
      };
      if (placed.some((p) => box.x0 < p.x1 && box.x1 > p.x0 && box.y0 < p.y1 && box.y1 > p.y0))
        continue;
      placed.push(box);
      out.push({ id: s.id, text, x: a.x, y: a.y });
      break;
    }
  }
  return out;
}

/**
 * The labels to draw, in their order of priority, without any that would cover one already kept (decision 188).
 * `placeLabels` keeps each frame free of overlaps, but the labels are drawn at their mean place over one beat
 * (decision 181), and two that never met in one frame can land on each other once averaged. The later one is dropped.
 */
export function withoutOverlaps<T extends { text: string; x: number; y: number }>(
  labels: readonly T[],
  measure: (text: string) => { w: number; h: number },
): T[] {
  const kept: T[] = [];
  const boxes: { x0: number; y0: number; x1: number; y1: number }[] = [];
  for (const l of labels) {
    const { w, h } = measure(l.text);
    const box = {
      x0: l.x - w / 2 - 2,
      y0: l.y - h / 2 - 1,
      x1: l.x + w / 2 + 2,
      y1: l.y + h / 2 + 1,
    };
    if (boxes.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0))
      continue;
    boxes.push(box);
    kept.push(l);
  }
  return kept;
}

/**
 * The outline of one structure of the frame on a transparent layer the image overlay draws (decision 202): the
 * pixels of `id` that touch another structure, the outside of the sector or the sector's edge, two pixels wide.
 */
export function paintStructureOutline(
  rgba: Uint8ClampedArray,
  lut: Int32Array,
  structure: Uint8Array,
  width: number,
  id: number,
  rgb: Rgb = ACCENT_RGB,
): number {
  const n = lut.length;
  // whether each pixel belongs to the structure, once; then the edges in one pass
  const mine = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (lut[i]! >= 0 && (structure[lut[i]!] ?? 0) === id) mine[i] = 1;
  const paint = (j: number) => {
    const o = j * 4;
    rgba[o] = rgb[0];
    rgba[o + 1] = rgb[1];
    rgba[o + 2] = rgb[2];
    rgba[o + 3] = 235;
  };
  let drawn = 0;
  for (let i = 0; i < n; i++) {
    if (!mine[i]) continue;
    const x = i % width;
    const left = x > 0 && mine[i - 1] === 1;
    const right = x < width - 1 && mine[i + 1] === 1;
    const up = i >= width && mine[i - width] === 1;
    const down = i + width < n && mine[i + width] === 1;
    if (left && right && up && down) continue;
    paint(i);
    if (x > 0) paint(i - 1);
    if (x < width - 1) paint(i + 1);
    if (i >= width) paint(i - width);
    if (i + width < n) paint(i + width);
    drawn++;
  }
  return drawn;
}
