// @tier slow
import { describe, expect, it } from 'vitest';
import { CASE_INPUTS, loadCaseById } from '@/cases';
import { SimulatorCore } from '@/simulator/core/simulatorCore';
import { baseInput } from '@/simulator/core/baseInput';
import { classifyHeart, computeHeartPose } from '@/simulator/anatomy/heartModel';
import { makeSample, Structure } from '@/simulator/anatomy/tissue';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';

/**
 * The left ventricle's epicardium ends at its base (decision 380). The profile whose outer face the sac read closes
 * 2-2.5 cm above the mitral hinge, and where no atrium covered that cap the sac held it as fat: in the left
 * atrioventricular groove, beside the left atrium's lateral wall, a wedge 1-1.4 cm thick that the subcostal view drew
 * under the atrium. Counted here as the fat of the groove (within 1 cm of a ventricular wall) whose nearest wall, reached
 * through fat, is the left atrium's, at least DEEP_CM from it, away from the aortic root: 0.07-0.50 cm³ in the twelve
 * cases then, 0.01-0.12 now.
 */
const H = 0.15;
// the left atrium and the ventricular base in the heart frame
const X0 = -3,
  X1 = 7,
  Y0 = -7,
  Y1 = 6,
  Z0 = -7,
  Z1 = 4;
/** Fat this deep from the left atrium's wall, reached through fat. */
const DEEP_CM = 0.4;
/** Within this of a ventricular wall: the groove. */
const GROOVE_CM = 1;
/** Farther than this from the aortic root, where the ventricle's cap stays. */
const ROOT_FAR_CM = 1.5;
const MAX_CM3 = 0.2;

const VENTRICLE = new Set<number>([
  Structure.LvWallSeptal,
  Structure.LvWallLateral,
  Structure.LvWallAnterior,
  Structure.LvWallInferior,
  Structure.LvApex,
  Structure.RvWall,
]);
const WALLS = new Set<number>([...VENTRICLE, Structure.LaWall, Structure.RaWall]);
const ROOT = new Set<number>([Structure.AorticRoot, Structure.AscendingAorta]);

/** cm³ of groove fat owned by the left atrium's wall at least DEEP_CM from it, away from the root. */
function grooveFatOffLa(id: string, phase: number): number {
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
  const fat = (v: number) => st[v] === Structure.EpicardialFat;
  // breadth-first distance in cells from a set of seeds through the cells `pass` lets in, carrying the seed's structure
  const spread = (seed: (v: number) => boolean, pass: (v: number) => boolean) => {
    const d = new Int32Array(n).fill(-1);
    const owner = new Int16Array(n).fill(-1);
    let front: number[] = [];
    for (let v = 0; v < n; v++)
      if (seed(v)) {
        d[v] = 0;
        owner[v] = st[v]!;
        front.push(v);
      }
    while (front.length) {
      const next: number[] = [];
      for (const v of front)
        for (const o of steps) {
          const w = v + o;
          if (w < 0 || w >= n || d[w]! >= 0 || !pass(w)) continue;
          d[w] = d[v]! + 1;
          owner[w] = owner[v]!;
          next.push(w);
        }
      front = next;
    }
    return { d, owner };
  };
  const walls = spread((v) => WALLS.has(st[v]!), fat);
  const ventricle = spread(
    (v) => VENTRICLE.has(st[v]!),
    () => true,
  ).d;
  const root = spread(
    (v) => ROOT.has(st[v]!),
    () => true,
  ).d;
  let cells = 0;
  for (let v = 0; v < n; v++)
    if (
      fat(v) &&
      walls.owner[v] === Structure.LaWall &&
      walls.d[v]! * H >= DEEP_CM &&
      ventricle[v]! >= 0 &&
      ventricle[v]! * H <= GROOVE_CM &&
      (root[v]! < 0 || root[v]! * H > ROOT_FAR_CM)
    )
      cells++;
  return cells * H ** 3;
}

describe('the left ventricle’s epicardium ends at its base, so no wedge of fat stands beside the left atrium (decision 380)', () => {
  for (const { id } of CASE_INPUTS)
    for (const phase of [0, 0.35])
      it(`${id} @${phase}`, () => {
        expect(grooveFatOffLa(id, phase)).toBeLessThan(MAX_CM3);
      });
});
