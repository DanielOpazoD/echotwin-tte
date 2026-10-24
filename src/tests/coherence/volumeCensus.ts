/**
 * Census of a label grid of the heart by pairs of neighbouring structures (decision 365): for each pair, the distance
 * between the two cavities on the surface midway where they face each other, what lies between them, the empty space
 * and the fat within reach of both inside the heart's closure; the myocardium of each ventricle past its own
 * atrioventricular hinge, by sector and by the atrium it lies beside; the thickness of each wall; and the blood that
 * touches blood away from the orifices. The grid is the shipped Rodero volume as the app binds it, or the analytic heart
 * rasterised in its own frame, so the same figures are read of both.
 *
 * Nothing here decides what is right: `censusFindings` holds each figure against Daniel's thresholds (an interatrial
 * septum of 3–5 mm, an interventricular one of 8–12, an LV free wall of 8–11, atrial walls of 1.5–2.5; inside the
 * heart no gap, fat nor pericardium) and the test declares what fails today, with its figure.
 */
import { atlasMarks } from '@/simulator/anatomy/atlasFrame';
import { classifyHeart, type HeartModel, type HeartPose } from '@/simulator/anatomy/heartModel';
import { makeSample, Structure, Tissue } from '@/simulator/anatomy/tissue';
import {
  edt,
  EPI_CLOSING_MM,
  FAT,
  LABELS,
  type VolumeGpuData,
} from '@/simulator/anatomy/volumeHeart';
import { ALLOWED_BLOOD, bloodPairKey } from './allowedBlood';
import { TISSUE_SHORT } from './heartCensus';
import { STRUCTURE_NAME } from './structureNames';

export type V3 = [number, number, number];

/** A grid of labels over the heart, with what each label means and where each voxel lies in the anatomical frame. */
export interface LabelGrid {
  dims: V3;
  /** Voxel edge (mm of the grid). */
  voxelMm: number;
  labels: Uint8Array | Uint16Array;
  /** Tissue and structure of a label; null where there is nothing (outside the heart, or what counts as outside). */
  meaning: (l: number) => readonly [Tissue, Structure] | null;
  /** The groove fat's label. */
  fat: number;
  /** cm of the model per mm of the grid. */
  cmPerMm: number;
  /**
   * The centre of a voxel in the anatomical frame (mm of the grid): origin the mitral centre, z toward the LV apex, x
   * from the tricuspid centre toward the mitral one, y toward the aortic valve (`atlasFrame.ts`).
   */
  toAnat: (v: number) => V3;
}

/** Reach (mm) from both cavities of a pair within which the census reads what lies between them. */
export const BETWEEN_MM = 8;
/** Reach (mm) from both cavities within which an empty voxel inside the heart counts as a gap between them. */
export const GAP_MM = 6;
/** How opposite (cosine) the gradients of the two distance fields must be for a voxel to lie between the cavities. */
export const FACING_COS = -0.8;
/** Sectors around the long axis for the hinge of each atrioventricular valve. */
export const HINGE_SECTORS = 36;
/** How far (mm) past the hinge of its sector a voxel of ventricular myocardium counts as crossing the valve plane. */
export const HINGE_TOLERANCE_MM = 0.5;
/** Within this distance (mm) of an atrium's blood, myocardium past the hinge lies beside that atrium. */
export const HINGE_SIDE_MM = 8;

/** The blood of each structure of the census, by the Spanish abbreviation the reports use. */
export const CENSUS_BLOOD: Record<string, readonly Structure[]> = {
  AI: [Structure.LaCavity],
  AD: [Structure.RaCavity],
  VI: [Structure.LvCavity],
  VD: [Structure.RvCavity],
  RAo: [Structure.AorticRoot, Structure.Lvot],
  TP: [Structure.PulmonaryArtery, Structure.Rvot],
  VP: [Structure.PulmonaryVein],
  VCS: [Structure.Svc],
  VCI: [Structure.Ivc],
  SC: [Structure.CoronarySinus],
};
/** The pairs of neighbours the census reads: the four chambers among themselves, each against its great artery, each vein with its atrium. */
export const CENSUS_PAIRS: readonly [string, string][] = [
  ['AI', 'AD'],
  ['AI', 'VI'],
  ['AD', 'VD'],
  ['VI', 'VD'],
  ['AI', 'RAo'],
  ['AD', 'RAo'],
  ['VD', 'TP'],
  ['AI', 'VP'],
  ['AD', 'VCS'],
  ['AD', 'VCI'],
  ['AD', 'SC'],
];
/** Pairs whose border is an atrioventricular or interventricular groove, where epicardial fat belongs. */
export const GROOVE_PAIRS = new Set(['AI|VI', 'AD|VD', 'VI|VD']);

const LV_WALLS = new Set<Structure>([
  Structure.LvWallSeptal,
  Structure.LvWallLateral,
  Structure.LvWallAnterior,
  Structure.LvWallInferior,
  Structure.LvApex,
]);

export interface Stats {
  n: number;
  median: number;
  p90: number;
  max: number;
}
export interface PairCensus {
  a: string;
  b: string;
  /**
   * Distance between the two cavities (mm) through each voxel of what lies between them where they face each other (the
   * sum of its distances to both): it counts half a voxel into each cavity, so the tissue between them is one voxel
   * less. Null when they face nowhere.
   */
  span: Stats | null;
  /** What lies within BETWEEN_MM of both cavities, by label (tissue/structure), share of that volume and mL. */
  between: { name: string; share: number; ml: number }[];
  betweenMl: number;
  /** Empty voxels inside the heart's closure within GAP_MM of both cavities (mL), and where they lie (anatomical mm). */
  gapMl: number;
  gapAt: V3 | null;
  /** Groove fat within GAP_MM of both (mL). */
  fatMl: number;
}
export interface HingeCrossing {
  ventricle: 'VI' | 'VD';
  /** mL of the ventricle's myocardium past the hinge of its sector, by the atrium it lies beside (`otro`: neither). */
  side: { AI: number; AD: number; otro: number };
  /** How far (mm) past the hinge that myocardium reaches, beside each atrium. */
  above: { AI: Stats | null; AD: Stats | null };
  /** The same by sector of 360°/HINGE_SECTORS around the valve's centre (sectors with something only). */
  sectors: { sector: number; AI: number; AD: number; otro: number }[];
}
export interface WallThickness {
  wall: string;
  stats: Stats | null;
  p10: number;
}
export interface BloodContact {
  key: string;
  cm2: number;
  at: V3;
}
export interface VolumeCensus {
  voxelMm: number;
  /** mL of the model per voxel. */
  voxelMl: number;
  pairs: PairCensus[];
  hinges: HingeCrossing[];
  walls: WallThickness[];
  /** Blood against blood of another structure outside ALLOWED_BLOOD, by face count. */
  contacts: BloodContact[];
}

const stats = (xs: number[]): Stats | null => {
  if (!xs.length) return null;
  xs.sort((p, q) => p - q);
  return {
    n: xs.length,
    median: xs[xs.length >> 1]!,
    p90: xs[Math.floor(0.9 * (xs.length - 1))]!,
    max: xs[xs.length - 1]!,
  };
};
const labelName = (m: readonly [Tissue, Structure]): string =>
  `${STRUCTURE_NAME[m[1]] ?? `#${m[1]}`}/${TISSUE_SHORT[m[0]] ?? `t${m[0]}`}`;

/** The census of a grid. */
export function volumeCensus(g: LabelGrid): VolumeCensus {
  const { dims, voxelMm: vox, labels: L } = g;
  const [nx, ny, nz] = dims;
  const n = L.length;
  const voxelMl = (vox * g.cmPerMm) ** 3;
  const [sx, sy, sz] = [1, nx, nx * ny];
  // the meaning of every label once, by label
  const meanings: (readonly [Tissue, Structure] | null)[] = [];
  const mean = (l: number): readonly [Tissue, Structure] | null => {
    let m = meanings[l];
    if (m === undefined) meanings[l] = m = g.meaning(l);
    return m;
  };
  // which structure of the census each voxel's blood belongs to (−1: none), once
  const ids = Object.keys(CENSUS_BLOOD);
  const bloodId = new Int8Array(n).fill(-1);
  for (let v = 0; v < n; v++) {
    const m = mean(L[v]!);
    if (m && m[0] === Tissue.Blood)
      bloodId[v] = ids.findIndex((id) => CENSUS_BLOOD[id]!.includes(m[1]));
  }
  const isBlood = (id: string) => {
    const k = ids.indexOf(id);
    return (v: number) => bloodId[v] === k;
  };
  const interior = (v: number): boolean => {
    const i = v % nx,
      j = Math.floor(v / nx) % ny,
      k = Math.floor(v / sz);
    return i > 0 && j > 0 && k > 0 && i < nx - 1 && j < ny - 1 && k < nz - 1;
  };
  /** Whether two distance fields grow in opposite directions at v (central differences). */
  const facing = (a: Float32Array, b: Float32Array, v: number): boolean => {
    const ax = a[v + sx]! - a[v - sx]!,
      ay = a[v + sy]! - a[v - sy]!,
      az = a[v + sz]! - a[v - sz]!,
      bx = b[v + sx]! - b[v - sx]!,
      by = b[v + sy]! - b[v - sy]!,
      bz = b[v + sz]! - b[v - sz]!;
    const nn = Math.hypot(ax, ay, az) * Math.hypot(bx, by, bz);
    return nn > 0 && (ax * bx + ay * by + az * bz) / nn < FACING_COS;
  };
  // the distance to each structure's blood, once
  const dist = new Map<string, Float32Array>();
  const present = new Set<string>();
  for (const id of ids) {
    const f = isBlood(id);
    let any = false;
    for (let v = 0; v < n && !any; v++) if (f(v)) any = true;
    if (!any) continue;
    present.add(id);
    dist.set(id, edt(dims, f));
  }
  // the heart's closure: the silhouette (anything, fat included) closed with the ball of EPI_CLOSING_MM
  const r0 = EPI_CLOSING_MM / vox;
  const dOut = edt(dims, (v) => L[v] !== 0);
  const dIn = edt(dims, (v) => dOut[v]! > r0);
  const inside = (v: number): boolean => dIn[v]! > r0;

  const pairs: PairCensus[] = [];
  for (const [a, b] of CENSUS_PAIRS) {
    if (!present.has(a) || !present.has(b)) continue;
    const dA = dist.get(a)!,
      dB = dist.get(b)!;
    const isA = isBlood(a),
      isB = isBlood(b);
    const reach = BETWEEN_MM / vox,
      gapReach = GAP_MM / vox;
    const spans: number[] = [];
    const between = new Map<string, number>();
    let betweenN = 0,
      gap = 0,
      fat = 0;
    const gapSum: V3 = [0, 0, 0];
    for (let v = 0; v < n; v++) {
      if (dA[v]! > reach || dB[v]! > reach || isA(v) || isB(v)) continue;
      const l = L[v]!;
      const m = mean(l);
      // an empty voxel is a gap inside the heart's closure, and the outside beyond it
      const name = l === g.fat ? 'grasa' : m ? labelName(m) : inside(v) ? 'hueco' : 'exterior';
      between.set(name, (between.get(name) ?? 0) + 1);
      betweenN++;
      if (interior(v) && facing(dA, dB, v)) spans.push((dA[v]! + dB[v]!) * vox);
      if (dA[v]! <= gapReach && dB[v]! <= gapReach) {
        if (l === g.fat) fat++;
        else if (!m && inside(v)) {
          gap++;
          const p = g.toAnat(v);
          gapSum[0] += p[0];
          gapSum[1] += p[1];
          gapSum[2] += p[2];
        }
      }
    }
    pairs.push({
      a,
      b,
      span: stats(spans),
      between: [...between]
        .map(([name, c]) => ({ name, share: c / betweenN, ml: c * voxelMl }))
        .sort((p, q) => q.share - p.share),
      betweenMl: betweenN * voxelMl,
      gapMl: gap * voxelMl,
      gapAt: gap ? (gapSum.map((s) => s / gap) as V3) : null,
      fatMl: fat * voxelMl,
    });
  }

  // myocardium past the atrioventricular hinges: the hinge per sector is the most atrial voxel of the annulus
  const hinges: HingeCrossing[] = [];
  const dLA = dist.get('AI'),
    dRA = dist.get('AD');
  for (const [ventricle, annulus, isWall] of [
    [
      'VI',
      Structure.MitralAnnulus,
      (m: readonly [Tissue, Structure]) => m[0] === Tissue.Myocardium && LV_WALLS.has(m[1]),
    ],
    [
      'VD',
      Structure.TricuspidAnnulus,
      (m: readonly [Tissue, Structure]) => m[0] === Tissue.Myocardium && m[1] === Structure.RvWall,
    ],
  ] as const) {
    // the valve's centre (x, y) in the anatomical frame, from the annulus
    const c: V3 = [0, 0, 0];
    let cn = 0;
    for (let v = 0; v < n; v++) {
      const m = mean(L[v]!);
      if (m && m[0] === Tissue.Fibrous && m[1] === annulus) {
        const p = g.toAnat(v);
        c[0] += p[0];
        c[1] += p[1];
        cn++;
      }
    }
    if (!cn || !dLA || !dRA) continue;
    c[0] /= cn;
    c[1] /= cn;
    const sector = (p: V3): number =>
      Math.floor(
        ((Math.atan2(p[1] - c[1], p[0] - c[0]) + Math.PI) / (2 * Math.PI)) * HINGE_SECTORS,
      ) % HINGE_SECTORS;
    const hinge = new Array<number>(HINGE_SECTORS).fill(Infinity);
    for (let v = 0; v < n; v++) {
      const m = mean(L[v]!);
      if (m && m[0] === Tissue.Fibrous && m[1] === annulus) {
        const p = g.toAnat(v);
        const t = sector(p);
        hinge[t] = Math.min(hinge[t]!, p[2]);
      }
    }
    // a sector without a voxel of annulus takes the hinge of the nearest sector that has one
    for (let t = 0; t < HINGE_SECTORS; t++) {
      if (Number.isFinite(hinge[t])) continue;
      for (let d = 1; d < HINGE_SECTORS && !Number.isFinite(hinge[t]); d++)
        for (const u of [t + d, t - d]) {
          const h = hinge[(u + HINGE_SECTORS) % HINGE_SECTORS]!;
          if (Number.isFinite(h)) hinge[t] = Math.min(hinge[t]!, h);
        }
    }
    const side = { AI: 0, AD: 0, otro: 0 };
    const above = { AI: [] as number[], AD: [] as number[] };
    const bySector = new Map<number, { AI: number; AD: number; otro: number }>();
    const sideReach = HINGE_SIDE_MM / vox;
    for (let v = 0; v < n; v++) {
      const m = mean(L[v]!);
      if (!m || !isWall(m)) continue;
      const p = g.toAnat(v);
      const t = sector(p);
      const hz = hinge[t]!;
      if (!Number.isFinite(hz) || p[2] > hz - HINGE_TOLERANCE_MM) continue;
      const which: 'AI' | 'AD' | 'otro' =
        dLA[v]! <= sideReach && dLA[v]! <= dRA[v]! ? 'AI' : dRA[v]! <= sideReach ? 'AD' : 'otro';
      side[which] += voxelMl;
      if (which !== 'otro') above[which].push(hz - p[2]);
      const s = bySector.get(t) ?? { AI: 0, AD: 0, otro: 0 };
      s[which] += voxelMl;
      bySector.set(t, s);
    }
    hinges.push({
      ventricle,
      side,
      above: { AI: stats(above.AI), AD: stats(above.AD) },
      sectors: [...bySector]
        .map(([s, x]) => ({ sector: s, ...x }))
        .sort((p, q) => p.sector - q.sector),
    });
  }

  // wall thickness: at the middle voxels of a wall lining its cavity, the distances to both sides less one voxel
  const walls: WallThickness[] = [];
  const thickness = (
    wall: string,
    isW: (m: readonly [Tissue, Structure]) => boolean,
    cavity: string,
    keep: (v: number) => boolean = () => true,
  ) => {
    const dCav = dist.get(cavity);
    if (!dCav) return;
    const isC = isBlood(cavity);
    const dOther = edt(dims, (v) => {
      const m = mean(L[v]!);
      return !(m && isW(m)) && !isC(v);
    });
    const t: number[] = [];
    for (let v = 0; v < n; v++) {
      const m = mean(L[v]!);
      if (!m || !isW(m) || !keep(v)) continue;
      if (dCav[v]! <= 6 / vox && Math.abs(dCav[v]! - dOther[v]!) <= 1)
        t.push((dCav[v]! + dOther[v]! - 1) * vox);
    }
    const s = stats(t);
    walls.push({ wall, stats: s, p10: s ? t[Math.floor(0.1 * (t.length - 1))]! : NaN });
  };
  const lvWall = (m: readonly [Tissue, Structure]) =>
    m[0] === Tissue.Myocardium && LV_WALLS.has(m[1]);
  const dRV = dist.get('VD');
  if (dRV) {
    // the septum lies within reach of the RV's blood; the free wall far from it
    thickness('VI tabique', lvWall, 'VI', (v) => dRV[v]! * vox <= 12);
    thickness('VI pared libre', lvWall, 'VI', (v) => dRV[v]! * vox > 20);
  } else thickness('VI pared libre', lvWall, 'VI');
  thickness('VD', (m) => m[0] === Tissue.Myocardium && m[1] === Structure.RvWall, 'VD');
  thickness('AI', (m) => m[0] === Tissue.Myocardium && m[1] === Structure.LaWall, 'AI');
  thickness('AD', (m) => m[0] === Tissue.Myocardium && m[1] === Structure.RaWall, 'AD');

  // blood against the blood of another structure across a face, outside the orifices
  const contactAcc = new Map<string, { faces: number; sum: V3 }>();
  const bump = (v: number, w: number) => {
    const mv = mean(L[v]!),
      mw = mean(L[w]!);
    if (!mv || !mw || mv[0] !== Tissue.Blood || mw[0] !== Tissue.Blood || mv[1] === mw[1]) return;
    const key = bloodPairKey(mv[1], mw[1]);
    if (ALLOWED_BLOOD.has(key)) return;
    const e = contactAcc.get(key) ?? { faces: 0, sum: [0, 0, 0] as V3 };
    const p = g.toAnat(v);
    e.faces++;
    e.sum[0] += p[0];
    e.sum[1] += p[1];
    e.sum[2] += p[2];
    contactAcc.set(key, e);
  };
  for (let v = 0; v < n; v++) {
    if (L[v] === 0) continue;
    const i = v % nx,
      j = Math.floor(v / nx) % ny,
      k = Math.floor(v / sz);
    if (i + 1 < nx) bump(v, v + sx);
    if (j + 1 < ny) bump(v, v + sy);
    if (k + 1 < nz) bump(v, v + sz);
  }
  const contacts: BloodContact[] = [...contactAcc]
    .map(([key, e]) => ({
      key,
      cm2: e.faces * (vox * g.cmPerMm) ** 2,
      at: e.sum.map((s) => s / e.faces) as V3,
    }))
    .sort((p, q) => q.cm2 - p.cm2);

  return { voxelMm: vox, voxelMl, pairs, hinges, walls, contacts };
}

/** The bound Rodero volume as a grid of the census (the labels the GPU samples, decision 353). */
export function roderoGrid(gpu: VolumeGpuData): LabelGrid {
  const [nx, ny] = gpu.dims;
  const M = gpu.mesh;
  return {
    dims: gpu.dims,
    voxelMm: gpu.voxelMm,
    labels: gpu.labels,
    meaning: (l) => (l === FAT ? null : (LABELS[l] ?? null)),
    fat: FAT,
    cmPerMm: gpu.k,
    toAnat: (v) => {
      const i = v % nx,
        j = Math.floor(v / nx) % ny,
        k = Math.floor(v / (nx * ny));
      const m = [
        gpu.gridOrigin[0] + (i + 0.5) * gpu.voxelMm - M.o[0],
        gpu.gridOrigin[1] + (j + 0.5) * gpu.voxelMm - M.o[1],
        gpu.gridOrigin[2] + (k + 0.5) * gpu.voxelMm - M.o[2],
      ];
      const d = (e: readonly number[]) => m[0]! * e[0]! + m[1]! * e[1]! + m[2]! * e[2]!;
      return [d(M.ex), d(M.ey), d(M.ez)];
    },
  };
}

// the heart frame box of the analytic heart (cm): atria and great vessels above (z negative), the apex below
const BOX: readonly [V3, V3] = [
  [-7.5, -8, -9],
  [7.5, 6, 11],
];
/** Tissues that are outside the heart for the census: what the sampler paints beyond the epicardium. */
const OUTSIDE = new Set<Tissue>([Tissue.Pericardium, Tissue.Fluid, Tissue.Lung]);
/** A label of the analytic grid: tissue and structure in one code, 0 for nothing. */
const analyticCode = (tissue: Tissue, structure: Structure): number => tissue * 64 + structure + 1;

/** The analytic heart at `pose`, rasterised every `hMm` mm of the model in its heart frame. */
export function analyticGrid(heart: HeartModel, pose: HeartPose, hMm: number): LabelGrid {
  const h = hMm / 10;
  const dims: V3 = [0, 1, 2].map((a) => Math.round((BOX[1][a]! - BOX[0][a]!) / h) + 1) as V3;
  const [nx, ny, nz] = dims;
  const labels = new Uint16Array(nx * ny * nz);
  const s = makeSample();
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const x = BOX[0][0] + i * h,
          y = BOX[0][1] + j * h,
          z = BOX[0][2] + k * h;
        if (!classifyHeart(heart, pose, x + pose.swingX, y, z, s) || OUTSIDE.has(s.tissue))
          continue;
        labels[i + nx * (j + ny * k)] = analyticCode(s.tissue, s.structure);
      }
  const F = atlasMarks(heart, pose).frame;
  return {
    dims,
    voxelMm: hMm,
    labels,
    meaning: (l) => (l === 0 ? null : [Math.floor((l - 1) / 64), (l - 1) % 64]),
    fat: analyticCode(Tissue.Fat, Structure.EpicardialFat),
    cmPerMm: 0.1,
    toAnat: (v) => {
      const i = v % nx,
        j = Math.floor(v / nx) % ny,
        k = Math.floor(v / (nx * ny));
      const p = [
        BOX[0][0] + i * h - F.origin[0],
        BOX[0][1] + j * h - F.origin[1],
        BOX[0][2] + k * h - F.origin[2],
      ];
      const d = (e: readonly number[]) => 10 * (p[0]! * e[0]! + p[1]! * e[1]! + p[2]! * e[2]!);
      return [d(F.ex), d(F.ey), d(F.ez)];
    },
  };
}

/** Thresholds (mm) of the walls Daniel gave; the RV's is the literature's, he gave none. */
export const WALL_RANGE_MM: Record<string, [number, number]> = {
  'VI tabique': [8, 12],
  'VI pared libre': [8, 11],
  VD: [2, 6],
  AI: [1.5, 2.5],
  AD: [1.5, 2.5],
};
/** Thresholds (mm) of the tissue between two cavities where they face each other: the septa. */
export const SEPTUM_RANGE_MM: Record<string, [number, number]> = {
  'AI|AD': [3, 5],
  'VI|VD': [8, 12],
};
/** Myocardium of a ventricle past the hinge beside an atrium, allowed (mL): the crux and the sector edges. */
export const HINGE_CROSSING_ML = 0.4;
/** Gap or fat (mL) below which a pair reads as closed: a score of voxels at the edges of the closure. */
export const GAP_TOLERANCE_ML = 0.02;

export interface Finding {
  /** `pair rule` or `wall rule`: the key a KNOWN_* entry declares. */
  key: string;
  figure: number;
  /** The rule in words, with the figure and its threshold. */
  text: string;
}

const f1 = (x: number) => x.toFixed(1);
const f2 = (x: number) => x.toFixed(2);

/** What the census finds against the thresholds; each finding names its key, its figure and the rule it breaks. */
export function censusFindings(c: VolumeCensus): Finding[] {
  const out: Finding[] = [];
  for (const p of c.pairs) {
    const id = `${p.a}|${p.b}`;
    if (p.gapMl > GAP_TOLERANCE_ML)
      out.push({
        key: `${id} hueco`,
        figure: p.gapMl,
        text: `${f2(p.gapMl)} mL de hueco dentro del corazón a menos de ${GAP_MM} mm de ${p.a} y ${p.b}${p.gapAt ? ` (en ${p.gapAt.map(f1).join(', ')} mm)` : ''}`,
      });
    if (!GROOVE_PAIRS.has(id) && p.fatMl > GAP_TOLERANCE_ML)
      out.push({
        key: `${id} grasa`,
        figure: p.fatMl,
        text: `${f2(p.fatMl)} mL de grasa a menos de ${GAP_MM} mm de ${p.a} y ${p.b}, que no comparten surco`,
      });
    const range = SEPTUM_RANGE_MM[id];
    if (range && p.span) {
      const t = p.span.median - c.voxelMm;
      if (t < range[0] || t > range[1])
        out.push({
          key: `${id} tabique`,
          figure: t,
          text: `tabique de ${f1(t)} mm de mediana entre ${p.a} y ${p.b} donde se enfrentan (p90 ${f1(p.span.p90 - c.voxelMm)}), fuera de ${range[0]}–${range[1]}`,
        });
    }
  }
  for (const h of c.hinges)
    for (const side of ['AI', 'AD'] as const) {
      // the atrioventricular septum: the LV's basal septum faces the right atrium above the tricuspid hinge, and stays
      if (h.ventricle === 'VI' && side === 'AD') continue;
      if (h.side[side] > HINGE_CROSSING_ML)
        out.push({
          key: `${h.ventricle} sobre bisagra ${side}`,
          figure: h.side[side],
          text: `${f2(h.side[side])} mL de miocardio del ${h.ventricle} por encima de su bisagra junto a la ${side}, hasta ${f1(h.above[side]?.max ?? 0)} mm más arriba (límite ${HINGE_CROSSING_ML} mL)`,
        });
    }
  for (const w of c.walls) {
    const range = WALL_RANGE_MM[w.wall];
    if (!range || !w.stats) continue;
    if (w.stats.median < range[0] || w.stats.median > range[1])
      out.push({
        key: `pared ${w.wall}`,
        figure: w.stats.median,
        text: `pared ${w.wall} de ${f1(w.stats.median)} mm de mediana (p10 ${f1(w.p10)}, p90 ${f1(w.stats.p90)}), fuera de ${range[0]}–${range[1]}`,
      });
  }
  for (const k of c.contacts)
    out.push({
      key: `sangre ${k.key}`,
      figure: k.cm2,
      text: `${f2(k.cm2)} cm² de sangre contra sangre entre ${k.key} fuera de los orificios (en ${k.at.map(f1).join(', ')} mm)`,
    });
  return out;
}

/** The census as a human reads it: the table by pairs, what lies between each, the hinges, the walls, the contacts. */
export function renderVolumeCensus(c: VolumeCensus): string[] {
  const lines: string[] = [];
  lines.push(
    `| par | enfrentados (vóxeles) | distancia entre cavidades mediana / p90 / máx (mm) | entre ellas (mL) | hueco (mL) | grasa (mL) |`,
    `|---|---:|---|---:|---:|---:|`,
  );
  for (const p of c.pairs)
    lines.push(
      `| ${p.a}–${p.b} | ${p.span?.n ?? 0} | ${p.span ? `${f1(p.span.median)} / ${f1(p.span.p90)} / ${f1(p.span.max)}` : '—'} | ${f2(p.betweenMl)} | ${f2(p.gapMl)} | ${f2(p.fatMl)} |`,
    );
  lines.push('');
  for (const p of c.pairs)
    lines.push(
      `- ${p.a}–${p.b}, a menos de ${BETWEEN_MM} mm de ambas: ${p.between
        .filter((e) => e.share >= 0.005)
        .map((e) => `${e.name} ${(100 * e.share).toFixed(e.share >= 0.1 ? 0 : 1)} %`)
        .join(', ')}${p.gapAt ? `; hueco en (${p.gapAt.map(f1).join(', ')}) mm` : ''}.`,
    );
  lines.push('');
  for (const h of c.hinges) {
    lines.push(
      `- Miocardio del ${h.ventricle} por encima de su bisagra: junto a la AI ${f2(h.side.AI)} mL${h.above.AI ? ` (sube ${f1(h.above.AI.median)} mm de mediana, ${f1(h.above.AI.max)} máx)` : ''}, junto a la AD ${f2(h.side.AD)} mL${h.above.AD ? ` (sube ${f1(h.above.AD.median)} mm de mediana, ${f1(h.above.AD.max)} máx)` : ''}, lejos de ambas ${f2(h.side.otro)} mL.` +
        (h.sectors.length
          ? ` Por sector (${HINGE_SECTORS} de ${360 / HINGE_SECTORS}°, desde −180° alrededor del centro de la válvula): ${h.sectors
              .filter((s) => s.AI + s.AD + s.otro >= 0.05)
              .map(
                (s) =>
                  `${s.sector}: ${[
                    s.AI >= 0.01 ? `AI ${f2(s.AI)}` : '',
                    s.AD >= 0.01 ? `AD ${f2(s.AD)}` : '',
                    s.otro >= 0.01 ? `otro ${f2(s.otro)}` : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}`,
              )
              .join('; ')}.`
          : ''),
    );
  }
  lines.push('');
  lines.push(
    `| pared | mediana (mm) | p10 | p90 | vóxeles medidos | rango |`,
    `|---|---:|---:|---:|---:|---|`,
  );
  for (const w of c.walls) {
    const r = WALL_RANGE_MM[w.wall];
    lines.push(
      `| ${w.wall} | ${w.stats ? f1(w.stats.median) : '—'} | ${w.stats ? f1(w.p10) : '—'} | ${w.stats ? f1(w.stats.p90) : '—'} | ${w.stats?.n ?? 0} | ${r ? `${r[0]}–${r[1]}` : '—'} |`,
    );
  }
  lines.push('');
  lines.push(
    c.contacts.length
      ? `Sangre contra sangre fuera de los orificios: ${c.contacts.map((k) => `${k.key} ${f2(k.cm2)} cm² en (${k.at.map(f1).join(', ')}) mm`).join('; ')}.`
      : 'Sangre contra sangre fuera de los orificios: ninguna.',
  );
  return lines;
}
