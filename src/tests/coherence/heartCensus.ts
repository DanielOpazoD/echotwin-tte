/**
 * Coherence census of the heart model (decision 331): on a 3D grid in the heart frame, every pair of structures that
 * touch (six-neighbour faces), and every island (a connected piece of one structure enclosed by another). A reviewer's
 * clean eyes: it asks nothing in particular, it lists what is there. The classifier only answers inside the heart;
 * everything outside is `None`.
 */
import { loadCaseById } from '@/cases';
import { SimulatorCore } from '@/simulator/core/simulatorCore';
import { baseInput } from '@/simulator/core/baseInput';
import { classifyHeart, computeHeartPose } from '@/simulator/anatomy/heartModel';
import { makeSample, Tissue } from '@/simulator/anatomy/tissue';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { STRUCTURE_NAME } from './structureNames';

const TISSUE_SHORT: Record<number, string> = {
  [Tissue.Blood]: 'blood',
  [Tissue.Myocardium]: 'myo',
  [Tissue.VesselWall]: 'wall',
  [Tissue.Fibrous]: 'fibrous',
  [Tissue.Valve]: 'valve',
  [Tissue.Fat]: 'fat',
  [Tissue.Pericardium]: 'pericardium',
  [Tissue.Fluid]: 'fluid',
  [Tissue.Chordae]: 'chordae',
  [Tissue.Calcium]: 'calcium',
};
/** A cell is a structure in a tissue: the aortic root's blood and its wall are different cells of the census. */
export const code = (structure: number, tissue: number): number => tissue * 64 + structure;
export const label = (c: number): string =>
  `${STRUCTURE_NAME[c % 64] ?? `#${c % 64}`}/${TISSUE_SHORT[Math.floor(c / 64)] ?? `t${Math.floor(c / 64)}`}`;

// the heart frame box: atria and great vessels above (z negative), the apex below (z positive), lateral x, anterior y
const X0 = -7.5,
  X1 = 7.5,
  Y0 = -8,
  Y1 = 6,
  Z0 = -9,
  Z1 = 11;

export interface Contact {
  a: number;
  b: number;
  faces: number;
  cm2: number;
  at: string;
}
export interface Island {
  structure: number;
  cells: number;
  ml: number;
  around: number;
  at: string;
}

export interface HeartCensus {
  contacts: Contact[];
  islands: Island[];
  cells: number;
}
/** The census of one case at one phase on a grid of `H` cm. */
export function heartCensus(id: string, phase: number, H: number): HeartCensus {
  const nx = Math.round((X1 - X0) / H) + 1,
    ny = Math.round((Y1 - Y0) / H) + 1,
    nz = Math.round((Z1 - Z0) / H) + 1;
  const c = loadCaseById(id);
  const { heart, tables } = new SimulatorCore(c, baseInput()).models;
  const pose = computeHeartPose(heart, cycleStateAt(tables, phase));
  const s = makeSample();
  const g = new Uint16Array(nx * ny * nz);
  const at = (i: number, j: number, k: number) => (i * ny + j) * nz + k;
  let cells = 0;
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++)
      for (let k = 0; k < nz; k++) {
        const hit = classifyHeart(heart, pose, X0 + i * H + pose.swingX, Y0 + j * H, Z0 + k * H, s);
        g[at(i, j, k)] = hit ? code(s.structure, s.tissue) : 0;
        if (hit) cells++;
      }
  // contacts: each unordered pair of different structures across a face, counted once
  const pairs = new Map<number, { faces: number; sx: number; sy: number; sz: number }>();
  const key = (a: number, b: number) => (a < b ? a * 4096 + b : b * 4096 + a);
  const bump = (a: number, b: number, i: number, j: number, k: number) => {
    if (a === b || a === 0 || b === 0) return;
    const e = pairs.get(key(a, b)) ?? { faces: 0, sx: 0, sy: 0, sz: 0 };
    e.faces++;
    e.sx += X0 + i * H;
    e.sy += Y0 + j * H;
    e.sz += Z0 + k * H;
    pairs.set(key(a, b), e);
  };
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++)
      for (let k = 0; k < nz; k++) {
        const v = g[at(i, j, k)]!;
        if (i + 1 < nx) bump(v, g[at(i + 1, j, k)]!, i, j, k);
        if (j + 1 < ny) bump(v, g[at(i, j + 1, k)]!, i, j, k);
        if (k + 1 < nz) bump(v, g[at(i, j, k + 1)]!, i, j, k);
      }
  const contacts: Contact[] = [...pairs].map(([kk, e]) => ({
    a: Math.floor(kk / 4096),
    b: kk % 4096,
    faces: e.faces,
    cm2: e.faces * H * H,
    at: `(${(e.sx / e.faces).toFixed(1)}, ${(e.sy / e.faces).toFixed(1)}, ${(e.sz / e.faces).toFixed(1)})`,
  }));
  contacts.sort((p, q) => q.faces - p.faces);
  // islands: connected components (6-neighbour) of each structure; a component is an island when every neighbour cell
  // outside it belongs to one other structure
  const seen = new Uint8Array(nx * ny * nz);
  const islands: Island[] = [];
  const stack: number[] = [];
  for (let start = 0; start < g.length; start++) {
    if (seen[start] || g[start] === 0) continue;
    const st = g[start]!;
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    let n = 0,
      sx = 0,
      sy = 0,
      sz = 0;
    const around = new Map<number, number>();
    while (stack.length) {
      const p = stack.pop()!;
      n++;
      const i = Math.floor(p / (ny * nz)),
        j = Math.floor((p % (ny * nz)) / nz),
        k = p % nz;
      sx += i;
      sy += j;
      sz += k;
      const nb = [
        i > 0 ? p - ny * nz : -1,
        i + 1 < nx ? p + ny * nz : -1,
        j > 0 ? p - nz : -1,
        j + 1 < ny ? p + nz : -1,
        k > 0 ? p - 1 : -1,
        k + 1 < nz ? p + 1 : -1,
      ];
      for (const q of nb) {
        if (q < 0) {
          around.set(-1, (around.get(-1) ?? 0) + 1);
          continue;
        }
        const w = g[q]!;
        if (w === st) {
          if (!seen[q]) {
            seen[q] = 1;
            stack.push(q);
          }
        } else around.set(w, (around.get(w) ?? 0) + 1);
      }
    }
    // the main body of a structure is not an island; a small piece wholly inside one other structure is
    const others = [...around].filter(([w]) => w !== -1 && w !== 0);
    const outside = around.get(-1) ?? 0;
    const none = around.get(0) ?? 0;
    if (n <= 4000 && others.length === 1 && outside === 0 && none === 0)
      islands.push({
        structure: st,
        cells: n,
        ml: n * H * H * H,
        around: others[0]![0],
        at: `(${(X0 + (sx / n) * H).toFixed(1)}, ${(Y0 + (sy / n) * H).toFixed(1)}, ${(Z0 + (sz / n) * H).toFixed(1)})`,
      });
  }
  islands.sort((p, q) => q.cells - p.cells);
  return { contacts, islands, cells };
}
