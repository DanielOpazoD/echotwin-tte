/**
 * Phase 1 of the reconstruction (docs/RECONSTRUCCION.md, decision 346): the mean four-chamber heart of Rodero et al. 2021
 * (statistical shape model of 20 healthy CTs, Zenodo 4593739, CC BY 4.0) turned into a label volume.
 *
 * The mesh has the myocardium of the four chambers, the walls of the aorta and the pulmonary artery, the four valve planes
 * and the rings and caps of the seven inlets as tetrahedra tagged by region; the cavities are not meshed. Here the tetrahedra
 * are rasterised on a regular grid, the outside is flood-filled from the grid's border, and what stays enclosed are the
 * cavities, each named by the wall it mostly touches. Output: a label volume (one byte per voxel) and its header, written
 * outside git (the source data never enters the repository; the volume is derived and reproducible).
 *
 *   RODERO_VTK=~/Desktop/echotwin-data/rodero-2021-ssm/raw/average.vtk \
 *   ANATOMY2_OUT=~/Desktop/echotwin-data/anatomy2 npx tsx tools/offline/anatomy2/rodero-voxelize.ts [voxelMm]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Region tags of the mesh, identified by position and size (the dataset ships no legend). */
export const RODERO_REGIONS: Record<number, string> = {
  1: 'lv-myocardium',
  2: 'rv-myocardium',
  3: 'la-wall',
  4: 'ra-wall',
  5: 'aorta-wall',
  6: 'pa-wall',
  7: 'mitral-plane',
  8: 'tricuspid-plane',
  9: 'aortic-plane',
  10: 'pulmonary-plane',
};
/** Labels of the volume: 0 outside, 1–24 the mesh regions, 30+ the enclosed cavities (30 + the wall they touch most). */
export const CAVITY_BASE = 30;

const vtkPath = process.env['RODERO_VTK'];
const outDir = process.env['ANATOMY2_OUT'];
if (!vtkPath || !outDir) throw new Error('set RODERO_VTK and ANATOMY2_OUT');
const voxel = Number(process.argv[2] ?? '0.5');

const text = readFileSync(vtkPath, 'utf8');
const lines = text.split('\n');
const at = (prefix: string): number => lines.findIndex((l) => l.startsWith(prefix));
const ip = at('POINTS');
const nPts = Number(lines[ip]!.split(/\s+/)[1]);
const pts = new Float32Array(nPts * 3);
for (let i = 0; i < nPts; i++) {
  const v = lines[ip + 1 + i]!.trim().split(/\s+/);
  pts[3 * i] = Number(v[0]);
  pts[3 * i + 1] = Number(v[1]);
  pts[3 * i + 2] = Number(v[2]);
}
const ic = at('CELLS');
const nCells = Number(lines[ic]!.trim().split(/\s+/)[1]);
const tets = new Int32Array(nCells * 4);
for (let i = 0; i < nCells; i++) {
  const v = lines[ic + 1 + i]!.trim().split(/\s+/);
  if (v[0] !== '4') throw new Error(`cell ${i} is not a tetrahedron`);
  for (let k = 0; k < 4; k++) tets[4 * i + k] = Number(v[1 + k]);
}
const iid = at('SCALARS ID') + 2;
const tag = new Uint8Array(nCells);
for (let i = 0; i < nCells; i++) tag[i] = Number(lines[iid + i]);

// landmarks of the anatomical frame (atlasFrame.ts): the centres of the valve planes (centroids of their tetrahedra's
// vertices) and the LV apex, the LV myocardium point farthest from the mitral centre
const centre = (t: number): number[] => {
  const s: [number, number, number] = [0, 0, 0];
  let n = 0;
  for (let c = 0; c < nCells; c++) {
    if (tag[c] !== t) continue;
    for (let k = 0; k < 4; k++) {
      const v = tets[4 * c + k]!;
      s[0] += pts[3 * v]!;
      s[1] += pts[3 * v + 1]!;
      s[2] += pts[3 * v + 2]!;
      n++;
    }
  }
  return s.map((x) => x / n);
};
const mitral = centre(7);
let apex = mitral,
  far = -1;
for (let c = 0; c < nCells; c++) {
  if (tag[c] !== 1) continue;
  for (let k = 0; k < 4; k++) {
    const v = tets[4 * c + k]!;
    const p = [pts[3 * v]!, pts[3 * v + 1]!, pts[3 * v + 2]!];
    const d = Math.hypot(p[0]! - mitral[0]!, p[1]! - mitral[1]!, p[2]! - mitral[2]!);
    if (d > far) {
      far = d;
      apex = p;
    }
  }
}
const landmarks = { mitral, tricuspid: centre(8), aortic: centre(9), pulmonary: centre(10), apex };

// the grid: the mesh's bounding box with a 6 mm margin
let lo = [Infinity, Infinity, Infinity],
  hi = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < nPts; i++)
  for (let k = 0; k < 3; k++) {
    lo[k] = Math.min(lo[k]!, pts[3 * i + k]!);
    hi[k] = Math.max(hi[k]!, pts[3 * i + k]!);
  }
lo = lo.map((v) => v - 6);
hi = hi.map((v) => v + 6);
const dims = [0, 1, 2].map((k) => Math.ceil((hi[k]! - lo[k]!) / voxel));
const [nx, ny, nz] = dims as [number, number, number];
const label = new Uint8Array(nx * ny * nz);
const idx = (i: number, j: number, k: number): number => i + nx * (j + ny * k);
// a wall wins over a plane, a plane over a ring or cap
const rank = (t: number): number => (t <= 6 ? 3 : t <= 10 ? 2 : 1);

// rasterise each tetrahedron: voxel centres inside by barycentric coordinates
for (let c = 0; c < nCells; c++) {
  const p = [0, 1, 2, 3].map((k) => tets[4 * c + k]!);
  const P = p.map((v) => [pts[3 * v]!, pts[3 * v + 1]!, pts[3 * v + 2]!]);
  const mn = [0, 1, 2].map((k) => Math.min(P[0]![k]!, P[1]![k]!, P[2]![k]!, P[3]![k]!));
  const mx = [0, 1, 2].map((k) => Math.max(P[0]![k]!, P[1]![k]!, P[2]![k]!, P[3]![k]!));
  const i0 = Math.max(0, Math.floor((mn[0]! - lo[0]!) / voxel - 0.5)),
    i1 = Math.min(nx - 1, Math.ceil((mx[0]! - lo[0]!) / voxel - 0.5));
  const j0 = Math.max(0, Math.floor((mn[1]! - lo[1]!) / voxel - 0.5)),
    j1 = Math.min(ny - 1, Math.ceil((mx[1]! - lo[1]!) / voxel - 0.5));
  const k0 = Math.max(0, Math.floor((mn[2]! - lo[2]!) / voxel - 0.5)),
    k1 = Math.min(nz - 1, Math.ceil((mx[2]! - lo[2]!) / voxel - 0.5));
  // T = [P1-P0, P2-P0, P3-P0]; solve T·b = x - P0
  const a = P[0]!;
  const e1 = [0, 1, 2].map((k) => P[1]![k]! - a[k]!),
    e2 = [0, 1, 2].map((k) => P[2]![k]! - a[k]!),
    e3 = [0, 1, 2].map((k) => P[3]![k]! - a[k]!);
  const det =
    e1[0]! * (e2[1]! * e3[2]! - e2[2]! * e3[1]!) -
    e2[0]! * (e1[1]! * e3[2]! - e1[2]! * e3[1]!) +
    e3[0]! * (e1[1]! * e2[2]! - e1[2]! * e2[1]!);
  if (Math.abs(det) < 1e-12) continue;
  const t = tag[c]!;
  for (let k = k0; k <= k1; k++)
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const x = lo[0]! + (i + 0.5) * voxel - a[0]!,
          y = lo[1]! + (j + 0.5) * voxel - a[1]!,
          z = lo[2]! + (k + 0.5) * voxel - a[2]!;
        // Cramer's rule
        const b1 =
          (x * (e2[1]! * e3[2]! - e2[2]! * e3[1]!) -
            e2[0]! * (y * e3[2]! - z * e3[1]!) +
            e3[0]! * (y * e2[2]! - z * e2[1]!)) /
          det;
        const b2 =
          (e1[0]! * (y * e3[2]! - z * e3[1]!) -
            x * (e1[1]! * e3[2]! - e1[2]! * e3[1]!) +
            e3[0]! * (e1[1]! * z - e1[2]! * y)) /
          det;
        const b3 =
          (e1[0]! * (e2[1]! * z - e2[2]! * y) -
            e2[0]! * (e1[1]! * z - e1[2]! * y) +
            x * (e1[1]! * e2[2]! - e1[2]! * e2[1]!)) /
          det;
        const eps = 1e-6;
        if (b1 < -eps || b2 < -eps || b3 < -eps || b1 + b2 + b3 > 1 + eps) continue;
        const v = idx(i, j, k);
        const cur = label[v]!;
        if (!cur || rank(t) > rank(cur)) label[v] = t;
      }
}

// outside: flood fill from the grid's border through unlabelled voxels (6-neighbours)
const OUT = 255;
const queue = new Int32Array(nx * ny * nz);
let qh = 0,
  qt = 0;
const seed = (v: number): void => {
  if (label[v] === 0) {
    label[v] = OUT;
    queue[qt++] = v;
  }
};
for (let k = 0; k < nz; k++)
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++)
      if (i === 0 || j === 0 || k === 0 || i === nx - 1 || j === ny - 1 || k === nz - 1)
        seed(idx(i, j, k));
const step = [1, -1, nx, -nx, nx * ny, -nx * ny];
while (qh < qt) {
  const v = queue[qh++]!;
  const i = v % nx,
    j = Math.floor(v / nx) % ny,
    k = Math.floor(v / (nx * ny));
  for (let s = 0; s < 6; s++) {
    if ((s === 0 && i === nx - 1) || (s === 1 && i === 0)) continue;
    if ((s === 2 && j === ny - 1) || (s === 3 && j === 0)) continue;
    if ((s === 4 && k === nz - 1) || (s === 5 && k === 0)) continue;
    seed(v + step[s]!);
  }
}

// cavities: the enclosed unlabelled components, each named by the wall (1–6) its border touches most
const comp = new Int32Array(nx * ny * nz).fill(-1);
const report: { label: number; voxels: number; ml: number; touches: Record<number, number> }[] = [];
let nComp = 0;
for (let v0 = 0; v0 < label.length; v0++) {
  if (label[v0] !== 0 || comp[v0]! >= 0) continue;
  qh = qt = 0;
  queue[qt++] = v0;
  comp[v0] = nComp;
  const members: number[] = [];
  const touch: Record<number, number> = {};
  while (qh < qt) {
    const v = queue[qh++]!;
    members.push(v);
    for (const s of step) {
      const w = v + s;
      if (w < 0 || w >= label.length) continue;
      const l = label[w]!;
      if (l === 0 && comp[w]! < 0) {
        comp[w] = nComp;
        queue[qt++] = w;
      } else if (l > 0 && l <= 24) touch[l] = (touch[l] ?? 0) + 1;
    }
  }
  const walls = Object.entries(touch)
    .filter(([t]) => Number(t) <= 6)
    .sort((x, y) => y[1] - x[1]);
  const wall = walls.length ? Number(walls[0]![0]) : 0;
  const lab = CAVITY_BASE + wall;
  for (const v of members) label[v] = lab;
  report.push({
    label: lab,
    voxels: members.length,
    ml: (members.length * voxel ** 3) / 1000,
    touches: touch,
  });
  nComp++;
}
// the lumens of the aorta and the pulmonary artery: the vessels are open tubes (no distal cap), so the flood above reaches
// into them. A voxel of the outside is lumen when rays in nearly every direction meet that vessel's wall or its valve plane:
// in a tube only the rays along the axis escape. VESSEL_MIN_HITS of the 26 directions within VESSEL_RAY_MM.
const VESSEL_MIN_HITS = 20;
const VESSEL_RAY_MM = 40;
const dirs: [number, number, number][] = [];
for (let a = -1; a <= 1; a++)
  for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) if (a || b || c) dirs.push([a, b, c]);
const vesselOf = (l: number): number => (l === 5 || l === 9 ? 5 : l === 6 || l === 10 ? 6 : 0);
const vbLo = [nx, ny, nz],
  vbHi = [0, 0, 0];
for (let k = 0; k < nz; k++)
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const l = label[idx(i, j, k)]!;
      if (l !== 5 && l !== 6) continue;
      vbLo[0] = Math.min(vbLo[0]!, i);
      vbLo[1] = Math.min(vbLo[1]!, j);
      vbLo[2] = Math.min(vbLo[2]!, k);
      vbHi[0] = Math.max(vbHi[0]!, i);
      vbHi[1] = Math.max(vbHi[1]!, j);
      vbHi[2] = Math.max(vbHi[2]!, k);
    }
const maxSteps = Math.round(VESSEL_RAY_MM / voxel);
const lumen = new Uint8Array(label.length);
const lumenMl = { 5: 0, 6: 0 } as Record<number, number>;
for (let k = vbLo[2]!; k <= vbHi[2]!; k++)
  for (let j = vbLo[1]!; j <= vbHi[1]!; j++)
    for (let i = vbLo[0]!; i <= vbHi[0]!; i++) {
      if (label[idx(i, j, k)] !== OUT) continue;
      const votes = [0, 0, 0, 0, 0, 0, 0];
      let misses = 0;
      for (const [a, b, c] of dirs) {
        let hit = 0;
        for (let s = 1; s <= maxSteps; s++) {
          const ii = i + a * s,
            jj = j + b * s,
            kk = k + c * s;
          if (ii < 0 || jj < 0 || kk < 0 || ii >= nx || jj >= ny || kk >= nz) break;
          const l = label[idx(ii, jj, kk)]!;
          if (l === OUT) continue;
          hit = vesselOf(l);
          break;
        }
        if (hit) votes[hit]!++;
        else if (++misses > dirs.length - VESSEL_MIN_HITS) break;
      }
      if (misses > dirs.length - VESSEL_MIN_HITS) continue;
      const w = votes[5]! >= votes[6]! ? 5 : 6;
      lumen[idx(i, j, k)] = CAVITY_BASE + w;
      lumenMl[w]! += voxel ** 3 / 1000;
    }
for (let v = 0; v < label.length; v++) if (lumen[v]) label[v] = lumen[v]!;
report.push(
  { label: CAVITY_BASE + 5, voxels: 0, ml: lumenMl[5]!, touches: { 5: -1 } },
  { label: CAVITY_BASE + 6, voxels: 0, ml: lumenMl[6]!, touches: { 6: -1 } },
);
for (let v = 0; v < label.length; v++) if (label[v] === OUT) label[v] = 0;

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'rodero-mean-labels.bin'), label);
const header = {
  source:
    'Rodero et al. 2021, PLoS Comput Biol 17:e1008851; Zenodo 4593739 average.vtk (CC BY 4.0)',
  units: 'mm, mesh (CT) coordinates',
  voxelMm: voxel,
  origin: lo,
  dims,
  regions: RODERO_REGIONS,
  landmarks,
  cavityBase: CAVITY_BASE,
  cavities: report
    .sort((a, b) => b.voxels - a.voxels)
    .map(({ label: l, ml, touches }) => ({ label: l, ml: Number(ml.toFixed(1)), touches })),
};
writeFileSync(join(outDir, 'rodero-mean-labels.json'), JSON.stringify(header, null, 1));
const counts = new Map<number, number>();
for (const l of label) counts.set(l, (counts.get(l) ?? 0) + 1);
console.info(`grid ${dims.join('×')} at ${voxel} mm; cavities ${report.length}`);
for (const c of header.cavities.slice(0, 12))
  console.info(`  cavity label ${c.label}: ${c.ml} mL, touches ${JSON.stringify(c.touches)}`);
console.info(
  'wall volumes (mL): ' +
    [1, 2, 3, 4, 5, 6]
      .map((t) => `${RODERO_REGIONS[t]} ${(((counts.get(t) ?? 0) * voxel ** 3) / 1000).toFixed(1)}`)
      .join(', '),
);
