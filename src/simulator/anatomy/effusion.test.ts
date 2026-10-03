// @tier slow
import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { heartAnchors } from './anchors';
import { buildCaseModels, REST_PATIENT } from './caseModels';
import { classifyHeart, computeHeartPose } from './heartModel';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { makeSample, Structure } from './tissue';
import { v3, type Vec3 } from '@/core/vec3';

/**
 * A pericardial effusion runs around the ventricles and stops behind the left atrium, where the pericardium reflects onto
 * the atrial wall around the pulmonary veins (the oblique sinus): in the parasternal long axis it lies anterior to the
 * descending aorta (decision 255). The tamponade case had a uniform 2.2 cm shell, behind the atrium as well.
 */
describe('the pericardial effusion respects the oblique sinus (decision 255)', () => {
  it('in the tamponade case: at most 0.5 cm behind the left atrium, at least 1.5 cm behind the left ventricle', () => {
    const { heart, tables } = buildCaseModels(
      loadCaseById('pericardial-effusion-tamponade'),
      REST_PATIENT,
    );
    const A = heartAnchors(heart);
    const s = makeSample();
    const out: string[] = [];
    for (const phase of [0, 0.35]) {
      const hp = computeHeartPose(heart, cycleStateAt(tables, phase));
      /** Effusion (cm) along a line from p0 in direction d (heart frame). */
      const fluid = (p0: Vec3, d: Vec3) => {
        let n = 0;
        for (let t = 0; t < 8; t += 0.02)
          if (
            classifyHeart(
              heart,
              hp,
              p0.x + d.x * t + hp.swingX,
              p0.y + d.y * t,
              p0.z + d.z * t,
              s,
            ) &&
            s.structure === Structure.PericardialEffusion
          )
            n++;
        return n * 0.02;
      };
      const posterior = v3(0, -1, 0);
      const behindLa = fluid(A.laCenter, posterior);
      if (!(behindLa <= 0.5))
        out.push(`@${phase} behind the left atrium ${behindLa.toFixed(2)} cm`);
      for (const level of [2, 3.5, 5]) {
        const behindLv = fluid(v3(0, 0, hp.zAnn + level), posterior);
        if (!(behindLv >= 1.5))
          out.push(`@${phase} behind the LV at ${level} cm ${behindLv.toFixed(2)} cm`);
      }
    }
    expect(out).toEqual([]);
  });
});
