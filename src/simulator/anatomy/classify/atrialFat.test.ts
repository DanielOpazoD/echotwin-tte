// @tier slow
import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { SimulatorCore } from '@/simulator/core/simulatorCore';
import { baseInput } from '@/simulator/core/baseInput';
import { classifyHeart, computeHeartPose } from '@/simulator/anatomy/heartModel';
import { makeSample, Structure } from '@/simulator/anatomy/tissue';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';

/**
 * The fat over the atria's free walls (decision 378): the sac lies on each atrium's own wall, so away from the
 * ventricles (beyond the atrioventricular groove) the epicardial fat over an atrium is a thin layer. The right atrium's
 * outer face was its anchor ellipsoid at its largest size, and the left's its ellipsoid before the clips: 8-10 cm³ of fat
 * over the right atrium of every case, 4 mm thick at the median and up to 1.6 cm, and 11.5 cm³ over the dilated left
 * atrium of the HFrEF. Counted here as the fat 4 mm or more from its atrium's wall: 3.2-7.3 cm³ over the right atrium
 * then and 0.05-0.8 now; over the left atrium of the HFrEF 3.8-7.1 then and 0.8-1.1 now (1.9 in the normal heart).
 */
const H = 0.15;
// the atria in the heart frame: above the annuli (z negative), the right atrium at negative x
const X0 = -8,
  X1 = 5,
  Y0 = -6,
  Y1 = 5,
  Z0 = -8,
  Z1 = 2;
/** Fat this deep from the atrium's wall, reached through fat. */
const DEEP_CM = 0.4;
/** Farther than this from every ventricular wall: not the atrioventricular groove. */
const FREE_CM = 1;

const VENTRICLE = new Set<number>([
  Structure.LvWallSeptal,
  Structure.LvWallLateral,
  Structure.LvWallAnterior,
  Structure.LvWallInferior,
  Structure.RvWall,
]);
const WALLS = new Set<number>([...VENTRICLE, Structure.LaWall, Structure.RaWall]);

/** cm³ of epicardial fat at least `DEEP_CM` from each atrium's wall and `FREE_CM` from the ventricles. */
function deepFreeFat(id: string, phase: number): { ra: number; la: number } {
  const nx = Math.round((X1 - X0) / H) + 1,
    ny = Math.round((Y1 - Y0) / H) + 1,
    nz = Math.round((Z1 - Z0) / H) + 1;
  const { heart, tables } = new SimulatorCore(loadCaseById(id), baseInput()).models;
  const pose = computeHeartPose(heart, cycleStateAt(tables, phase));
  const s = makeSample();
  const n = nx * ny * nz;
  const st = new Int16Array(n);
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++)
      for (let k = 0; k < nz; k++) {
        const hit = classifyHeart(heart, pose, X0 + i * H + pose.swingX, Y0 + j * H, Z0 + k * H, s);
        st[(i * ny + j) * nz + k] = hit ? s.structure : -1;
      }
  const steps = [ny * nz, -ny * nz, nz, -nz, 1, -1];
  // breadth-first distance in cells from a set of seeds, through cells `pass` lets in
  const spread = (seed: (v: number) => boolean, pass: (v: number) => boolean): Int32Array => {
    const d = new Int32Array(n).fill(-1);
    let front: number[] = [];
    for (let v = 0; v < n; v++)
      if (seed(v)) {
        d[v] = 0;
        front.push(v);
      }
    while (front.length) {
      const next: number[] = [];
      for (const v of front)
        for (const o of steps) {
          const w = v + o;
          if (w < 0 || w >= n || d[w]! >= 0 || !pass(w)) continue;
          d[w] = d[v]! + 1;
          next.push(w);
        }
      front = next;
    }
    return d;
  };
  const fat = (v: number) => st[v] === Structure.EpicardialFat;
  const ventricle = spread(
    (v) => VENTRICLE.has(st[v]!),
    () => true,
  );
  // each cell of fat belongs to the nearest wall, reached through fat
  const owner = new Int16Array(n).fill(-1);
  const depth = new Int32Array(n).fill(-1);
  let front: number[] = [];
  for (let v = 0; v < n; v++)
    if (WALLS.has(st[v]!)) {
      owner[v] = st[v]!;
      depth[v] = 0;
      front.push(v);
    }
  while (front.length) {
    const next: number[] = [];
    for (const v of front)
      for (const o of steps) {
        const w = v + o;
        if (w < 0 || w >= n || depth[w]! >= 0 || !fat(w)) continue;
        depth[w] = depth[v]! + 1;
        owner[w] = owner[v]!;
        next.push(w);
      }
    front = next;
  }
  const volume = (wall: number): number => {
    let cells = 0;
    for (let v = 0; v < n; v++)
      if (
        owner[v] === wall &&
        fat(v) &&
        depth[v]! * H >= DEEP_CM &&
        (ventricle[v]! < 0 || ventricle[v]! * H > FREE_CM)
      )
        cells++;
    return cells * H ** 3;
  };
  return { ra: volume(Structure.RaWall), la: volume(Structure.LaWall) };
}

describe('the epicardial fat over the atria is a thin layer away from the grooves (decision 378)', () => {
  for (const [id, phase] of [
    ['normal-excellent-window', 0.59],
    ['hfref-severe-mr', 0],
    ['hfref-severe-mr', 0.59],
  ] as const)
    it(`${id} @${phase}`, () => {
      const v = deepFreeFat(id, phase);
      expect(v.ra).toBeLessThan(1.5);
      expect(v.la).toBeLessThan(2.5);
    });
});
