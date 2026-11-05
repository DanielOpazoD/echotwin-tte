// @tier slow
import { describe, expect, it } from 'vitest';
import { CASE_INPUTS, loadCaseById } from '@/cases';
import { buildCaseModels } from '@/simulator/anatomy/caseModels';
import { torsoToHeart } from '@/simulator/anatomy/heartFrame';
import { classifyHeart, computeHeartPose } from '@/simulator/anatomy/heartModel';
import { classifyThorax } from '@/simulator/anatomy/thoraxModel';
import { makeSample, Structure } from '@/simulator/anatomy/tissue';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';

/**
 * Behind the ascending aorta lies the mediastinum, not lung (decision 386): the right pulmonary artery, the carina and
 * the fat between them and the oesophagus. The superior mediastinum rose from torso y = 2 to y = 6, and from 1.5 to 4 cm,
 * where the root and the ascending aorta leave the heart, the lung came within 2 mm of the aortic wall in every case
 * but the tamponade (16-45 columns in 158-205 of each case): its pleural face followed the vessel's contour, and the
 * five-chamber view showed it under the aortic valve as a second valve. On a 2.5 mm grid across the torso, at 2-3.5 cm
 * of height, where the ascending aorta leaves the heart, from the aorta's back wall along the torso's posterior wherever
 * the column crosses the vessel whole (beside it the lung lies against its side), the lung begins no nearer than
 * MIN_GAP_CM.
 */
const MIN_GAP_CM = 0.8;
const MIN_CHORD_CM = 1;
const PATIENT = {
  position: 'left-lateral',
  respiration: 'expiration',
  headElevationDeg: 0,
} as const;

describe('behind the ascending aorta lies the mediastinum (decision 386)', () => {
  for (const { id } of CASE_INPUTS)
    it(id, () => {
      const { heart, thorax, tables } = buildCaseModels(loadCaseById(id), PATIENT);
      const hp = computeHeartPose(heart, cycleStateAt(tables, 0.15));
      const s = makeSample();
      const at = (x: number, y: number, z: number) => {
        const h = torsoToHeart(heart.frame, { x, y, z });
        if (classifyHeart(heart, hp, h.x + hp.swingX, h.y, h.z, s)) return s.structure;
        classifyThorax(thorax, x, y, z, s, s.sdf);
        return s.structure;
      };
      const near: string[] = [];
      let columns = 0;
      for (let y = 2; y <= 3.5; y += 0.5)
        for (let x = -6; x <= 4; x += 0.25) {
          // the aorta's back wall along this column, then the lung behind it; only where the column crosses the vessel
          // whole, not at its sides, where the lung lies beside it
          let front = NaN,
            back = NaN;
          for (let z = -3; z >= -14; z -= 0.05) {
            const st = at(x, y, z);
            if (st === Structure.AscendingAorta || st === Structure.AorticRoot) {
              if (Number.isNaN(front)) front = z;
              back = z;
            } else if (!Number.isNaN(back)) break;
          }
          if (Number.isNaN(back) || front - back < MIN_CHORD_CM) continue;
          columns++;
          for (let z = back - 0.05; z > back - MIN_GAP_CM; z -= 0.05)
            if (at(x, y, z) === Structure.Lung) {
              near.push(`(${x}, ${y}): lung ${(back - z).toFixed(2)} cm behind the aorta`);
              break;
            }
        }
      expect(columns).toBeGreaterThan(30);
      expect(near).toEqual([]);
    });
});
