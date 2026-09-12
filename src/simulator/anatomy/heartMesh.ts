import type { HeartModel, HeartPose } from './heartModel';
import { classifyHeart } from './heartModel';
import { makeSample, Structure, Tissue } from './tissue';

/**
 * Surface meshes of the heart, extracted from the same implicit model the ultrasound beam cuts
 * (`classifyHeart`). The 3D navigator therefore cannot drift from the image: both read one anatomy.
 *
 * Extraction is naive surface nets over an occupancy grid: one vertex per cell that straddles the
 * surface, placed at the average of the cube edges that cross it, quads across every sign-changing edge,
 * then a couple of Laplacian passes. No lookup tables, deterministic, and smooth enough for a navigator.
 */
export interface MeshGroup {
  id: string;
  label: string;
  color: number;
  opacity: number;
  positions: Float32Array;
  /** Per-vertex normals, area-weighted from the triangles: the only rule that survives a one-cell wall. */
  normals: Float32Array;
  indices: Uint32Array;
}

export interface HeartMeshOptions {
  /** Grid spacing in cm (0.3 is ~0.4 s and plenty for a navigator; 0.2 is finer and ~3× slower). */
  stepCm?: number;
  /** Extraction bounds in the heart frame (cm). */
  bounds?: { min: [number, number, number]; max: [number, number, number] };
  smoothing?: number;
}

type GroupSpec = { id: string; label: string; color: number; opacity: number; has: (s: Structure, t: Tissue) => boolean };

const isLvWall = (s: Structure): boolean =>
  s === Structure.LvWallSeptal || s === Structure.LvWallLateral || s === Structure.LvWallAnterior || s === Structure.LvWallInferior || s === Structure.LvApex;

/** Groups the navigator can show or hide independently. */
export const MESH_GROUPS: GroupSpec[] = [
  { id: 'lv-myocardium', label: 'Miocardio VI', color: 0xc4534f, opacity: 1, has: (s) => isLvWall(s) || s === Structure.PapillaryMuscle },
  { id: 'rv-myocardium', label: 'Miocardio VD', color: 0x9a5f8a, opacity: 1, has: (s) => s === Structure.RvWall || s === Structure.ModeratorBand || s === Structure.RvPapillary },
  { id: 'lv-cavity', label: 'Cavidad VI', color: 0x8f2b2b, opacity: 0.55, has: (s) => s === Structure.LvCavity || s === Structure.Lvot },
  { id: 'rv-cavity', label: 'Cavidad VD', color: 0x3c4a8f, opacity: 0.5, has: (s) => s === Structure.RvCavity || s === Structure.Rvot },
  { id: 'atria', label: 'Aurículas', color: 0x7a4a7a, opacity: 0.5, has: (s) => s === Structure.LaCavity || s === Structure.RaCavity || s === Structure.LaWall || s === Structure.RaWall || s === Structure.LaAppendage },
  { id: 'valves', label: 'Válvulas', color: 0xf2e08a, opacity: 1, has: (s, t) => t === Tissue.Valve || s === Structure.Chordae || s === Structure.MitralAnnulus || s === Structure.TricuspidAnnulus },
  { id: 'great-vessels', label: 'Grandes vasos', color: 0xcf6a6a, opacity: 0.7, has: (s) => s === Structure.AorticRoot || s === Structure.PulmonaryArtery || s === Structure.Svc || s === Structure.Ivc || s === Structure.PulmonaryVein || s === Structure.CoronarySinus },
];

const DEFAULT_BOUNDS = { min: [-8, -7, -7] as [number, number, number], max: [7, 8, 12] as [number, number, number] };

export function buildHeartMeshes(heart: HeartModel, pose: HeartPose, opts: HeartMeshOptions = {}): MeshGroup[] {
  const step = opts.stepCm ?? 0.35;
  const b = opts.bounds ?? DEFAULT_BOUNDS;
  const nx = Math.ceil((b.max[0] - b.min[0]) / step) + 1;
  const ny = Math.ceil((b.max[1] - b.min[1]) / step) + 1;
  const nz = Math.ceil((b.max[2] - b.min[2]) / step) + 1;
  // one classification pass for every group: the structure id per grid point
  const ids = new Uint8Array(nx * ny * nz);
  const tissues = new Uint8Array(nx * ny * nz);
  const s = makeSample();
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const x = b.min[0] + i * step,
          y = b.min[1] + j * step,
          z = b.min[2] + k * step;
        if (!classifyHeart(heart, pose, x, y, z, s)) continue;
        const o = (k * ny + j) * nx + i;
        ids[o] = s.structure;
        tissues[o] = s.tissue;
      }
  return MESH_GROUPS.map((g) => surfaceNet(g, ids, tissues, nx, ny, nz, b.min, step, opts.smoothing ?? 2));
}

function surfaceNet(g: GroupSpec, ids: Uint8Array, tissues: Uint8Array, nx: number, ny: number, nz: number, min: [number, number, number], step: number, smoothing: number): MeshGroup {
  const inside = new Uint8Array(nx * ny * nz);
  for (let o = 0; o < ids.length; o++) inside[o] = g.has(ids[o] as Structure, tissues[o] as Tissue) ? 1 : 0;
  const at = (i: number, j: number, k: number): number => inside[(k * ny + j) * nx + i] ?? 0;
  const cellVertex = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const pos: number[] = [];
  const cellIndex = (i: number, j: number, k: number): number => (k * (ny - 1) + j) * (nx - 1) + i;
  for (let k = 0; k < nz - 1; k++)
    for (let j = 0; j < ny - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        let count = 0;
        for (let dk = 0; dk < 2; dk++) for (let dj = 0; dj < 2; dj++) for (let di = 0; di < 2; di++) if (at(i + di, j + dj, k + dk)) count++;
        if (count === 0 || count === 8) continue; // fully outside or fully inside: no surface here
        // the vertex belongs on the surface, so it is the average of the cube edges that cross it. Averaging the
        // inside corners instead drops it onto a corner wherever the wall is one cell thick, and the shell comes
        // out corrugated along the grid.
        let cx = 0,
          cy = 0,
          cz = 0,
          crossings = 0;
        for (let dk = 0; dk < 2; dk++)
          for (let dj = 0; dj < 2; dj++)
            for (let di = 0; di < 2; di++) {
              const here = at(i + di, j + dj, k + dk);
              if (di === 0 && here !== at(i + 1, j + dj, k + dk)) {
                cx += 0.5;
                cy += dj;
                cz += dk;
                crossings++;
              }
              if (dj === 0 && here !== at(i + di, j + 1, k + dk)) {
                cx += di;
                cy += 0.5;
                cz += dk;
                crossings++;
              }
              if (dk === 0 && here !== at(i + di, j + dj, k + 1)) {
                cx += di;
                cy += dj;
                cz += 0.5;
                crossings++;
              }
            }
        if (!crossings) continue;
        cellVertex[cellIndex(i, j, k)] = pos.length / 3;
        pos.push(min[0] + (i + cx / crossings) * step, min[1] + (j + cy / crossings) * step, min[2] + (k + cz / crossings) * step);
      }
  // quads across every edge whose endpoints differ, built from the four cells sharing that edge
  const idx: number[] = [];
  const vertexAt = (i: number, j: number, k: number): number => {
    if (i < 0 || j < 0 || k < 0 || i >= nx - 1 || j >= ny - 1 || k >= nz - 1) return -1;
    const v = cellVertex[cellIndex(i, j, k)];
    return v === undefined ? -1 : v;
  };
  const quad = (a: number, b2: number, c: number, d: number, flip: boolean): void => {
    if (a < 0 || b2 < 0 || c < 0 || d < 0) return;
    if (flip) idx.push(a, c, b2, a, d, c);
    else idx.push(a, b2, c, a, c, d);
  };
  for (let k = 1; k < nz - 1; k++)
    for (let j = 1; j < ny - 1; j++)
      for (let i = 1; i < nx - 1; i++) {
        const here = at(i, j, k);
        if (here !== at(i + 1, j, k)) quad(vertexAt(i, j - 1, k - 1), vertexAt(i, j, k - 1), vertexAt(i, j, k), vertexAt(i, j - 1, k), here === 0);
        if (here !== at(i, j + 1, k)) quad(vertexAt(i - 1, j, k - 1), vertexAt(i, j, k - 1), vertexAt(i, j, k), vertexAt(i - 1, j, k), here !== 0);
        if (here !== at(i, j, k + 1)) quad(vertexAt(i - 1, j - 1, k), vertexAt(i, j - 1, k), vertexAt(i, j, k), vertexAt(i - 1, j, k), here === 0);
      }
  const positions = new Float32Array(pos);
  smooth(positions, idx, smoothing);
  const normals = vertexNormals(positions, idx);
  smoothNormals(normals, idx, 2);
  return { id: g.id, label: g.label, color: g.color, opacity: g.opacity, positions, normals, indices: new Uint32Array(idx) };
}

/**
 * Area-weighted normals from the triangles themselves.
 *
 * These used to come from the gradient of the occupancy field, which is well defined only where the
 * structure is several cells thick. Across a wall one or two cells wide the smoothed field rises and falls
 * again, so the central difference subtracts two samples on the *same* side of the wall and collapses.
 * Measured on the normal case at 0.28 cm, the median gradient magnitude was 0.71 on the LV wall (median 6
 * cells thick) but 0.50 on the RV wall (2 cells) and 0.12 on the valves (1 cell), with a quarter of the RV
 * vertices under 0.32 — those normals are ridge noise, and they shaded as a lattice of dark patches on
 * exactly the thin groups. Sampling the gradient at the vertex's true position rather than the nearest grid
 * point does not help; the ridge is real, not a rounding artefact.
 *
 * Geometric normals do not care how thick the wall is. They do inherit the winding of each quad, which is
 * why the field was used at first, but the winding has since been measured against the gradient wherever
 * the gradient is trustworthy: 100% agreement over 16 790 vertices, in all six groups that have any. The
 * handful of vertices whose triangles cancel exactly are folds of a one-cell sheet, where no normal is
 * meaningful anyway.
 */
function vertexNormals(positions: Float32Array, indices: number[]): Float32Array {
  const out = new Float32Array(positions.length);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]! * 3,
      b = indices[t + 1]! * 3,
      c = indices[t + 2]! * 3;
    const ux = positions[b]! - positions[a]!,
      uy = positions[b + 1]! - positions[a + 1]!,
      uz = positions[b + 2]! - positions[a + 2]!;
    const vx = positions[c]! - positions[a]!,
      vy = positions[c + 1]! - positions[a + 1]!,
      vz = positions[c + 2]! - positions[a + 2]!;
    // the cross product is twice the triangle area, so accumulating it unnormalised weights by area
    const nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    for (const o of [a, b, c]) {
      out[o] = out[o]! + nx;
      out[o + 1] = out[o + 1]! + ny;
      out[o + 2] = out[o + 2]! + nz;
    }
  }
  for (let v = 0; v < out.length; v += 3) {
    const len = Math.hypot(out[v]!, out[v + 1]!, out[v + 2]!);
    if (len < 1e-12) {
      out[v + 2] = 1; // a fold with no surface: any unit vector will do, and there are ~19 of them
      continue;
    }
    out[v] = out[v]! / len;
    out[v + 1] = out[v + 1]! / len;
    out[v + 2] = out[v + 2]! / len;
  }
  return out;
}

/**
 * Two passes of neighbourhood averaging over the normals.
 *
 * Surface nets gives one vertex per straddling cell, so where a wall is as thin as the cell that vertex
 * serves *both* of its surfaces: the triangles of the outer and the inner face meet there with opposing
 * normals, which cancel, and the result shades as a black facet. Measured on the normal case, the fraction
 * of vertices whose triangle normals cancel is 2.3% of the RV wall and 11.4% of the valves at 0.28 cm, and
 * a finer grid does not remove it — 1.2% at 0.22 cm, 0.9% at 0.15 cm for four times the extraction cost,
 * with the valves flat at 11-15% because a 0.18 cm leaflet is one cell thick at every step. The folds are
 * few and isolated, though, so each one is surrounded by vertices whose normals are sound; averaging over
 * the neighbourhood pulls it back to the local surface, which is what the eye expects on a thin shell.
 * The cost is slightly softer creases, which a navigator can afford.
 */
function smoothNormals(normals: Float32Array, indices: number[], passes: number): void {
  if (!passes || !indices.length) return;
  const n = normals.length / 3;
  const sum = new Float32Array(n * 3);
  for (let p = 0; p < passes; p++) {
    sum.set(normals);
    for (let t = 0; t < indices.length; t += 3)
      for (let e = 0; e < 3; e++) {
        const a = indices[t + e]!,
          b = indices[t + ((e + 1) % 3)]!;
        for (const [from, to] of [
          [a, b],
          [b, a],
        ] as const) {
          const fi = from * 3,
            ti = to * 3;
          sum[fi] = sum[fi]! + normals[ti]!;
          sum[fi + 1] = sum[fi + 1]! + normals[ti + 1]!;
          sum[fi + 2] = sum[fi + 2]! + normals[ti + 2]!;
        }
      }
    for (let v = 0; v < n; v++) {
      const len = Math.hypot(sum[v * 3]!, sum[v * 3 + 1]!, sum[v * 3 + 2]!);
      if (len < 1e-12) continue; // a whole neighbourhood that cancels: keep what it had
      for (let c = 0; c < 3; c++) normals[v * 3 + c] = sum[v * 3 + c]! / len;
    }
  }
}

/** Laplacian smoothing over the triangle adjacency (keeps the cast recognisable, removes the stair steps). */
function smooth(positions: Float32Array, indices: number[], passes: number): void {
  if (!passes || !indices.length) return;
  const n = positions.length / 3;
  const sum = new Float32Array(n * 3);
  const deg = new Uint16Array(n);
  for (let p = 0; p < passes; p++) {
    sum.fill(0);
    deg.fill(0);
    for (let t = 0; t < indices.length; t += 3)
      for (let e = 0; e < 3; e++) {
        const a = indices[t + e]!,
          b = indices[t + ((e + 1) % 3)]!;
        for (const [from, to] of [
          [a, b],
          [b, a],
        ] as const) {
          const fi = from * 3,
            ti = to * 3;
          sum[fi] = (sum[fi] ?? 0) + (positions[ti] ?? 0);
          sum[fi + 1] = (sum[fi + 1] ?? 0) + (positions[ti + 1] ?? 0);
          sum[fi + 2] = (sum[fi + 2] ?? 0) + (positions[ti + 2] ?? 0);
          deg[from] = (deg[from] ?? 0) + 1;
        }
      }
    for (let v = 0; v < n; v++) {
      const d = deg[v]!;
      if (!d) continue;
      for (let c = 0; c < 3; c++) positions[v * 3 + c] = positions[v * 3 + c]! * 0.5 + (sum[v * 3 + c]! / d) * 0.5;
    }
  }
}
