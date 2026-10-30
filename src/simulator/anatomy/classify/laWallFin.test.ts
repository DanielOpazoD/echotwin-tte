// @tier slow
import { describe, expect, it } from 'vitest';
import { CASE_INPUTS, loadCaseById } from '@/cases';
import { SimulatorCore } from '@/simulator/core/simulatorCore';
import { baseInput } from '@/simulator/core/baseInput';
import { classifyHeart, computeHeartPose } from '@/simulator/anatomy/heartModel';
import { makeSample, Structure } from '@/simulator/anatomy/tissue';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';

/**
 * The left atrium's wall wraps its blood (decision 381). The lateral wall's fill of decision 366 narrows to the body's
 * centre at its top and, unbounded above it, stood there as a sheet of zero width: its wall, a fin 4 mm thick and 2 cm
 * wide, rose over the roof with no blood on either side, and the subcostal view drew it as a pink line under the atrium.
 * Counted here as left atrial wall farther than FAR_CM from any left atrial blood (chessboard distance, never more than
 * the true one): 0.01-2.5 cm³ in the twelve cases then, none now.
 */
const H = 0.15;
const X0 = -4,
  X1 = 6,
  Y0 = -6,
  Y1 = 5,
  Z0 = -8,
  Z1 = 3;
const FAR_CM = 0.5;
const MAX_CM3 = 0.1;

const BLOOD = new Set<number>([Structure.LaCavity, Structure.LaAppendage, Structure.PulmonaryVein]);

/** cm³ of left atrial wall farther than FAR_CM from left atrial blood. */
function wallFarFromBlood(id: string, phase: number): number {
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
  // breadth-first over the 26 neighbours from the blood, out to the wall's limit
  const d = new Int32Array(n).fill(-1);
  let front: number[] = [];
  for (let v = 0; v < n; v++)
    if (BLOOD.has(st[v]!)) {
      d[v] = 0;
      front.push(v);
    }
  const reach = Math.ceil(FAR_CM / H);
  for (let r = 1; r <= reach && front.length; r++) {
    const next: number[] = [];
    for (const v of front) {
      const i = Math.floor(v / (ny * nz)),
        j = Math.floor(v / nz) % ny,
        k = v % nz;
      for (let di = -1; di <= 1; di++)
        for (let dj = -1; dj <= 1; dj++)
          for (let dk = -1; dk <= 1; dk++) {
            const a = i + di,
              b = j + dj,
              c = k + dk;
            if (a < 0 || b < 0 || c < 0 || a >= nx || b >= ny || c >= nz) continue;
            const w = (a * ny + b) * nz + c;
            if (d[w]! >= 0) continue;
            d[w] = r;
            next.push(w);
          }
    }
    front = next;
  }
  let cells = 0;
  for (let v = 0; v < n; v++)
    if (st[v] === Structure.LaWall && (d[v]! < 0 || d[v]! * H > FAR_CM)) cells++;
  return cells * H ** 3;
}

describe('the left atrium’s wall wraps its blood, with no fin over the roof (decision 381)', () => {
  for (const { id } of CASE_INPUTS)
    for (const phase of [0, 0.35])
      it(`${id} @${phase}`, () => {
        expect(wallFarFromBlood(id, phase)).toBeLessThan(MAX_CM3);
      });
});
