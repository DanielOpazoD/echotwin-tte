import { aha17Info, type SegmentWall } from '@/clinical/segmentation/catalog';
import { aha17FromCode, lv16FromCode } from '@/simulator/anatomy/lvSegments';
import { STRUCTURE_RGB, type Rgb } from '@/simulator/anatomy/structurePalette';
import type { RegionStat } from './cutMap';

/**
 * The LV segments on the cut map and the polar map (decision 152). The ids come from the frame's segment channel — the
 * tissue the plane crosses — read in the model the learner picks: the anatomical AHA 17 (the cap is 17) or the
 * 16-segment wall-motion model (the cap belongs to the apical segment of its quadrant). Colour codes the wall (hue) and
 * the level (lightness, basal darkest); the number and the name always go with it, never the colour alone.
 */
export type SegmentModelChoice = 'LV_AHA17' | 'LV_16';

const WALL_HUE: Record<SegmentWall, number> = {
  anterior: 212,
  anteroseptal: 178,
  inferoseptal: 128,
  inferior: 44,
  inferolateral: 14,
  anterolateral: 284,
  septal: 150,
  lateral: 330,
  apex: 0,
};
const LEVEL_LIGHTNESS = { basal: 0.4, mid: 0.54, apical: 0.68, cap: 0.86 } as const;

function hslToRgb(h: number, s: number, l: number): Rgb {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

/** Colour of each AHA segment (index = id; 0 unused). */
export const SEGMENT_RGB: readonly Rgb[] = [
  [0, 0, 0],
  ...Array.from({ length: 17 }, (_, i) => {
    const s = aha17Info(i + 1)!;
    return hslToRgb(WALL_HUE[s.wall], s.level === 'cap' ? 0 : 0.62, LEVEL_LIGHTNESS[s.level]);
  }),
];

export const segmentCss = (id: number): string => {
  const c = SEGMENT_RGB[id] ?? [120, 120, 120];
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
};

/** The id of a segment code of the frame in the chosen model (0 when not LV compact myocardium). */
export function segmentIdOf(code: number, model: SegmentModelChoice): number {
  return model === 'LV_AHA17' ? aha17FromCode(code) : lv16FromCode(code);
}

/** Per-sample ids of a frame's segment codes in a model (reuses `out` when it has the size). */
export function segmentIds(
  codes: Uint8Array,
  model: SegmentModelChoice,
  out?: Uint8Array,
): Uint8Array {
  const ids = out && out.length === codes.length ? out : new Uint8Array(codes.length);
  for (let i = 0; i < codes.length; i++) ids[i] = segmentIdOf(codes[i]!, model);
  return ids;
}

/** Spanish and English names of a segment in a model: the 16-segment apical segments reach the apex. */
export function segmentNames(id: number, model: SegmentModelChoice): { es: string; en: string } {
  const s = aha17Info(id);
  if (!s) return { es: '', en: '' };
  if (model === 'LV_16' && s.level === 'apical')
    return { es: `${s.nameEs} (incluye el ápex)`, en: `${s.nameEn} (includes the apex)` };
  return { es: s.nameEs, en: s.nameEn };
}

/** Background of the sector where the model names nothing (as in `paintCutMap`). */
const NONE_RGB: Rgb = [46, 50, 60];
/** Other structures fade this much toward the background, so the segments stand out. */
const STRUCTURE_FADE = 0.6;
/** Segments other than the selected one fade this much when one is selected. */
const UNSELECTED_FADE = 0.55;

const mix = (c: Rgb, to: Rgb, t: number): Rgb => [
  c[0] + (to[0] - c[0]) * t,
  c[1] + (to[1] - c[1]) * t,
  c[2] + (to[2] - c[2]) * t,
];

/**
 * Paints the segments of the plane (per-sample ids in a model) over the faded structure map, outlines the selected one
 * in white, and returns the region of each segment for its label.
 */
export function paintSegmentMap(
  rgba: Uint8ClampedArray,
  lut: Int32Array,
  structure: Uint8Array,
  ids: Uint8Array,
  width: number,
  selected: number | null,
  hovered: number | null = null,
): RegionStat[] {
  const n = lut.length;
  const count = new Float64Array(18);
  const sx = new Float64Array(18);
  const sy = new Float64Array(18);
  const minY = new Int32Array(18).fill(0x7fffffff);
  const maxY = new Int32Array(18).fill(-1);
  for (let i = 0; i < n; i++) {
    const k = lut[i]!;
    const o = i * 4;
    if (k < 0) {
      rgba[o + 3] = 0;
      continue;
    }
    const id = ids[k] ?? 0;
    let c: Rgb;
    if (id > 0 && id <= 17) {
      c = SEGMENT_RGB[id]!;
      if (selected !== null && id !== selected) c = mix(c, NONE_RGB, UNSELECTED_FADE);
      const y = (i / width) | 0;
      count[id]! += 1;
      sx[id]! += i % width;
      sy[id]! += y;
      if (y < minY[id]!) minY[id] = y;
      if (y > maxY[id]!) maxY[id] = y;
    } else c = mix(STRUCTURE_RGB[structure[k] as never] ?? NONE_RGB, NONE_RGB, STRUCTURE_FADE);
    rgba[o] = c[0];
    rgba[o + 1] = c[1];
    rgba[o + 2] = c[2];
    rgba[o + 3] = 255;
  }
  // outlines: pixels of the selected segment (white) or of the one under the pointer (accent) with a neighbour outside it
  const outline = (target: number, rgb: Rgb): void => {
    if (count[target]! <= 0) return;
    const h = n / width;
    const isIn = (x: number, y: number): boolean => {
      if (x < 0 || y < 0 || x >= width || y >= h) return false;
      const k = lut[y * width + x]!;
      return k >= 0 && ids[k] === target;
    };
    for (let y = 0; y < h; y++)
      for (let x = 0; x < width; x++) {
        if (!isIn(x, y)) continue;
        if (isIn(x - 1, y) && isIn(x + 1, y) && isIn(x, y - 1) && isIn(x, y + 1)) continue;
        const o = (y * width + x) * 4;
        rgba[o] = rgb[0];
        rgba[o + 1] = rgb[1];
        rgba[o + 2] = rgb[2];
      }
  };
  if (hovered !== null && hovered !== selected) outline(hovered, [92, 200, 255]);
  if (selected !== null) outline(selected, [255, 255, 255]);
  const stats: RegionStat[] = [];
  for (let id = 1; id <= 17; id++) {
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

/**
 * Translucent segment layer over the ultrasound image (decision 153). The myocardium keeps its echo: each segment is a
 * light wash of its colour, the boundaries between two segments a stronger line, and the selected or hovered segment
 * a stronger wash with a white outline. The border of the myocardium itself is left to the image, since reading it is
 * the learner's task. Returns the region of each segment for its number.
 */
export function paintSegmentOverlay(
  rgba: Uint8ClampedArray,
  lut: Int32Array,
  ids: Uint8Array,
  width: number,
  selected: number | null,
  hovered: number | null,
): RegionStat[] {
  const n = lut.length;
  const h = n / width;
  const idAt = (i: number): number => {
    const k = lut[i]!;
    return k >= 0 ? (ids[k] ?? 0) : 0;
  };
  const count = new Float64Array(18);
  const sx = new Float64Array(18);
  const sy = new Float64Array(18);
  const minY = new Int32Array(18).fill(0x7fffffff);
  const maxY = new Int32Array(18).fill(-1);
  const focus = selected ?? hovered;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const id = idAt(i);
    if (id <= 0 || id > 17) {
      rgba[o + 3] = 0;
      continue;
    }
    const x = i % width,
      y = (i / width) | 0;
    count[id]! += 1;
    sx[id]! += x;
    sy[id]! += y;
    if (y < minY[id]!) minY[id] = y;
    if (y > maxY[id]!) maxY[id] = y;
    const c = SEGMENT_RGB[id]!;
    // neighbours: a different segment is a segment boundary; the edge of the emphasised segment is its outline
    // the four neighbours (a pixel at the image edge counts its missing neighbour as itself)
    const l = x > 0 ? idAt(i - 1) : id,
      r = x < width - 1 ? idAt(i + 1) : id,
      u = y > 0 ? idAt(i - width) : id,
      d = y < h - 1 ? idAt(i + width) : id;
    const differs = l !== id || r !== id || u !== id || d !== id;
    const boundary =
      differs &&
      ((l !== id && l > 0) || (r !== id && r > 0) || (u !== id && u > 0) || (d !== id && d > 0));
    const edge = differs && (id === focus || id === hovered);
    if (edge) {
      rgba[o] = 255;
      rgba[o + 1] = 255;
      rgba[o + 2] = 255;
      rgba[o + 3] = 230;
      continue;
    }
    rgba[o] = c[0];
    rgba[o + 1] = c[1];
    rgba[o + 2] = c[2];
    const strong = id === hovered || id === selected;
    const faded = selected !== null && id !== selected && id !== hovered;
    rgba[o + 3] = boundary ? 200 : strong ? 120 : faded ? 34 : 78;
  }
  const stats: RegionStat[] = [];
  for (let id = 1; id <= 17; id++) {
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

/** Polar sample index (line-major) under a pixel of a sector mapping, or −1 outside the sector. */
export function sampleIndexAt(
  polar: { lines: number; samples: number; sectorRad: number; depthCm: number },
  m: { apexX: number; apexY: number; pxPerCm: number; invertLR: boolean },
  px: number,
  py: number,
): number {
  let dx = px - m.apexX;
  if (m.invertLR) dx = -dx;
  const dy = py - m.apexY;
  if (dy < 0) return -1;
  const r = Math.hypot(dx, dy) / m.pxPerCm;
  const th = Math.atan2(dx, dy);
  const half = polar.sectorRad / 2;
  if (r > polar.depthCm || th < -half || th > half) return -1;
  const li = Math.min(
    polar.lines - 1,
    Math.max(0, Math.round(((th + half) / polar.sectorRad) * polar.lines - 0.5)),
  );
  const si = Math.min(
    polar.samples - 1,
    Math.max(0, Math.round((r / polar.depthCm) * polar.samples - 0.5)),
  );
  return li * polar.samples + si;
}
