/**
 * A heart read from a label volume (decision 346), for the CPU tracer's `Scene.heartClassifier`: the mean heart of Rodero
 * et al. 2021 voxelised by `tools/offline/anatomy2/rodero-voxelize.ts` (the data stay outside the repository), placed in the model's heart frame by the anatomical frame both share
 * (`atlasFrame.ts`: origin the mitral centre, z to the LV apex, x from the tricuspid centre to the mitral one, y toward the
 * aortic valve) and scaled so that its LV length is the model's. Static: the end-diastolic shape of the CT, no motion.
 *
 * What the mesh does not have is added the way the analytic heart draws it: the epicardial fat that fills the grooves
 * (the heart's silhouette closed with a ball of EPI_CLOSING_MM), the pericardium PERICARDIUM_CM outside it, and on a miss
 * the distance beyond the sac for the thorax. The CT has no leaflets, chords or papillary muscles: its atrioventricular
 * valve planes are flat discs, taken as blood, and the analytic heart's apparatus is drawn in the cavities (APPARATUS).
 * The semilunar planes are closed valve, as at end diastole. The vessels end where the CT segmentation cut them.
 */
import { atlasMarks } from './atlasFrame';
import { PERICARDIUM_CM } from './classify/pericardium';
import { classifyHeart, type HeartModel, type HeartPose } from './heartModel';
import type { HeartClassifier } from './sceneClassifier';
import { Structure, Tissue, type TissueSample } from './tissue';

type V3 = [number, number, number];
/** The header the voxeliser writes next to the labels: the grid (mm, mesh coordinates) and the frame's landmarks. */
export interface LabelVolumeHeader {
  voxelMm: number;
  origin: V3;
  dims: V3;
  landmarks: Record<'mitral' | 'tricuspid' | 'aortic' | 'pulmonary' | 'apex', V3>;
}
/** A label volume: one byte per voxel, x fastest, the labels of rodero-voxelize.ts. */
export interface LabelVolume {
  header: LabelVolumeHeader;
  labels: Uint8Array;
}

/** Radius (mm, mesh scale) of the ball that closes the silhouette: what it adds outside the walls is epicardial fat. */
export const EPI_CLOSING_MM = 4;

/** Tissue and structure of each label of the volume (rodero-voxelize.ts); 0 and unknown labels are outside. */
export const LABELS: Record<number, [Tissue, Structure]> = {
  1: [Tissue.Myocardium, Structure.LvWallLateral], // the wall is named by its sector at runtime
  2: [Tissue.Myocardium, Structure.RvWall],
  3: [Tissue.Myocardium, Structure.LaWall],
  4: [Tissue.Myocardium, Structure.RaWall],
  5: [Tissue.VesselWall, Structure.AorticRoot],
  6: [Tissue.VesselWall, Structure.PulmonaryArtery],
  7: [Tissue.Blood, Structure.LvCavity],
  8: [Tissue.Blood, Structure.RvCavity],
  9: [Tissue.Valve, Structure.AorticValve],
  10: [Tissue.Valve, Structure.PulmonaryValve],
  // the caps of the inlets (blood) and their rings (wall): appendage, four pulmonary veins, superior and inferior cava
  11: [Tissue.Blood, Structure.LaAppendage],
  12: [Tissue.Blood, Structure.PulmonaryVein],
  13: [Tissue.Blood, Structure.PulmonaryVein],
  14: [Tissue.Blood, Structure.PulmonaryVein],
  15: [Tissue.Blood, Structure.PulmonaryVein],
  16: [Tissue.Blood, Structure.Svc],
  17: [Tissue.Blood, Structure.Ivc],
  18: [Tissue.Myocardium, Structure.LaAppendage],
  19: [Tissue.VesselWall, Structure.PulmonaryVein],
  20: [Tissue.VesselWall, Structure.PulmonaryVein],
  21: [Tissue.VesselWall, Structure.PulmonaryVein],
  22: [Tissue.VesselWall, Structure.PulmonaryVein],
  23: [Tissue.VesselWall, Structure.Svc],
  24: [Tissue.VesselWall, Structure.Ivc],
  31: [Tissue.Blood, Structure.LvCavity],
  32: [Tissue.Blood, Structure.RvCavity],
  33: [Tissue.Blood, Structure.LaCavity],
  34: [Tissue.Blood, Structure.RaCavity],
  35: [Tissue.Blood, Structure.AorticRoot],
  36: [Tissue.Blood, Structure.PulmonaryArtery],
};
/** Reach (voxels) and width of the Gaussian that weighs the interface normal on the voxels that border an interface. */
const NORMAL_REACH = 5;
const NORMAL_SIGMA = 2.5;
/** Fat filling the grooves: a label of its own in the runtime volume. */
export const FAT = 254;

/** Squared Euclidean distance transform along one line (Felzenszwalb & Huttenlocher 2012). */
function edtLine(
  f: Float64Array,
  n: number,
  d: Float64Array,
  v: Int32Array,
  z: Float64Array,
): void {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    while (s <= z[k]!) {
      k--;
      s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1]! < q) k++;
    d[q] = (q - v[k]!) ** 2 + f[v[k]!]!;
  }
}

/** Distance (voxels) from every voxel to the nearest voxel where `feature` holds. */
function edt(dims: V3, feature: (v: number) => boolean): Float32Array {
  const [nx, ny, nz] = dims;
  const out = new Float32Array(nx * ny * nz);
  const BIG = 1e20;
  for (let v = 0; v < out.length; v++) out[v] = feature(v) ? 0 : BIG;
  const m = Math.max(nx, ny, nz);
  const f = new Float64Array(m),
    d = new Float64Array(m),
    z = new Float64Array(m + 1);
  const w = new Int32Array(m);
  const pass = (n: number, count: number, at: (line: number, q: number) => number): void => {
    for (let line = 0; line < count; line++) {
      for (let q = 0; q < n; q++) f[q] = out[at(line, q)]!;
      edtLine(f, n, d, w, z);
      for (let q = 0; q < n; q++) out[at(line, q)] = d[q]!;
    }
  };
  pass(nx, ny * nz, (l, q) => q + nx * l);
  pass(ny, nx * nz, (l, q) => (l % nx) + nx * (q + ny * Math.floor(l / nx)));
  pass(nz, nx * ny, (l, q) => l + nx * ny * q);
  for (let v = 0; v < out.length; v++) out[v] = Math.sqrt(out[v]!);
  return out;
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const unit = (a: V3): V3 => scale(a, 1 / Math.hypot(...a));
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** The anatomical frame of the mesh (mm): origin, axes and LV length. */
function meshFrame(h: LabelVolumeHeader): { o: V3; ex: V3; ey: V3; ez: V3; far: number } {
  const L = h.landmarks;
  const far = Math.hypot(...sub(L.apex, L.mitral));
  const ez = unit(sub(L.apex, L.mitral));
  let ex = sub(L.mitral, L.tricuspid);
  ex = unit(sub(ex, scale(ez, dot(ex, ez))));
  let ey = cross(ez, ex);
  if (dot(sub(L.aortic, L.mitral), ey) < 0) ey = scale(ey, -1);
  return { o: L.mitral, ex, ey, ez, far };
}

/**
 * Structures of the analytic heart's valve apparatus (decision 346) that the volume takes where its own label is cavity
 * blood: the atrioventricular leaflets, their chords, the papillary muscles and the moderator band. The CT segmentation
 * has none of them: its valve planes are flat discs and its cavities smooth.
 */
export const APPARATUS = new Set<Structure>([
  Structure.MitralAnterior,
  Structure.MitralPosterior,
  Structure.TricuspidValve,
  Structure.Chordae,
  Structure.PapillaryMuscle,
  Structure.RvPapillary,
  Structure.ModeratorBand,
]);
/** Labels of the volume that are cavity blood the apparatus may occupy: the AV valve planes and the four chambers. */
export const APPARATUS_HOSTS = new Set([7, 8, 31, 32, 33, 34]);

export interface VolumeHeart {
  /**
   * The volume's heart. With `apparatusPose`, the analytic heart's leaflets, chords and papillary muscles at that pose
   * are drawn in its cavities, and they move with the cycle while the walls stay at end diastole.
   */
  classifier(apparatusPose?: HeartPose): HeartClassifier;
  /** The volume's label at a heart-frame point (cm), the groove fat as 254; −1 beyond the grid. */
  labelAt(hx: number, hy: number, hz: number): number;
  /** cm of the model per mm of the mesh. */
  cmPerMm: number;
}

interface Fields {
  h: LabelVolumeHeader;
  label: Uint8Array;
  dEpi: Float32Array;
  dIf: Float32Array;
}
const fieldCache = new WeakMap<LabelVolume, Fields>();

/** The volume's fields: labels with the groove fat, the distance beyond the epicardium and to the nearest interface (mm). */
function volumeFields(vol: LabelVolume): Fields {
  const h = vol.header;
  // a copy: the groove fat is written into it
  const label = Uint8Array.from(vol.labels);
  const dims = h.dims;
  const [nx, ny] = dims;
  const vox = h.voxelMm;
  const cls = (l: number): number => (l === FAT ? 1 : (LABELS[l]?.[0] ?? 0) + 2);
  // epicardial fat: the silhouette closed with a ball (dilate, then erode), less the heart itself
  const r = EPI_CLOSING_MM / vox;
  const dOut = edt(dims, (v) => label[v] !== 0);
  const dIn = edt(dims, (v) => dOut[v]! > r);
  for (let v = 0; v < label.length; v++) if (label[v] === 0 && dIn[v]! > r) label[v] = FAT;
  // beyond the epicardium (heart or groove fat), in mm, for the pericardium and the thorax
  const dEpi = edt(dims, (v) => label[v] !== 0);
  for (let v = 0; v < dEpi.length; v++) dEpi[v] = dEpi[v]! * vox;
  // distance to the nearest interface between tissues, in mm, for the specular term and its normal
  const step = [1, -1, nx, -nx, nx * ny, -nx * ny];
  const dIf = edt(dims, (v) => {
    const c = cls(label[v]!);
    for (const s of step) {
      const w = v + s;
      if (w >= 0 && w < label.length && cls(label[w]!) !== c) return true;
    }
    return false;
  });
  // the interface lies half a voxel beyond the centre of the voxel that borders it
  for (let v = 0; v < dIf.length; v++) dIf[v] = (dIf[v]! + 0.5) * vox;

  return { h, label, dEpi, dIf };
}

/** A label volume in the frame of `heart`, aligned by its end-diastolic pose `endDiastole`. */
export function volumeHeart(
  vol: LabelVolume,
  heart: HeartModel,
  endDiastole: HeartPose,
): VolumeHeart {
  const fields = fieldCache.get(vol) ?? volumeFields(vol);
  fieldCache.set(vol, fields);
  const { h, label, dEpi, dIf } = fields;
  const dims = h.dims;
  const [nx, ny, nz] = dims;
  const vox = h.voxelMm;
  const M = meshFrame(h);
  const marks = atlasMarks(heart, endDiastole);
  const F = marks.frame;
  const k = marks.lvLength / M.far;
  const cls = (l: number): number => (l === FAT ? 1 : (LABELS[l]?.[0] ?? 0) + 2);

  const at = (i: number, j: number, kk: number): number => i + nx * (j + ny * kk);
  const clampI = (i: number, n: number): number => (i < 0 ? 0 : i >= n ? n - 1 : i);
  /** A gradient in mesh axes turned into the heart frame, unit, into `q`. */
  const toHeart = (gx: number, gy: number, gz: number, q: TissueSample): void => {
    const g: V3 = [gx, gy, gz];
    // mesh → anatomical frame → heart frame
    const a: V3 = [dot(g, M.ex), dot(g, M.ey), dot(g, M.ez)];
    const n: V3 = [
      a[0] * F.ex[0] + a[1] * F.ey[0] + a[2] * F.ez[0],
      a[0] * F.ex[1] + a[1] * F.ey[1] + a[2] * F.ez[1],
      a[0] * F.ex[2] + a[1] * F.ey[2] + a[2] * F.ez[2],
    ];
    const l = Math.hypot(...n);
    if (l === 0) {
      q.nx = 0;
      q.ny = 0;
      q.nz = 1;
      return;
    }
    q.nx = n[0] / l;
    q.ny = n[1] / l;
    q.nz = n[2] / l;
  };
  /** Outward normal of a smooth field (central differences). */
  const fieldNormal = (
    fld: Float32Array,
    i: number,
    j: number,
    kk: number,
    q: TissueSample,
  ): void =>
    toHeart(
      fld[at(clampI(i + 1, nx), j, kk)]! - fld[at(clampI(i - 1, nx), j, kk)]!,
      fld[at(i, clampI(j + 1, ny), kk)]! - fld[at(i, clampI(j - 1, ny), kk)]!,
      fld[at(i, j, clampI(kk + 1, nz))]! - fld[at(i, j, clampI(kk - 1, nz))]!,
      q,
    );
  /**
   * Normal of the interfaces around the voxel's tissue. Off the interface, the gradient of the distance to it (the
   * direction to the nearest interface, smooth: Euclidean). On the voxels that border it, where that distance has a kink
   * and no gradient, the Gaussian-weighted gradient of the indicator of the voxel's own class over ±NORMAL_REACH voxels:
   * a 3-voxel Sobel followed the staircase of an inclined surface and missed its normal by 10°. The volume is static:
   * each bordering voxel's normal is worked out once, in mesh axes, and kept.
   */
  const borderNormals = new Map<number, V3>();
  const classNormal = (i: number, j: number, kk: number, q: TissueSample): void => {
    const v = at(i, j, kk);
    if (dIf[v]! > vox) {
      fieldNormal(dIf, i, j, kk, q);
      return;
    }
    const kept = borderNormals.get(v);
    if (kept) {
      toHeart(kept[0], kept[1], kept[2], q);
      return;
    }
    const c = cls(label[v]!);
    let gx = 0,
      gy = 0,
      gz = 0;
    for (let w = -NORMAL_REACH; w <= NORMAL_REACH; w++)
      for (let u = -NORMAL_REACH; u <= NORMAL_REACH; u++)
        for (let t = -NORMAL_REACH; t <= NORMAL_REACH; t++) {
          const r2 = t * t + u * u + w * w;
          if (r2 === 0 || r2 > NORMAL_REACH * NORMAL_REACH) continue;
          const l = label[at(clampI(i + t, nx), clampI(j + u, ny), clampI(kk + w, nz))]!;
          if (cls(l) === c) continue;
          // the other tissue lies along +r: the outward normal points there
          const wt = Math.exp(-r2 / (2 * NORMAL_SIGMA * NORMAL_SIGMA));
          gx += wt * t;
          gy += wt * u;
          gz += wt * w;
        }
    borderNormals.set(v, [gx, gy, gz]);
    toHeart(gx, gy, gz, q);
  };

  // heart frame (cm) → anatomical frame (mm of the mesh) → grid (voxels); the last point mapped, in `g`
  const g = { ax: 0, ay: 0, az: 0, fi: 0, fj: 0, fk: 0 };
  const toGrid = (hx: number, hy: number, hz: number): void => {
    const d: V3 = [hx - F.origin[0], hy - F.origin[1], hz - F.origin[2]];
    g.ax = dot(d, F.ex) / k;
    g.ay = dot(d, F.ey) / k;
    g.az = dot(d, F.ez) / k;
    g.fi = (M.o[0] + g.ax * M.ex[0] + g.ay * M.ey[0] + g.az * M.ez[0] - h.origin[0]) / vox;
    g.fj = (M.o[1] + g.ax * M.ex[1] + g.ay * M.ey[1] + g.az * M.ez[1] - h.origin[1]) / vox;
    g.fk = (M.o[2] + g.ax * M.ex[2] + g.ay * M.ey[2] + g.az * M.ez[2] - h.origin[2]) / vox;
  };
  const labelAt = (hx: number, hy: number, hz: number): number => {
    toGrid(hx, hy, hz);
    const i = Math.floor(g.fi),
      j = Math.floor(g.fj),
      kk = Math.floor(g.fk);
    return i < 0 || j < 0 || kk < 0 || i >= nx || j >= ny || kk >= nz ? -1 : label[at(i, j, kk)]!;
  };

  const classifier =
    (apparatusPose?: HeartPose): HeartClassifier =>
    (hx, hy, hz, q) => {
      toGrid(hx, hy, hz);
      const { ax, ay, az, fi, fj, fk } = g;
      const i = Math.floor(fi),
        j = Math.floor(fj),
        kk = Math.floor(fk);
      q.segment = 0;
      q.transmural = -1;
      if (i < 0 || j < 0 || kk < 0 || i >= nx || j >= ny || kk >= nz) {
        // beyond the grid: its margin plus the way out to it
        const ox = Math.max(0, -fi, fi - nx),
          oy = Math.max(0, -fj, fj - ny),
          oz = Math.max(0, -fk, fk - nz);
        const ci = clampI(i, nx),
          cj = clampI(j, ny),
          ck = clampI(kk, nz);
        q.sdf = (dEpi[at(ci, cj, ck)]! + Math.hypot(ox, oy, oz) * vox) * k - PERICARDIUM_CM;
        return false;
      }
      const v = at(i, j, kk);
      const l = label[v]!;
      q.mx = hx;
      q.my = hy;
      q.mz = hz;
      q.extraReflect = 0;
      if (l === 0) {
        const de = dEpi[v]! * k;
        if (de >= PERICARDIUM_CM) {
          q.sdf = de - PERICARDIUM_CM;
          return false;
        }
        q.tissue = Tissue.Pericardium;
        q.structure = Structure.Pericardium;
        q.sdf = -Math.min(de, PERICARDIUM_CM - de);
        fieldNormal(dEpi, i, j, kk, q);
        return true;
      }
      // the analytic valve apparatus in the cavities; its sample stands as the analytic heart drew it
      if (
        apparatusPose &&
        APPARATUS_HOSTS.has(l) &&
        classifyHeart(heart, apparatusPose, hx, hy, hz, q) &&
        APPARATUS.has(q.structure)
      )
        return true;
      q.segment = 0;
      q.transmural = -1;
      q.mx = hx;
      q.my = hy;
      q.mz = hz;
      q.extraReflect = 0;
      const lab = l === FAT ? null : LABELS[l];
      if (l !== FAT && !lab) {
        q.sdf = PERICARDIUM_CM;
        return false;
      }
      q.tissue = lab ? lab[0] : Tissue.Fat;
      q.structure = lab ? lab[1] : Structure.EpicardialFat;
      if (l === 1) {
        // the LV wall by its sector around the long axis, the apex beyond 85 % of the length
        const phi = Math.atan2(ay, ax);
        q.structure =
          az > 0.85 * M.far
            ? Structure.LvApex
            : Math.abs(phi) < Math.PI / 4
              ? Structure.LvWallLateral
              : Math.abs(phi) > (3 * Math.PI) / 4
                ? Structure.LvWallSeptal
                : phi > 0
                  ? Structure.LvWallAnterior
                  : Structure.LvWallInferior;
      }
      q.sdf = -dIf[v]! * k;
      classNormal(i, j, kk, q);
      return true;
    };
  return { classifier, labelAt, cmPerMm: k };
}
