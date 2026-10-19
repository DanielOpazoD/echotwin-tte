/**
 * A heart read from a label volume (decision 346), for the CPU tracer's `Scene.heartClassifier`: the mean heart of Rodero
 * et al. 2021 voxelised by `rodero-voxelize.ts`, placed in the model's heart frame by the anatomical frame both share
 * (`atlasFrame.ts`: origin the mitral centre, z to the LV apex, x from the tricuspid centre to the mitral one, y toward the
 * aortic valve) and scaled so that its LV length is the model's. Static: the end-diastolic shape of the CT, no motion.
 *
 * What the mesh does not have is added the way the analytic heart draws it: the epicardial fat that fills the grooves
 * (the heart's silhouette closed with a ball of EPI_CLOSING_MM), the pericardium PERICARDIUM_CM outside it, and on a miss
 * the distance beyond the sac for the thorax. The atrioventricular valve planes are blood (end diastole, open) and the
 * semilunar ones closed valve. The vessels end where the CT segmentation cut them.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atlasMarks } from '@/simulator/anatomy/atlasFrame';
import { PERICARDIUM_CM } from '@/simulator/anatomy/classify/pericardium';
import type { HeartModel, HeartPose } from '@/simulator/anatomy/heartModel';
import { Structure, Tissue, type TissueSample } from '@/simulator/anatomy/tissue';
import type { HeartClassifier } from '@/simulator/renderer/types';

type V3 = [number, number, number];
interface Header {
  voxelMm: number;
  origin: V3;
  dims: V3;
  landmarks: Record<'mitral' | 'tricuspid' | 'aortic' | 'pulmonary' | 'apex', V3>;
}

/** Radius (mm, mesh scale) of the ball that closes the silhouette: what it adds outside the walls is epicardial fat. */
export const EPI_CLOSING_MM = 4;

/** Tissue and structure of each label of the volume (rodero-voxelize.ts); 0 and unknown labels are outside. */
const LABELS: Record<number, [Tissue, Structure]> = {
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
/** Fat filling the grooves: a label of its own in the runtime volume. */
const FAT = 254;

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
function meshFrame(h: Header): { o: V3; ex: V3; ey: V3; ez: V3; far: number } {
  const L = h.landmarks;
  const far = Math.hypot(...sub(L.apex, L.mitral));
  const ez = unit(sub(L.apex, L.mitral));
  let ex = sub(L.mitral, L.tricuspid);
  ex = unit(sub(ex, scale(ez, dot(ex, ez))));
  let ey = cross(ez, ex);
  if (dot(sub(L.aortic, L.mitral), ey) < 0) ey = scale(ey, -1);
  return { o: L.mitral, ex, ey, ez, far };
}

export interface VolumeHeart {
  classify: HeartClassifier;
  /** cm of the model per mm of the mesh. */
  cmPerMm: number;
}

/** The label volume in `dir` as a heart classifier in the frame of `heart` at pose `hp` (its end-diastolic pose). */
export function loadVolumeHeart(dir: string, heart: HeartModel, hp: HeartPose): VolumeHeart {
  const h = JSON.parse(readFileSync(join(dir, 'rodero-mean-labels.json'), 'utf8')) as Header;
  const label = new Uint8Array(readFileSync(join(dir, 'rodero-mean-labels.bin')));
  const dims = h.dims;
  const [nx, ny, nz] = dims;
  const vox = h.voxelMm;
  const M = meshFrame(h);
  const marks = atlasMarks(heart, hp);
  const F = marks.frame;
  const k = marks.lvLength / M.far;

  // epicardial fat: the silhouette closed with a ball (dilate, then erode), less the heart itself
  const r = EPI_CLOSING_MM / vox;
  const dOut = edt(dims, (v) => label[v] !== 0);
  const dIn = edt(dims, (v) => dOut[v]! > r);
  for (let v = 0; v < label.length; v++) if (label[v] === 0 && dIn[v]! > r) label[v] = FAT;
  // beyond the epicardium (heart or groove fat), in mm, for the pericardium and the thorax
  const dEpi = edt(dims, (v) => label[v] !== 0);
  for (let v = 0; v < dEpi.length; v++) dEpi[v] = dEpi[v]! * vox;
  // distance to the nearest interface between tissues, in mm, for the specular term and its normal
  const cls = (l: number): number => (l === FAT ? 1 : (LABELS[l]?.[0] ?? 0) + 2);
  const step = [1, -1, nx, -nx, nx * ny, -nx * ny];
  const dIf = edt(dims, (v) => {
    const c = cls(label[v]!);
    for (const s of step) {
      const w = v + s;
      if (w >= 0 && w < label.length && cls(label[w]!) !== c) return true;
    }
    return false;
  });
  for (let v = 0; v < dIf.length; v++) dIf[v] = dIf[v]! * vox;

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
   * Normal of the interface of the voxel's tissue: the Sobel gradient of the indicator of its own class, which on the
   * interface itself points out of it (a distance field to the interface has a kink there, and no gradient).
   */
  const classNormal = (i: number, j: number, kk: number, q: TissueSample): void => {
    const c = cls(label[at(i, j, kk)]!);
    const same = (a: number, b: number, e: number): number =>
      cls(label[at(clampI(a, nx), clampI(b, ny), clampI(e, nz))]!) === c ? 1 : 0;
    let gx = 0,
      gy = 0,
      gz = 0;
    for (let u = -1; u <= 1; u++)
      for (let w = -1; w <= 1; w++) {
        const wt = (2 - Math.abs(u)) * (2 - Math.abs(w));
        gx += wt * (same(i - 1, j + u, kk + w) - same(i + 1, j + u, kk + w));
        gy += wt * (same(i + u, j - 1, kk + w) - same(i + u, j + 1, kk + w));
        gz += wt * (same(i + u, j + w, kk - 1) - same(i + u, j + w, kk + 1));
      }
    toHeart(gx, gy, gz, q);
  };

  const classify: HeartClassifier = (hx, hy, hz, q) => {
    // heart frame (cm) → anatomical frame (mm of the mesh) → mesh (mm)
    const d: V3 = [hx - F.origin[0], hy - F.origin[1], hz - F.origin[2]];
    const ax = dot(d, F.ex) / k,
      ay = dot(d, F.ey) / k,
      az = dot(d, F.ez) / k;
    const mx = M.o[0] + ax * M.ex[0] + ay * M.ey[0] + az * M.ez[0];
    const my = M.o[1] + ax * M.ex[1] + ay * M.ey[1] + az * M.ez[1];
    const mz = M.o[2] + ax * M.ex[2] + ay * M.ey[2] + az * M.ez[2];
    const fi = (mx - h.origin[0]) / vox,
      fj = (my - h.origin[1]) / vox,
      fk = (mz - h.origin[2]) / vox;
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
  return { classify, cmPerMm: k };
}
