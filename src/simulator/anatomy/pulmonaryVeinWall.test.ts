// @tier slow
import { describe, expect, it } from 'vitest';
import { CASE_INPUTS, loadCaseById } from '@/cases';
import { buildCaseModels } from '@/simulator/anatomy/caseModels';
import { heartAnchors } from '@/simulator/anatomy/anchors';
import { atrialScale, laWallOf } from '@/simulator/anatomy/classify/atria';
import { classifyHeart, computeHeartPose } from '@/simulator/anatomy/heartModel';
import { PV_COURSE, PV_RADIUS, pulmonaryVeinSegment } from '@/simulator/anatomy/pulmonaryVeins';
import { makeSample, Structure, Tissue } from '@/simulator/anatomy/tissue';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { planeCensus } from '@/tests/coherence/planeCensus';

/**
 * The pulmonary veins' wall is thin and scatters as the atrial wall it continues (decision 370): across each vein, halfway
 * along it, the wall past the lumen is myocardium and at most WALL_MAX_CM thick; and in the great-vessel short axis of the
 * normal case the veins' blood reads at most BLOOD_EXCESS_MAX grey levels over the left atrium's. With 1.2 mm of arterial
 * wall (reflectivity 0.55) the beam filled their 9 mm lumen at 11-14 cm: 32-44 levels over the atrium's blood, a grey tube
 * where a vein is hard to find; 15-18 now.
 */
const WALL_MAX_CM = 0.08;
const BLOOD_EXCESS_MAX = 25;

describe('the pulmonary veins have a thin wall that scatters as the atrial wall (decision 370)', () => {
  for (const { id } of CASE_INPUTS)
    it(id, () => {
      const { heart, tables } = buildCaseModels(loadCaseById(id), {
        position: 'left-lateral',
        respiration: 'expiration',
        headElevationDeg: 0,
      });
      const A = heartAnchors(heart);
      const pose = computeHeartPose(heart, cycleStateAt(tables, 0));
      const bo = atrialScale(pose.laBooster, A.laReservoir, pose.state.contraction);
      const zTop = A.laCenter.z - A.laR.z;
      const zBottom = pose.zAnn + 0.25;
      const s = makeSample();
      const seg = new Float64Array(6);
      const problems: string[] = [];
      for (let i = 0; i < 4; i++) {
        pulmonaryVeinSegment(
          i,
          A.laCenter,
          A.laR,
          bo,
          (zTop + zBottom) / 2,
          (zBottom - zTop) / 2,
          seg,
          laWallOf(A),
        );
        // halfway along the vein, across it: a direction perpendicular to its course
        const m = [0, 1, 2].map((k) => (seg[k]! + seg[k + 3]!) / 2);
        const c = [PV_COURSE[3 * i]!, PV_COURSE[3 * i + 1]!, PV_COURSE[3 * i + 2]!];
        const len = Math.hypot(c[0]!, c[1]!, c[2]!);
        const u = [-c[1]! / len, c[0]! / len, 0];
        const un = Math.hypot(u[0]!, u[1]!) || 1;
        let wall = 0;
        let tissue = -1;
        for (let r = PV_RADIUS - 0.1; r < PV_RADIUS + 0.4; r += 0.005) {
          const p = [0, 1, 2].map((k) => m[k]! + (u[k]! / un) * r);
          if (!classifyHeart(heart, pose, p[0]! + pose.swingX, p[1]!, p[2]!, s)) continue;
          if (s.structure === Structure.PulmonaryVein && s.tissue !== Tissue.Blood) {
            wall += 0.005;
            tissue = s.tissue;
          }
        }
        if (wall === 0) continue; // the line left the vein for another structure there (it met the atrium or the column)
        if (tissue !== Tissue.Myocardium) problems.push(`vein ${i}: its wall is tissue ${tissue}`);
        if (wall > WALL_MAX_CM + 0.006)
          problems.push(`vein ${i}: its wall is ${(wall * 10).toFixed(1)} mm thick`);
      }
      expect(problems).toEqual([]);
    });

  it('the veins read close to the atrium’s blood in the normal great-vessel short axis', () => {
    const problems: string[] = [];
    for (const phase of [0, 0.35]) {
      const g = planeCensus('normal-excellent-window', 'psax-av', phase).greys;
      const at = (st: number) => g.find((r) => r.structure === st && r.tissue === Tissue.Blood)!;
      const excess = at(Structure.PulmonaryVein).mean - at(Structure.LaCavity).mean;
      if (excess > BLOOD_EXCESS_MAX)
        problems.push(`@${phase}: the veins' blood ${excess.toFixed(1)} levels over the atrium's`);
    }
    expect(problems).toEqual([]);
  });
});
