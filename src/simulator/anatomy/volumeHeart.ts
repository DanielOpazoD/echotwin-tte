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
import { heartAnchors } from './anchors';
import { makeSample } from './tissue';
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
  // the rims of the atrioventricular planes against the walls: the fibrous annuli (decision 350)
  37: [Tissue.Fibrous, Structure.MitralAnnulus],
  38: [Tissue.Fibrous, Structure.TricuspidAnnulus],
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
/**
 * Rotation of the LV at end-systole (degrees, positive counterclockwise seen from the apex), at its base and its apex,
 * linear in between: Kocabay et al. 2014 (healthy adults by speckle tracking, base −6.9 ± 3.5°, apex +13.0 ± 6.5°).
 */
export const TWIST_BASE_DEG = -6.9;
export const TWIST_APEX_DEG = 13.0;
/** Height of the slices of the motion tables (cm), and their angular sectors around the LV slice's centre. */
const SLICE_CM = 0.25;
const SECTORS = 36;
/** Width (cm) of the band beyond the LV epicardium over which the LV's radial motion and twist fade out. */
const LV_FADE_CM = 1.5;
/** Septal → lateral coordinate (cm) over which the base's descent goes from MAPSE (LV side) to TAPSE (RV free wall). */
const RV_DESCENT_FROM_CM = -1.5;
const RV_DESCENT_TO_CM = -3.5;
/**
 * Reach (mm, mesh scale) of the fibrous annuli from the walls into the atrioventricular planes: the radii of the analytic
 * heart's annular tori (mitral 0.11 cm, tricuspid 0.09 cm). Without them the plane is cavity up to the wall, and the
 * contour that measures longitudinal strain from the annulus (`endocardialContour`) ran on down the closed leaflets.
 */
export const MITRAL_ANNULUS_MM = 1.1;
export const TRICUSPID_ANNULUS_MM = 0.9;
/** Walls an annulus may lie against: the four chambers' myocardium and the aortic wall (the aortomitral curtain). */
const ANNULUS_WALLS = new Set([1, 2, 3, 4, 5]);
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
/** The parts of the apparatus that move with the analytic valves: leaflets and chords. */
const LEAFLETS = new Set<Structure>([
  Structure.MitralAnterior,
  Structure.MitralPosterior,
  Structure.TricuspidValve,
  Structure.Chordae,
]);
/** Labels of the volume that are cavity blood the apparatus may occupy: the AV valve planes and the four chambers. */
export const APPARATUS_HOSTS = new Set([7, 8, 31, 32, 33, 34]);

/** The labels of each atrium's tissue: left (cavity, wall, the pulmonary veins' and appendage's caps and rings), right. */
const ATRIAL_TISSUE = [
  new Set([33, 3, 11, 12, 13, 14, 15, 18, 19, 20, 21, 22]),
  new Set([34, 4, 16, 17, 23, 24]),
];
/** Voxels of each atrium's cavity over which the radial scale that gives its volume is solved. */
const ATRIAL_SAMPLES = 4000;
/** Grid (cm) on which the analytic atria are counted. */
const ATRIAL_GRID_CM = 0.25;
const atrialCache = new WeakMap<HeartPose, { la: number; ra: number }>();
/**
 * Volumes (mL) of the analytic heart's left and right atrial cavities at `pose`, counted on a grid of ATRIAL_GRID_CM
 * around each atrium: the curves the volume's atria follow (decision 350).
 */
export function analyticAtrialVolumes(
  heart: HeartModel,
  pose: HeartPose,
): { la: number; ra: number } {
  const kept = atrialCache.get(pose);
  if (kept) return kept;
  const A = heartAnchors(heart);
  const q = makeSample();
  const count = (
    c: { x: number; y: number; z: number },
    r: { x: number; y: number; z: number },
    want: Structure,
  ) => {
    let n = 0;
    const h = ATRIAL_GRID_CM;
    for (let x = c.x - r.x - 1.5; x <= c.x + r.x + 1.5; x += h)
      for (let y = c.y - r.y - 1.5; y <= c.y + r.y + 1.5; y += h)
        for (let z = c.z - r.z - 2; z <= c.z + r.z + 2; z += h)
          if (classifyHeart(heart, pose, x + pose.swingX, y, z, q) && q.structure === want) n++;
    return n * h ** 3;
  };
  const v = {
    la: count(A.laCenter, A.laR, Structure.LaCavity),
    ra: count(A.raCenter, A.raR, Structure.RaCavity),
  };
  atrialCache.set(pose, v);
  return v;
}

export interface VolumeHeartOptions {
  /**
   * The analytic heart's pose whose leaflets and chords are drawn in the volume's cavities. Its papillary muscles and
   * moderator band are those of `motion.endDiastole` carried with the walls when the volume moves, of this pose when not.
   */
  apparatus?: HeartPose;
  /** The cycle's pose that moves the volume (decision 350), and the end-diastolic pose the volume stands for. */
  motion?: { pose: HeartPose; endDiastole: HeartPose };
}

/** A point carried back to end diastole, in the anatomical frame (cm), and the twist (rad) that carried it. */
export interface ReferencePoint {
  x: number;
  y: number;
  z: number;
  twist: number;
}

export interface VolumeHeart {
  /** The volume's heart: static at end diastole, or moved by `motion`; with the analytic valve apparatus if asked. */
  classifier(options?: VolumeHeartOptions): HeartClassifier;
  /**
   * The backward map of the motion at `pose` (decision 350): where the tissue now at anatomical point (x, y, z) (cm) lay
   * at end diastole. Identity at end diastole.
   */
  toReference(
    pose: HeartPose,
    endDiastole: HeartPose,
  ): (x: number, y: number, z: number, out: ReferencePoint) => void;
  /**
   * The LV cross-sections of the volume at end diastole, every SLICE_CM from the mitral centre: the cavity's centre and,
   * per sector of 360°/SECTORS around it, the endocardial and epicardial radii of the sector's area (cm; slice-major).
   */
  lvSlices: { cx: Float64Array; cy: Float64Array; rEndo: Float64Array; rEpi: Float64Array };
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
  // the fibrous annuli: the voxels of the mitral (7) and tricuspid (8) planes within reach of a wall
  {
    const nz = dims[2];
    const at = (i: number, j: number, k: number): number => i + nx * (j + ny * k);
    const rim: [number, number][] = [];
    for (let k = 0; k < nz; k++)
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) {
          const l = label[at(i, j, k)]!;
          if (l !== 7 && l !== 8) continue;
          const reach = (l === 7 ? MITRAL_ANNULUS_MM : TRICUSPID_ANNULUS_MM) / vox;
          const n = Math.ceil(reach);
          let near = false;
          for (let w = -n; w <= n && !near; w++)
            for (let u = -n; u <= n && !near; u++)
              for (let t = -n; t <= n && !near; t++) {
                if (t * t + u * u + w * w > reach * reach) continue;
                const a = i + t,
                  b = j + u,
                  c = k + w;
                if (a < 0 || b < 0 || c < 0 || a >= nx || b >= ny || c >= nz) continue;
                if (ANNULUS_WALLS.has(label[at(a, b, c)]!)) near = true;
              }
          if (near) rim.push([at(i, j, k), l === 7 ? 37 : 38]);
        }
    for (const [v, l] of rim) label[v] = l;
  }
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
  /** The twist (rad) of the sample being classified, applied to its normal. */
  let normalTwist = 0;
  /** Material coordinates: where the tissue lay at end diastole, so the speckle moves with it. */
  const setMaterial = (q: TissueSample, x: number, y: number, z: number): void => {
    q.segment = 0;
    q.transmural = -1;
    q.mx = x;
    q.my = y;
    q.mz = z;
    q.extraReflect = 0;
  };
  /** A gradient in mesh axes turned into the heart frame, unit, into `q`. */
  const toHeart = (gx: number, gy: number, gz: number, q: TissueSample): void => {
    const g: V3 = [gx, gy, gz];
    // mesh → anatomical frame → heart frame
    const a0 = dot(g, M.ex),
      a1 = dot(g, M.ey);
    // turned with the twist that carried the tissue here (about the anatomical z)
    const ct = Math.cos(normalTwist),
      st = Math.sin(normalTwist);
    const a: V3 = [a0 * ct - a1 * st, a0 * st + a1 * ct, dot(g, M.ez)];
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

  // ---- motion (decision 350): geometry of the volume at end diastole, in the anatomical frame (cm) ----
  const L = marks.lvLength;
  const nSlices = Math.ceil(L / SLICE_CM) + 1;
  const voxCm3 = (vox * k) ** 3;
  /** Every voxel of the labels asked, in the anatomical frame (cm). */
  const eachVoxel = (
    want: Set<number>,
    f: (l: number, x: number, y: number, z: number) => void,
  ): void => {
    for (let kk = 0; kk < nz; kk++)
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) {
          const l = label[at(i, j, kk)]!;
          if (!want.has(l)) continue;
          const m: V3 = [
            h.origin[0] + (i + 0.5) * vox - M.o[0],
            h.origin[1] + (j + 0.5) * vox - M.o[1],
            h.origin[2] + (kk + 0.5) * vox - M.o[2],
          ];
          f(l, dot(m, M.ex) * k, dot(m, M.ey) * k, dot(m, M.ez) * k);
        }
  };
  const sliceOf = (z: number): number => Math.round(z / SLICE_CM);
  // first pass: the cavities' centres per slice (LV, RV) and per atrium, and the atrial roof
  const cnt = { lv: new Float64Array(nSlices), rv: new Float64Array(nSlices) };
  const sum = {
    lvx: new Float64Array(nSlices),
    lvy: new Float64Array(nSlices),
    rvx: new Float64Array(nSlices),
    rvy: new Float64Array(nSlices),
  };
  const atria = [
    { cav: 33, n: 0, x: 0, y: 0, cx: 0, cy: 0, r: 0 },
    { cav: 34, n: 0, x: 0, y: 0, cx: 0, cy: 0, r: 0 },
  ];
  let zRoof = 0;
  eachVoxel(new Set([31, 32, 3, 4, 33, 34]), (l, x, y, z) => {
    const si = sliceOf(z);
    if (l === 31 || l === 32) {
      if (si < 0 || si >= nSlices) return;
      if (l === 31) {
        cnt.lv[si]!++;
        sum.lvx[si]! += x;
        sum.lvy[si]! += y;
      } else {
        cnt.rv[si]!++;
        sum.rvx[si]! += x;
        sum.rvy[si]! += y;
      }
      return;
    }
    zRoof = Math.min(zRoof, z);
    for (const a2 of atria)
      if (l === a2.cav) {
        a2.n++;
        a2.x += x;
        a2.y += y;
      }
  });
  const centre = (n: Float64Array, sx: Float64Array, sy: Float64Array) => {
    const cx = new Float64Array(nSlices),
      cy = new Float64Array(nSlices);
    let last = -1;
    for (let si = 0; si < nSlices; si++)
      if (n[si]! > 0) {
        cx[si] = sx[si]! / n[si]!;
        cy[si] = sy[si]! / n[si]!;
        if (last < 0) for (let t = 0; t < si; t++) [cx[t], cy[t]] = [cx[si]!, cy[si]!];
        last = si;
      } else if (last >= 0) [cx[si], cy[si]] = [cx[last]!, cy[last]!];
    return { cx, cy };
  };
  const lvC = centre(cnt.lv, sum.lvx, sum.lvy);
  const rvC = centre(cnt.rv, sum.rvx, sum.rvy);
  for (const a2 of atria) {
    a2.cx = a2.x / Math.max(1, a2.n);
    a2.cy = a2.y / Math.max(1, a2.n);
  }
  // second pass: the LV's sector areas around its slice centre, the RV's radius, the atria's reach
  const secCav = new Float64Array(nSlices * SECTORS),
    secMyo = new Float64Array(nSlices * SECTORS);
  const rvArea = new Float64Array(nSlices);
  const atrialDist: number[][] = [[], []];
  const atrialZ: number[][] = [[], []];
  eachVoxel(new Set([1, 31, 32, 33, 34]), (l, x, y, z) => {
    if (l === 33 || l === 34) {
      const a2 = atria[l - 33]!;
      atrialDist[l - 33]!.push(Math.hypot(x - a2.cx, y - a2.cy));
      atrialZ[l - 33]!.push(z);
      return;
    }
    const si = sliceOf(z);
    if (si < 0 || si >= nSlices) return;
    if (l === 32) {
      rvArea[si]! += voxCm3 / SLICE_CM;
      return;
    }
    const th = Math.atan2(y - lvC.cy[si]!, x - lvC.cx[si]!);
    const ti = (Math.floor(((th + Math.PI) / (2 * Math.PI)) * SECTORS) + SECTORS) % SECTORS;
    (l === 31 ? secCav : secMyo)[si * SECTORS + ti]! += voxCm3 / SLICE_CM;
  });
  for (let a = 0; a < 2; a++) {
    const d = [...atrialDist[a]!].sort((p, q) => p - q);
    atria[a]!.r = d.length ? d[Math.floor(0.9 * (d.length - 1))]! : 1;
  }
  // radii of the sectors' areas (a wedge of angle Δθ and area a: r = √(2a/Δθ)), smoothed over the neighbouring sectors
  // and slices so that the noise of the voxels does not ripple the wall
  const dth = (2 * Math.PI) / SECTORS;
  const rawEndo = new Float64Array(nSlices * SECTORS),
    rawEpi = new Float64Array(nSlices * SECTORS);
  for (let c = 0; c < rawEndo.length; c++) {
    rawEndo[c] = Math.sqrt((2 * secCav[c]!) / dth);
    rawEpi[c] = Math.sqrt((2 * (secCav[c]! + secMyo[c]!)) / dth);
  }
  const smoothTable = (t: Float64Array): Float64Array => {
    const o = new Float64Array(t.length);
    for (let si = 0; si < nSlices; si++)
      for (let ti = 0; ti < SECTORS; ti++) {
        let acc = 0,
          wsum = 0;
        for (let ds = -1; ds <= 1; ds++)
          for (let dt = -1; dt <= 1; dt++) {
            const s2 = si + ds;
            if (s2 < 0 || s2 >= nSlices) continue;
            const w = (2 - Math.abs(ds)) * (2 - Math.abs(dt));
            acc += w * t[s2 * SECTORS + ((ti + dt + SECTORS) % SECTORS)]!;
            wsum += w;
          }
        o[si * SECTORS + ti] = acc / wsum;
      }
    return o;
  };
  const lvSlices = {
    cx: lvC.cx,
    cy: lvC.cy,
    rEndo: smoothTable(rawEndo),
    rEpi: smoothTable(rawEpi),
  };
  const rvR = Float64Array.from(rvArea, (a) => Math.sqrt(a / Math.PI));
  const slice = (z: number, t: Float64Array): number => {
    const f = Math.min(nSlices - 1, Math.max(0, z / SLICE_CM));
    const i0 = Math.floor(f),
      i1 = Math.min(nSlices - 1, i0 + 1);
    return t[i0]! + (t[i1]! - t[i0]!) * (f - i0);
  };
  /** A sector table at height z and angle th, interpolated in both. */
  const sector = (z: number, th: number, t: Float64Array): number => {
    const f = Math.min(nSlices - 1, Math.max(0, z / SLICE_CM));
    const i0 = Math.floor(f),
      i1 = Math.min(nSlices - 1, i0 + 1);
    const g2 = ((th + Math.PI) / dth - 0.5 + SECTORS) % SECTORS;
    const t0 = Math.floor(g2),
      t1 = (t0 + 1) % SECTORS,
      ft = g2 - t0;
    const at2 = (si: number): number =>
      t[si * SECTORS + t0]! + (t[si * SECTORS + t1]! - t[si * SECTORS + t0]!) * ft;
    return at2(i0) + (at2(i1) - at2(i0)) * (f - i0);
  };
  const smooth = (e0: number, e1: number, x: number): number => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  /** The atrial radial motion's weight at height z and normalised distance d (distance over the atrium's reach). */
  const atrialWeight = (z: number, d: number, r: number): number =>
    smooth(0.5, -0.5, z) * (1 - smooth(1, 1 + 1 / r, d));
  /**
   * How much the atrium's cavity grows in cross-section under a radial scale `sc` with the weights the map applies: the
   * mean of the area element's change (1 + (sc − 1)w)(1 + (sc − 1)(w + d·w′)) over a sample of its voxels.
   */
  const atrialSamples = atria.map((a2, i) => {
    const d = atrialDist[i]!,
      z = atrialZ[i]!;
    const stride = Math.max(1, Math.floor(d.length / ATRIAL_SAMPLES));
    const out: [number, number][] = [];
    for (let n = 0; n < d.length; n += stride) out.push([d[n]! / a2.r, z[n]!]);
    return out;
  });
  const areaRatio = (i: number, sc: number): number => {
    const r = atria[i]!.r,
      pts = atrialSamples[i]!;
    if (!pts.length) return 1;
    let m = 0;
    for (const [d, z] of pts) {
      const w = atrialWeight(z, d, r);
      const dw = (atrialWeight(z, d + 1e-3, r) - atrialWeight(z, d - 1e-3, r)) / 2e-3;
      m += (1 + (sc - 1) * w) * (1 + (sc - 1) * (w + d * dw));
    }
    return m / pts.length;
  };
  /** The radial scale that makes the atrium's cross-section grow by `target`, by bisection. */
  const atrialScaleFor = (i: number, target: number): number => {
    let lo = 0.5,
      hi = 2.5;
    for (let it = 0; it < 30; it++) {
      const mid = (lo + hi) / 2;
      if (areaRatio(i, mid) < target) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  // right-handed heart frame: positive twist turns from x (lateral) toward y (anterior) seen from the apex
  const det3 = (a: V3, b: V3, c: V3): number => dot(a, cross(b, c));
  const hand = Math.sign(det3(F.ex, F.ey, F.ez)) || 1;

  /** The volume's label at an anatomical point (cm); −1 beyond the grid. */
  const labelAtAnat = (x: number, y: number, z: number): number => {
    const ax = x / k,
      ay = y / k,
      az = z / k;
    const i = Math.floor((M.o[0] + ax * M.ex[0] + ay * M.ey[0] + az * M.ez[0] - h.origin[0]) / vox);
    const j = Math.floor((M.o[1] + ax * M.ex[1] + ay * M.ey[1] + az * M.ez[1] - h.origin[1]) / vox);
    const kk = Math.floor(
      (M.o[2] + ax * M.ex[2] + ay * M.ey[2] + az * M.ez[2] - h.origin[2]) / vox,
    );
    return i < 0 || j < 0 || kk < 0 || i >= nx || j >= ny || kk >= nz ? -1 : label[at(i, j, kk)]!;
  };
  const toReference = (
    pose: HeartPose,
    ed: HeartPose,
  ): ((x: number, y: number, z: number, out: ReferencePoint) => void) => {
    const sL = pose.zAnn - ed.zAnn;
    const sR = pose.tvZ - ed.tvZ;
    const lambda = 1 - sL / L;
    const alpha = Math.max(0, 1 - pose.state.lvVolumeMl / pose.state.edvMl);
    const twist = pose.state.contraction * hand * (Math.PI / 180);
    const roof = Math.min(-0.5, zRoof);
    // each atrium follows the volume curve of the analytic atrium: the volume's longitudinal step already stretches it
    // by 1 + s/|roof|, and the radial scale does the rest
    const vNow = analyticAtrialVolumes(heart, pose),
      vEd = analyticAtrialVolumes(heart, ed);
    const ratios = [vNow.la / vEd.la, vNow.ra / vEd.ra];
    const atrialScales = atria.map((a2, i) => {
      // the longitudinal step stretches the atrium above the annular plane by 1 + s/|roof| and compresses what of it lies
      // below the plane (the right atrium reaches below the mitral centre) by 1 − s/L: its mean over the atrium's voxels
      const sA = sL + (sR - sL) * smooth(RV_DESCENT_FROM_CM, RV_DESCENT_TO_CM, a2.cx);
      const pts = atrialSamples[i]!;
      let stretch = 0;
      for (const [, z] of pts) stretch += z < 0 ? 1 + sA / -roof : 1 - sA / L;
      stretch = pts.length ? stretch / pts.length : 1;
      return atrialScaleFor(i, ratios[i]! / stretch);
    });
    const rvRatio = pose.rvScale / ed.rvScale;
    return (x, y, z, out) => {
      // the LV's radial motion and twist, in the cross-section, toward the slice's centre
      // (the longitudinal step leaves x and y alone, so the slice is found by undoing it first)
      const s0 = sL + (sR - sL) * smooth(RV_DESCENT_FROM_CM, RV_DESCENT_TO_CM, x);
      const zr =
        z >= L || z <= roof ? z : z >= s0 ? (z - s0) / (1 - s0 / L) : (z - s0) / (1 + s0 / -roof);
      let px = x,
        py = y,
        rot = 0,
        lvReach = 0;
      const wz = smooth(-1, 0, zr);
      if (wz > 0) {
        const cx = slice(zr, lvSlices.cx),
          cy = slice(zr, lvSlices.cy);
        const dx = x - cx,
          dy = y - cy;
        const rNow = Math.hypot(dx, dy);
        // the sector the point lies in now: the twist turns the tissue by at most a sector or two
        const th0 = Math.atan2(dy, dx);
        const re = sector(zr, th0, lvSlices.rEndo),
          rp = sector(zr, th0, lvSlices.rEpi);
        const A = alpha * re * re;
        const rEpiNow = Math.sqrt(Math.max(0, rp * rp - A) / lambda);
        lvReach = 1 - smooth(rEpiNow, rEpiNow + LV_FADE_CM, rNow);
        const w = wz * lvReach;
        if (w > 0) {
          const r = rNow + (Math.sqrt(lambda * rNow * rNow + A) - rNow) * w;
          const zeta = Math.min(1, Math.max(0, zr / L));
          rot = -twist * (TWIST_BASE_DEG + (TWIST_APEX_DEG - TWIST_BASE_DEG) * zeta) * w;
          const th = Math.atan2(dy, dx) + rot;
          const f = rNow > 1e-9 ? r : 0;
          px = cx + f * Math.cos(th);
          py = cy + f * Math.sin(th);
        }
      }
      // the RV free wall's inward motion (the model's RV scale) toward the RV's slice centre, outside the LV's reach
      if (wz > 0 && rvRatio !== 1 && lvReach < 1) {
        const rcx = slice(zr, rvC.cx),
          rcy = slice(zr, rvC.cy),
          rr = slice(zr, rvR);
        if (rr > 0) {
          const d = Math.hypot(px - rcx, py - rcy) / rr;
          const w = wz * (1 - lvReach) * (1 - smooth(1.6, 2.4, d));
          if (w > 0) {
            const sc = 1 + (rvRatio - 1) * w;
            px = rcx + (px - rcx) / sc;
            py = rcy + (py - rcy) / sc;
          }
        }
      }
      // the atria: their reservoir and booster, radial about each atrium's axis, above the annulus. A point belongs to the
      // atrium whose own scaling carries it back onto that atrium's tissue (the left first); elsewhere to the nearer one,
      // by distance over each one's reach. By distance alone the larger right atrium took the left's septal side and
      // scaled it about its own axis: the left grew 1.15 times where 1.26 was asked.
      const wa = smooth(0.5, -0.5, zr);
      if (wa > 0 && (atria[0]!.n || atria[1]!.n)) {
        const back = (ai: number): [number, number] => {
          const a2 = atria[ai]!;
          const d = Math.hypot(px - a2.cx, py - a2.cy) / a2.r;
          const w = atrialWeight(zr, d, a2.r);
          const sc = 1 + (atrialScales[ai]! - 1) * w;
          return [a2.cx + (px - a2.cx) / sc, a2.cy + (py - a2.cy) / sc];
        };
        let chosen: [number, number] | null = null;
        for (let ai = 0; ai < atria.length && !chosen; ai++) {
          if (!atria[ai]!.n) continue;
          const c = back(ai);
          if (ATRIAL_TISSUE[ai]!.has(labelAtAnat(c[0], c[1], zr))) chosen = c;
        }
        if (!chosen) {
          let best = Infinity,
            ai = 0;
          for (let a = 0; a < atria.length; a++) {
            if (!atria[a]!.n) continue;
            const d = Math.hypot(px - atria[a]!.cx, py - atria[a]!.cy) / atria[a]!.r;
            if (d < best) {
              best = d;
              ai = a;
            }
          }
          chosen = back(ai);
        }
        px = chosen[0];
        py = chosen[1];
      }
      out.x = px;
      out.y = py;
      out.z = zr;
      out.twist = rot;
    };
  };

  // the anatomical frame (cm) of a heart-frame point, and back
  const toAnat = (hx: number, hy: number, hz: number, o: V3): void => {
    const d: V3 = [hx - F.origin[0], hy - F.origin[1], hz - F.origin[2]];
    o[0] = dot(d, F.ex);
    o[1] = dot(d, F.ey);
    o[2] = dot(d, F.ez);
  };
  const toHeartPoint = (a: ReferencePoint, o: V3): void => {
    for (let c = 0; c < 3; c++)
      o[c] = F.origin[c]! + a.x * F.ex[c]! + a.y * F.ey[c]! + a.z * F.ez[c]!;
  };

  const classifier = (options: VolumeHeartOptions = {}): HeartClassifier => {
    const back = options.motion
      ? toReference(options.motion.pose, options.motion.endDiastole)
      : null;
    const papPose = options.motion ? options.motion.endDiastole : options.apparatus;
    const cur: V3 = [0, 0, 0],
      refH: V3 = [0, 0, 0];
    const ref: ReferencePoint = { x: 0, y: 0, z: 0, twist: 0 };
    return (hx, hy, hz, q) => {
      let rx = hx,
        ry = hy,
        rz = hz;
      if (back) {
        toAnat(hx, hy, hz, cur);
        back(cur[0], cur[1], cur[2], ref);
        toHeartPoint(ref, refH);
        rx = refH[0];
        ry = refH[1];
        rz = refH[2];
        normalTwist = -ref.twist;
      } else normalTwist = 0;
      toGrid(rx, ry, rz);
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
      if (l === 0) {
        const de = dEpi[v]! * k;
        if (de >= PERICARDIUM_CM) {
          q.sdf = de - PERICARDIUM_CM;
          return false;
        }
        setMaterial(q, rx, ry, rz);
        q.tissue = Tissue.Pericardium;
        q.structure = Structure.Pericardium;
        q.sdf = -Math.min(de, PERICARDIUM_CM - de);
        fieldNormal(dEpi, i, j, kk, q);
        return true;
      }
      // the analytic valve apparatus in the cavities: leaflets and chords where the analytic heart has them now, the
      // papillary muscles and the moderator band carried with the walls from end diastole
      if (APPARATUS_HOSTS.has(l)) {
        if (
          options.apparatus &&
          classifyHeart(heart, options.apparatus, hx, hy, hz, q) &&
          APPARATUS.has(q.structure) &&
          (!back || LEAFLETS.has(q.structure))
        )
          return true;
        if (
          back &&
          papPose &&
          classifyHeart(heart, papPose, rx, ry, rz, q) &&
          APPARATUS.has(q.structure) &&
          !LEAFLETS.has(q.structure)
        )
          return true;
      }
      setMaterial(q, rx, ry, rz);
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
  };
  return { classifier, toReference, lvSlices, labelAt, cmPerMm: k };
}
