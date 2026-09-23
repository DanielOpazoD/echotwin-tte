import { aha17Info } from '@/clinical/segmentation/catalog';
import type { CutMapLabel, RegionStat } from './cutMap';

/**
 * Where the numbers of the LV segments and the RV insertions sit on the image (decision 181).
 *
 * The numbers used to be re-placed three times a second on the pixel of each segment nearest its centroid, so they
 * followed the wall through the beat. Now, while the probe, the sector geometry and the segment model stay the same,
 * each number is the mean of its places over one beat (a frozen image settles at once) and then holds still. Moving
 * the probe or changing the depth, the zoom or the model starts again.
 *
 * The RV insertions are the anatomical landmarks that bound the septum (ASE/EACVI 2015): the numbering of a short-axis
 * cut is checked against them, not against a clock position, which depends on the window. And the rotation between the
 * image and the polar map (drawn, by convention, with the anterior wall up) says which part of the map the top of the
 * image shows.
 */
export interface Point {
  x: number;
  y: number;
}
export interface RvInsertions {
  anterior: Point;
  inferior: Point;
}

/** Boundary pairs whose outer end is an RV insertion: anteroseptal | anterior and inferoseptal | inferior. */
const ANTERIOR_PAIRS: readonly (readonly [number, number])[] = [
  [8, 7],
  [2, 1],
];
const INFERIOR_PAIRS: readonly (readonly [number, number])[] = [
  [9, 10],
  [3, 4],
];

const pairOf = (a: number, b: number, pairs: readonly (readonly [number, number])[]): boolean =>
  pairs.some(([p, q]) => (a === p && b === q) || (a === q && b === p));

/**
 * The RV insertions on a short-axis cut: the outer end — farthest from the centre of the numbered myocardium — of the
 * boundary between the anteroseptal and anterior segments and of the one between the inferoseptal and inferior
 * segments, at the mid or basal level. Null unless both boundaries are in the frame: a long-axis cut crosses the
 * septum away from the insertions. `lut` maps a pixel to its polar sample and `ids` a sample to its segment.
 */
export function rvInsertionPoints(
  lut: Int32Array,
  ids: Uint8Array,
  width: number,
  stats: readonly RegionStat[],
): RvInsertions | null {
  let n = 0,
    cx = 0,
    cy = 0;
  for (const s of stats)
    if (s.id >= 1 && s.id <= 12) {
      cx += s.cx * s.count;
      cy += s.cy * s.count;
      n += s.count;
    }
  if (!n) return null;
  cx /= n;
  cy /= n;
  const best = { a: -1, ax: 0, ay: 0, i: -1, ix: 0, iy: 0 };
  const h = lut.length / width;
  const idAt = (i: number): number => {
    const k = lut[i]!;
    return k >= 0 ? (ids[k] ?? 0) : 0;
  };
  for (let i = 0; i < lut.length; i++) {
    const a = idAt(i);
    if (!a || a > 10) continue;
    const x = i % width,
      y = (i / width) | 0;
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
    ] as const) {
      if (x + dx >= width || y + dy >= h) continue;
      const b = idAt(i + dx + dy * width);
      if (!b || b === a) continue;
      const px = x + dx / 2,
        py = y + dy / 2;
      const d = (px - cx) ** 2 + (py - cy) ** 2;
      if (pairOf(a, b, ANTERIOR_PAIRS) && d > best.a) {
        best.a = d;
        best.ax = px;
        best.ay = py;
      } else if (pairOf(a, b, INFERIOR_PAIRS) && d > best.i) {
        best.i = d;
        best.ix = px;
        best.iy = py;
      }
    }
  }
  if (best.a < 0 || best.i < 0) return null;
  return { anterior: { x: best.ax, y: best.ay }, inferior: { x: best.ix, y: best.iy } };
}

const RINGS: readonly (readonly number[])[] = [
  [1, 2, 3, 4, 5, 6],
  [7, 8, 9, 10, 11, 12],
  [13, 14, 15, 16],
];
/** Largest residual (degrees) of the rotation that matches the numbers of the image with those of the polar map. */
const MAX_RESIDUAL_DEG = 25;

const wrap180 = (d: number): number => ((((d + 180) % 360) + 360) % 360) - 180;

/**
 * The angle of the polar map — degrees from its top (anterior), counter-clockwise toward the septum, as the map draws
 * its segments — that the top of the image shows, for a short-axis cut numbered around a ring: the rotation that best
 * matches where the numbers sit around their centre with where the map puts them. Null when fewer than four numbers of
 * one ring (three at the apex) are placed, or when no rotation fits them within 25° (a long-axis cut, or a mirrored
 * image, whose order around the ring is reversed).
 */
export function imageUpOnPolarMap(
  labels: readonly { id: number; x: number; y: number }[],
): number | null {
  let ring: { id: number; x: number; y: number }[] = [];
  for (const r of RINGS) {
    const on = labels.filter((l) => r.includes(l.id));
    if (on.length > ring.length) ring = on;
  }
  const need = ring.length && ring[0]!.id >= 13 ? 3 : 4;
  if (ring.length < need) return null;
  const cx = ring.reduce((a, l) => a + l.x, 0) / ring.length;
  const cy = ring.reduce((a, l) => a + l.y, 0) / ring.length;
  const diffs = ring.map((l) => {
    const phi = (Math.atan2(-(l.x - cx), -(l.y - cy)) * 180) / Math.PI;
    return wrap180(phi - aha17Info(l.id)!.polarCentreDeg!);
  });
  let sx = 0,
    sy = 0;
  for (const d of diffs) {
    sx += Math.cos((d * Math.PI) / 180);
    sy += Math.sin((d * Math.PI) / 180);
  }
  const delta = (Math.atan2(sy, sx) * 180) / Math.PI;
  if (diffs.some((d) => Math.abs(wrap180(d - delta)) > MAX_RESIDUAL_DEG)) return null;
  return ((-delta % 360) + 360) % 360;
}

/** Numbers and RV insertions of the current layout, and whether they already hold still. */
export interface SegmentAnchorsView {
  labels: CutMapLabel[];
  insertions: RvInsertions | null;
  settled: boolean;
}

/**
 * Accumulates the places of the labels — segment numbers, or the structure names of the cut map — and of the
 * insertions over one beat of an unchanged layout, then holds them. `layoutKey` names what may not change (probe,
 * sector geometry, model); a new key starts again.
 */
export class SegmentAnchors {
  private key = '';
  private lastFrame = Number.NaN;
  private startS = 0;
  private frames = 0;
  private sums = new Map<number, { sx: number; sy: number; n: number; text: string }>();
  private ins = { ax: 0, ay: 0, ix: 0, iy: 0, n: 0 };
  private done = false;

  /** Whether the frame still adds to the layout: a new layout, or a new frame of one that has not settled. */
  wants(layoutKey: string, frameId: number): boolean {
    return layoutKey !== this.key || (!this.done && frameId !== this.lastFrame);
  }

  add(
    layoutKey: string,
    frame: { frameId: number; timeS: number; rrS: number; frozen: boolean },
    labels: readonly CutMapLabel[],
    insertions: RvInsertions | null,
  ): void {
    if (layoutKey !== this.key) {
      this.key = layoutKey;
      this.lastFrame = Number.NaN;
      this.startS = frame.timeS;
      this.frames = 0;
      this.sums.clear();
      this.ins = { ax: 0, ay: 0, ix: 0, iy: 0, n: 0 };
      this.done = false;
    }
    if (this.done || frame.frameId === this.lastFrame) return;
    this.lastFrame = frame.frameId;
    this.frames++;
    for (const l of labels) {
      const s = this.sums.get(l.id) ?? { sx: 0, sy: 0, n: 0, text: l.text };
      s.sx += l.x;
      s.sy += l.y;
      s.n++;
      this.sums.set(l.id, s);
    }
    if (insertions) {
      this.ins.ax += insertions.anterior.x;
      this.ins.ay += insertions.anterior.y;
      this.ins.ix += insertions.inferior.x;
      this.ins.iy += insertions.inferior.y;
      this.ins.n++;
    }
    // one beat measured, or a still image: the places hold from here on
    if (frame.frozen || frame.timeS - this.startS >= frame.rrS) this.done = true;
  }

  /** The numbers placed in at least half of the frames, at their mean place; the insertions likewise. */
  view(): SegmentAnchorsView {
    const labels: CutMapLabel[] = [];
    for (const [id, s] of this.sums)
      if (2 * s.n >= this.frames) labels.push({ id, text: s.text, x: s.sx / s.n, y: s.sy / s.n });
    const n = this.ins.n;
    const insertions =
      n > 0 && 2 * n >= this.frames
        ? {
            anterior: { x: this.ins.ax / n, y: this.ins.ay / n },
            inferior: { x: this.ins.ix / n, y: this.ins.iy / n },
          }
        : null;
    return { labels, insertions, settled: this.done };
  }
}
