// @tier slow
import { describe, expect, it } from 'vitest';
import { CASE_INPUTS, loadCaseById } from '@/cases';
import { buildCaseModels } from '@/simulator/anatomy/caseModels';
import { torsoToHeart } from '@/simulator/anatomy/heartFrame';
import { classifyHeart, computeHeartPose } from '@/simulator/anatomy/heartModel';
import { makeSample, Structure } from '@/simulator/anatomy/tissue';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { beamFrameFromPose, poseFromControl, type ProbeControl } from '@/simulator/probe/pose';

const PATIENT = {
  position: 'left-lateral',
  respiration: 'expiration',
  headElevationDeg: 0,
} as const;

/**
 * The left atrium in the five-chamber view Daniel marked (decision 385): a triangle standing out of the lateral wall, an
 * inner border too far in, and fat where the atrium should be. In his plane, at his phase: the marked point (13.3 cm, 7°)
 * was 0.68 cm² of wall cut obliquely, with 0.44 cm² of fat within 2.5 cm of it; now it is blood, with 0.34 cm² of wall
 * and 0.18 cm² of fat around it.
 */
const MARKED: ProbeControl = {
  u: 9.4519,
  v: -5.6626,
  rotationDeg: 164,
  tiltDeg: 18,
  rockDeg: -38,
  pressure: 0.6,
};

describe('the left atrium fills the space beside the root in the marked five-chamber view (decision 385)', () => {
  it('its blood reaches the marked point, with little wall and fat around it', () => {
    const { heart, thorax, tables } = buildCaseModels(
      loadCaseById('normal-excellent-window'),
      PATIENT,
    );
    const beam = beamFrameFromPose(poseFromControl(thorax, MARKED), 1);
    const hp = computeHeartPose(heart, cycleStateAt(tables, 0.15));
    const s = makeSample();
    const at = (d: number, u: number) => {
      const h = torsoToHeart(heart.frame, {
        x: beam.origin.x + beam.forward.x * d + beam.lateral.x * u,
        y: beam.origin.y + beam.forward.y * d + beam.lateral.y * u,
        z: beam.origin.z + beam.forward.z * d + beam.lateral.z * u,
      });
      return classifyHeart(heart, hp, h.x + hp.swingX, h.y, h.z, s) ? s.structure : -1;
    };
    const md = 13.3 * Math.cos((7 * Math.PI) / 180),
      mu = 13.3 * Math.sin((7 * Math.PI) / 180);
    expect(at(md, mu)).toBe(Structure.LaCavity);
    const g = 0.02;
    let fat = 0;
    for (let dd = -2.5; dd <= 2.5; dd += g)
      for (let du = -2.5; du <= 2.5; du += g)
        if (Math.hypot(dd, du) < 2.5 && at(md + dd, mu + du) === Structure.EpicardialFat)
          fat += g * g;
    expect(fat).toBeLessThan(0.3);
  });
});

/**
 * Over the lateral arc the flare of the base stops at the shelf the lateral wall stands on (decision 385). It went on
 * widening with the height above the hinge, past the wall, up to the section where the base ends flat: a triangle out of
 * the wall in every plane that crosses it. Measured as the left atrial blood's lateral reach, at each height above the
 * hinge, against its reach 1.6-2 cm above it, where only the wall stands: 2-3.2 mm in six cases then, at most 1.6 now.
 */
const MAX_OVERSHOOT_CM = 0.18;
describe('no triangle stands out of the left atrial lateral wall (decision 385)', () => {
  const H = 0.04;
  for (const { id } of CASE_INPUTS)
    it(id, () => {
      const { heart, tables } = buildCaseModels(loadCaseById(id), PATIENT);
      const hp = computeHeartPose(heart, cycleStateAt(tables, 0));
      const s = makeSample();
      /** The lateral reach (cm) of the left atrial blood at a height above the annular plane. */
      const reach = (above: number) => {
        let max = -1e3;
        for (let y = -4; y <= 2; y += H)
          for (let x = 6; x > max && x > -2; x -= H)
            if (
              classifyHeart(heart, hp, x + hp.swingX, y, hp.zAnn - above, s) &&
              s.structure === Structure.LaCavity
            ) {
              max = x;
              break;
            }
        return max;
      };
      const wall = Math.max(reach(1.6), reach(1.8), reach(2));
      let most = -1e3;
      for (let above = 0.3; above < 1.6; above += 0.1) most = Math.max(most, reach(above));
      expect(most - wall).toBeLessThan(MAX_OVERSHOOT_CM);
    });
});
