/**
 * Corners of the anatomy's borders in the drawn planes (decision 382): where a border turns more than CORNER_TURN_DEG
 * within CORNER_ARM_CM on either side, a radius of curvature under about 4 mm, which no pericardium and no cavity has
 * away from its valves. The coherence census measured straight runs of the cavities only, on the rendered map; the
 * outer edge of the sac, drawn as straight faces meeting at corners where it lies far from the walls, went unmeasured.
 *
 * Measured on the anatomy, not on the image: the heart classifier sampled in the view's plane every CORNER_GRID_CM (the
 * rendered map takes each pixel's nearest polar sample, and at depth the spacing between beam lines draws steps of its
 * own). Each border is a group's outline (marching squares, chained and resampled every RESAMPLE_CM): the sac (all the
 * heart classifier holds) and the blood of the four chambers with their mouths. Not counted: corners within
 * CORNER_CLEAR_CM of the valve apparatus (for the chambers) or of a vessel leaving the sac (for the sac), where the
 * anatomy has its angles, and on the sector's edge.
 *
 *   npx tsx tools/offline/review/border-corners.ts [caseIds,comma|all] [viewIds,comma] [phases,comma]
 */
import { loadCaseById } from '@/cases';
import { buildCaseModels } from '@/simulator/anatomy/caseModels';
import { torsoToHeart } from '@/simulator/anatomy/heartFrame';
import { classifyHeart, computeHeartPose } from '@/simulator/anatomy/heartModel';
import { makeSample, Structure, Tissue } from '@/simulator/anatomy/tissue';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import { DEFAULT_ACQUISITION } from '@/simulator/renderer/types';
import { canonicalControl, VIEW_TARGETS } from '@/simulator/windows/viewTargets';

export const CORNER_TURN_DEG = 30;
export const CORNER_ARM_CM = 0.2;
export const CORNER_GRID_CM = 0.03;
export const CORNER_CLEAR_CM = 0.3;
const RESAMPLE_CM = 0.05;

export const BORDERS = ['sac', 'lv', 'rv', 'la', 'ra'] as const;
export type Border = (typeof BORDERS)[number];

export interface Corner {
  border: Border;
  turnDeg: number;
  /** cm from the probe along the beam axis, and lateral cm */
  depthCm: number;
  lateralCm: number;
}

/** The blood of each chamber with its mouths: a border between two of these structures is not the chamber's edge. */
const BLOOD: Record<Exclude<Border, 'sac'>, Set<number>> = {
  lv: new Set([Structure.LvCavity, Structure.Lvot]),
  rv: new Set([Structure.RvCavity, Structure.Rvot]),
  la: new Set([Structure.LaCavity, Structure.LaAppendage, Structure.PulmonaryVein]),
  ra: new Set([
    Structure.RaCavity,
    Structure.RaAppendage,
    Structure.Svc,
    Structure.Ivc,
    Structure.CoronarySinus,
  ]),
};
/** The valve apparatus, where a chamber's outline has its angles. */
const APPARATUS = new Set<number>([
  Structure.MitralAnterior,
  Structure.MitralPosterior,
  Structure.AorticValve,
  Structure.TricuspidValve,
  Structure.PulmonaryValve,
  Structure.MitralAnnulus,
  Structure.TricuspidAnnulus,
  Structure.Chordae,
  Structure.PapillaryMuscle,
  Structure.RvPapillary,
  Structure.ModeratorBand,
  Structure.AortomitralCurtain,
]);
/** The vessels that leave the sac, where its outline has its angles. */
const LEAVING = new Set<number>([
  Structure.AorticRoot,
  Structure.AscendingAorta,
  Structure.AorticArch,
  Structure.PulmonaryArtery,
  Structure.Svc,
  Structure.Ivc,
  Structure.PulmonaryVein,
  Structure.DescendingAorta,
  Structure.BrachiocephalicArtery,
  Structure.LeftCommonCarotid,
  Structure.LeftSubclavian,
]);

/** The corners of the borders of one case in one view at one phase. */
export function borderCorners(id: string, viewId: string, phase: number): Corner[] {
  const view = VIEW_TARGETS.find((v) => v.id === viewId)!;
  const { thorax, heart, tables } = buildCaseModels(loadCaseById(id), {
    position: 'left-lateral',
    respiration: 'expiration',
    headElevationDeg: 0,
  });
  const beam = beamFrameFromPose(poseFromControl(thorax, canonicalControl(view, heart, thorax)), 1);
  const pose = computeHeartPose(heart, cycleStateAt(tables, phase));
  const depth = DEFAULT_ACQUISITION.depthCm;
  const half = (DEFAULT_ACQUISITION.sectorDeg * Math.PI) / 360;
  const g = CORNER_GRID_CM;
  const U = depth * Math.sin(half);
  const W = Math.ceil((2 * U) / g) + 1,
    H = Math.ceil(depth / g) + 1;
  const inSector = (u: number, d: number) =>
    d > 0 && d < depth && Math.abs(Math.atan2(u, d)) < half;
  const st = new Int16Array(W * H).fill(-1);
  const blood = new Uint8Array(W * H);
  const s = makeSample();
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const u = -U + i * g,
        d = j * g;
      if (!inSector(u, d)) continue;
      const p = {
        x: beam.origin.x + beam.forward.x * d + beam.lateral.x * u,
        y: beam.origin.y + beam.forward.y * d + beam.lateral.y * u,
        z: beam.origin.z + beam.forward.z * d + beam.lateral.z * u,
      };
      const h = torsoToHeart(heart.frame, p);
      if (classifyHeart(heart, pose, h.x + pose.swingX, h.y, h.z, s)) {
        st[j * W + i] = s.structure;
        blood[j * W + i] = s.tissue === Tissue.Blood ? 1 : 0;
      }
    }
  // whether a structure of `set` lies within CORNER_CLEAR_CM of a point
  const r = Math.ceil(CORNER_CLEAR_CM / g);
  const near = (u: number, d: number, set: Set<number>) => {
    const i0 = Math.round((u + U) / g),
      j0 = Math.round(d / g);
    for (let dj = -r; dj <= r; dj++)
      for (let di = -r; di <= r; di++) {
        const i = i0 + di,
          j = j0 + dj;
        if (i < 0 || j < 0 || i >= W || j >= H || di * di + dj * dj > r * r) continue;
        if (set.has(st[j * W + i]!)) return true;
      }
    return false;
  };
  // clear of the sector's edge by an arm and a cell
  const edge = CORNER_ARM_CM + g;
  const awayFromEdge = (u: number, d: number) =>
    d > edge && d < depth - edge && Math.abs(Math.atan2(u, d)) < half - edge / Math.max(d, 1);
  const corners: Corner[] = [];
  for (const border of BORDERS) {
    const mask = new Uint8Array(W * H);
    for (let k = 0; k < W * H; k++)
      mask[k] =
        border === 'sac' ? (st[k]! >= 0 ? 1 : 0) : blood[k] && BLOOD[border].has(st[k]!) ? 1 : 0;
    const clearOf = border === 'sac' ? LEAVING : APPARATUS;
    for (const loop of outlines(mask, W, H, g, -U)) {
      const pts = resample(loop.pts, loop.closed);
      const n = pts.length;
      const K = Math.round(CORNER_ARM_CM / RESAMPLE_CM);
      if (n < 2 * K + 3) continue;
      const at = (k: number) => pts[loop.closed ? ((k % n) + n) % n : k]!;
      const turn = new Float64Array(n);
      const lo = loop.closed ? 0 : K,
        hi = loop.closed ? n : n - K;
      for (let k = lo; k < hi; k++) {
        const a = at(k - K),
          b = at(k),
          c = at(k + K);
        let t = Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0]);
        while (t > Math.PI) t -= 2 * Math.PI;
        while (t < -Math.PI) t += 2 * Math.PI;
        turn[k] = (t * 180) / Math.PI;
      }
      for (let k = lo; k < hi; k++) {
        const t = Math.abs(turn[k]!);
        if (t < CORNER_TURN_DEG) continue;
        // one corner per bend: the largest turn within an arm on either side (ties to the first)
        let top = true;
        for (let o = -K; o <= K && top; o++) {
          if (o === 0) continue;
          const q = loop.closed ? (((k + o) % n) + n) % n : k + o;
          if (q < lo || q >= hi) continue;
          const tq = Math.abs(turn[q]!);
          if (tq > t || (tq === t && o < 0)) top = false;
        }
        if (!top) continue;
        const [u, d] = at(k);
        if (!awayFromEdge(u, d) || near(u, d, clearOf)) continue;
        corners.push({ border, turnDeg: turn[k]!, depthCm: d, lateralCm: u });
      }
    }
  }
  return corners;
}

type Pt = [number, number];

/** The outlines of a mask (marching squares at half level), chained into polylines in (lateral, depth) cm. */
function outlines(
  mask: Uint8Array,
  W: number,
  H: number,
  g: number,
  u0: number,
): { pts: Pt[]; closed: boolean }[] {
  const segs: [Pt, Pt][] = [];
  for (let j = 0; j < H - 1; j++)
    for (let i = 0; i < W - 1; i++) {
      const idx =
        mask[j * W + i]! |
        (mask[j * W + i + 1]! << 1) |
        (mask[(j + 1) * W + i + 1]! << 2) |
        (mask[(j + 1) * W + i]! << 3);
      if (idx === 0 || idx === 15) continue;
      const x = u0 + i * g,
        y = j * g;
      const e: Record<string, Pt> = {
        t: [x + g / 2, y],
        r: [x + g, y + g / 2],
        b: [x + g / 2, y + g],
        l: [x, y + g / 2],
      };
      for (const [a, b] of CASES[idx]!) segs.push([e[a]!, e[b]!]);
    }
  const key = (p: Pt) => `${Math.round((p[0] - u0) / (g / 2))},${Math.round(p[1] / (g / 2))}`;
  const ends = new Map<string, number[]>();
  segs.forEach((sg, k) => {
    for (const p of sg) {
      const a = ends.get(key(p)) ?? [];
      a.push(k);
      ends.set(key(p), a);
    }
  });
  const used = new Uint8Array(segs.length);
  const out: { pts: Pt[]; closed: boolean }[] = [];
  for (let k0 = 0; k0 < segs.length; k0++) {
    if (used[k0]) continue;
    used[k0] = 1;
    const pts: Pt[] = [segs[k0]![0], segs[k0]![1]];
    for (const forward of [true, false])
      for (;;) {
        const end = forward ? pts[pts.length - 1]! : pts[0]!;
        const k = (ends.get(key(end)) ?? []).find((c) => !used[c]);
        if (k === undefined) break;
        used[k] = 1;
        const [a, b] = segs[k]!;
        const nxt = key(a) === key(end) ? b : a;
        if (forward) pts.push(nxt);
        else pts.unshift(nxt);
      }
    const closed = key(pts[0]!) === key(pts[pts.length - 1]!);
    if (closed) pts.pop();
    out.push({ pts, closed });
  }
  return out;
}
const CASES: Record<number, [string, string][]> = {
  1: [['l', 't']],
  2: [['t', 'r']],
  3: [['l', 'r']],
  4: [['r', 'b']],
  5: [
    ['l', 't'],
    ['r', 'b'],
  ],
  6: [['t', 'b']],
  7: [['l', 'b']],
  8: [['b', 'l']],
  9: [['t', 'b']],
  10: [
    ['t', 'r'],
    ['b', 'l'],
  ],
  11: [['r', 'b']],
  12: [['r', 'l']],
  13: [['t', 'r']],
  14: [['l', 't']],
};

/** A polyline resampled every RESAMPLE_CM of its length. */
function resample(pts: Pt[], closed: boolean): Pt[] {
  const src = closed ? [...pts, pts[0]!] : pts;
  const out: Pt[] = [src[0]!];
  // length still to walk before the next sample
  let need = RESAMPLE_CM;
  for (let k = 1; k < src.length; k++) {
    const a = src[k - 1]!,
      b = src[k]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let pos = 0;
    while (len - pos >= need) {
      pos += need;
      out.push([a[0] + ((b[0] - a[0]) * pos) / len, a[1] + ((b[1] - a[1]) * pos) / len]);
      need = RESAMPLE_CM;
    }
    need -= len - pos;
  }
  if (closed && out.length > 1) out.pop();
  return out;
}
