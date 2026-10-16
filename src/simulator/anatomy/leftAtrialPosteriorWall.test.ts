// @tier slow
import { describe, expect, it } from 'vitest';
import { CASE_INPUTS, loadCaseById } from '@/cases';
import { SimulatorCore } from '@/simulator/core/simulatorCore';
import { baseInput } from '@/simulator/core/baseInput';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import { ProceduralSliceRenderer } from '@/simulator/renderer/procedural/sliceRenderer';
import { allocPolarFrame, DEFAULT_ACQUISITION, polarSpecFor } from '@/simulator/renderer/types';
import { computeHeartPose } from './heartPose';
import { PERICARDIUM_CM } from './classify/pericardium';
import {
  descAortaScale,
  DESC_AORTA_MAX_OUTER_R,
  DESC_AORTA_R,
  DESC_AORTA_WALL,
  DESC_AORTA_X,
  DESC_AORTA_Z,
} from './thoraxModel';
import { Structure } from './tissue';

/**
 * The posterior wall of the left atrium rests on the descending aorta (decision 330). In the parasternal long axis the
 * aorta is cut behind the atrioventricular groove, under the atrium's posterior wall, and only the pericardial
 * reflection lies between the wall and the aorta: 2-3 mm (on M-mode the posterior atrial wall is almost immobile while
 * the aortic root moves 1 cm forward in systole; on CT the aorta touches the atrium or its left veins in 50 of 65,
 * Cury et al., Heart Rhythm 2005). The ellipsoid curved away from the aorta toward the groove and shrank with the
 * atrial kick about its centre: in the normal case 4-16 mm of mediastinal fat lay between the atrial wall and the aorta
 * on the lines through the aorta, and the wall moved 4-5 mm back from end-diastole to end-systole.
 * In end-diastole and end-systole of every case, over the long-axis lines that leave the atrial cavity through its
 * wall:
 *  - the outer surface of the atrial wall comes within MAX_REFLECTION_CM of the aorta's outer surface (the pericardium
 *    and a sample; the wall is drawn against the aorta's systolic maximum, so the aorta's own pulse is added where it
 *    stands back from it);
 *  - the deepest point of the atrial cavity behind the wall moves at most MAX_WALL_MOTION_CM between the two phases.
 */
const MAX_REFLECTION_CM = PERICARDIUM_CM + 0.1;
const MAX_WALL_MOTION_CM = 0.2;
const PHASES = [0, 0.35];

function plax(id: string) {
  const { heart, thorax, tables } = new SimulatorCore(loadCaseById(id), baseInput()).models;
  const spec = polarSpecFor(DEFAULT_ACQUISITION, 'medium');
  const beam = beamFrameFromPose(
    poseFromControl(thorax, canonicalControl(getViewTarget('plax'), heart, thorax)),
    1,
  );
  const f = allocPolarFrame(spec);
  const r = new ProceduralSliceRenderer();
  const render = (phase: number) => {
    const heartPose = computeHeartPose(heart, cycleStateAt(tables, phase));
    r.render(
      {
        heart,
        heartPose,
        thorax,
        physics: {
          frequencyMHz: DEFAULT_ACQUISITION.frequencyMHz,
          harmonics: DEFAULT_ACQUISITION.harmonics,
          clutterLevel: 0,
          windowAttenuation: 0,
          seed: 1,
        },
      },
      beam,
      spec,
      phase,
      f,
    );
    return heartPose;
  };
  return { spec, beam, f, render, thorax };
}

/**
 * Over the lines that leave the atrial cavity through its wall: the least distance from the wall's outer surface to the
 * aorta's outer surface of the moment (cm; the descending aorta is a vertical cylinder in the torso), and the torso
 * depth of the most posterior cavity sample.
 */
function wallAgainstAorta(p: ReturnType<typeof plax>, aortaOuterR: number) {
  const { spec, beam, f, thorax } = p;
  const N = spec.samples,
    dr = spec.depthCm / N;
  const cz = DESC_AORTA_Z + thorax.columnShiftCm;
  let least = Infinity,
    deepest = Infinity,
    lines = 0;
  for (let li = 0; li < spec.lines; li++) {
    const th = -spec.sectorRad / 2 + ((li + 0.5) / spec.lines) * spec.sectorRad;
    const ca = Math.cos(th),
      sa = Math.sin(th);
    let last = -1;
    for (let s = 0; s < N; s++) if (f.structure[li * N + s] === Structure.LaCavity) last = s;
    if (last < 0) continue;
    let s = last + 1;
    while (s < N && f.structure[li * N + s] === Structure.LaWall) s++;
    if (s === last + 1) continue;
    lines++;
    const at = (k: number) => {
      const r = k * dr;
      return {
        x: beam.origin.x + r * (ca * beam.forward.x + sa * beam.lateral.x),
        z: beam.origin.z + r * (ca * beam.forward.z + sa * beam.lateral.z),
      };
    };
    const cav = at(last + 1),
      wall = at(s);
    deepest = Math.min(deepest, cav.z);
    least = Math.min(least, Math.hypot(wall.x - DESC_AORTA_X, wall.z - cz) - aortaOuterR);
  }
  return { least, deepest, lines };
}

describe('the posterior wall of the left atrium rests on the descending aorta (decision 330)', () => {
  for (const { id } of CASE_INPUTS)
    it(id, () => {
      const p = plax(id);
      const problems: string[] = [];
      const depths: number[] = [];
      for (const phase of PHASES) {
        const pose = p.render(phase);
        const outerR =
          DESC_AORTA_R * descAortaScale(p.thorax, pose.state.aorticPressure) + DESC_AORTA_WALL;
        const { least, deepest, lines } = wallAgainstAorta(p, outerR);
        if (!lines) {
          problems.push(`@${phase}: no long-axis line leaves the atrium through its wall`);
          continue;
        }
        depths.push(deepest);
        const budget = MAX_REFLECTION_CM + (DESC_AORTA_MAX_OUTER_R - outerR);
        if (least > budget)
          problems.push(
            `@${phase}: the atrial wall comes no closer than ${(least * 10).toFixed(1)} mm to the aorta (${(budget * 10).toFixed(1)} allowed)`,
          );
      }
      if (depths.length === 2 && Math.abs(depths[1]! - depths[0]!) > MAX_WALL_MOTION_CM)
        problems.push(
          `the posterior wall moves ${(Math.abs(depths[1]! - depths[0]!) * 10).toFixed(1)} mm between end-diastole and end-systole`,
        );
      expect(problems).toEqual([]);
    });
});
