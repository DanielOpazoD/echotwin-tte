// @tier slow
import { describe, expect, it } from 'vitest';
import { listCases, loadCaseById } from '@/cases';
import { buildCaseModels, REST_PATIENT } from '@/simulator/anatomy/caseModels';
import { anchorsCached } from '@/simulator/anatomy/anchors';
import { computeHeartPose } from '@/simulator/anatomy/heartModel';
import { Structure } from '@/simulator/anatomy/tissue';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { sampleTissueVelocity } from './flow-primitives/flowField';

// Differentiate the positions supplied by the geometry, not the velocity table under test.
// One table interval matches the temporal resolution of the cycle's central derivative.
describe('longitudinal tissue velocity follows material points of the moving geometry', () => {
  it.each(listCases().map(({ id }) => id))('%s: septal LV and tricuspid RV, base to apex', (id) => {
    const { heart, tables } = buildCaseModels(loadCaseById(id), REST_PATIENT);
    const A = anchorsCached(heart);
    const step = 1 / tables.n;
    const pose = (phase: number) => computeHeartPose(heart, cycleStateAt(tables, phase));
    let movingSamples = 0;
    for (let phase = 0.05; phase < 0.96; phase += 0.05) {
      const hp = pose(phase),
        before = pose(phase - step),
        after = pose(phase + step);
      for (const u of [0, 0.1, 0.4, 0.8, 1]) {
        const lvPosition = (p: typeof hp) => p.zAnn + u * p.lengthNow;
        const rvPosition = (p: typeof hp) => {
          const base = A.tvCenter.z + p.tvZ;
          return base + u * (A.rvApexFrac * heart.lv.lengthCm - base);
        };
        for (const [position, structure] of [
          [lvPosition, Structure.LvWallSeptal],
          [rvPosition, Structure.RvWall],
        ] as const) {
          const geometric = (position(after) - position(before)) / (2 * step * tables.rrS * 100);
          const actual = sampleTissueVelocity(
            heart,
            tables,
            phase,
            -2,
            0,
            position(hp),
            structure,
          ).vz;
          expect(actual, `${id}, phase ${phase}, level ${u}, structure ${structure}`).toBeCloseTo(
            geometric,
            5,
          );
          if (Math.abs(geometric) > 0.01) movingSamples++;
        }
      }
    }
    expect(movingSamples).toBeGreaterThan(40);
  });
});
