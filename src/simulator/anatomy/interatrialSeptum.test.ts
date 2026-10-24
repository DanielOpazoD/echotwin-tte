// @tier slow
import { describe, expect, it } from 'vitest';
import { CASE_INPUTS, loadCaseById } from '@/cases';
import { buildCaseModels } from '@/simulator/anatomy/caseModels';
import { heartAnchors } from '@/simulator/anatomy/anchors';
import { classifyHeart, computeHeartPose } from '@/simulator/anatomy/heartModel';
import { IAS_FOSSA_DESCENT_SHARE, IAS_MUSCULAR_CM } from '@/simulator/anatomy/laGeometry';
import { measureModel } from '@/simulator/anatomy/measureModel';
import { makeSample, Structure } from '@/simulator/anatomy/tissue';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';

/**
 * The interatrial septum thins smoothly into the fossa and moves with the beat (decision 369). Across the fossa's centre,
 * along the septum, its thickness never steps by more than STEP_MAX_CM per millimetre and never exceeds THICK_MAX_CM; and
 * at the fossa's centre, which follows the base down, the septum stands at least BOW_MIN_CM nearer the right atrium at
 * end-systole than at end-diastole, the fossa itself having moved toward the apex by at least FOSSA_DESCENT_MIN_SHARE of the mitral annulus's descent. A limbus 0.7 cm thick stepped up from the 0.12 cm membrane (5.8 mm in one millimetre;
 * the fossa's edge rises by at most 1.7 mm per millimetre now), and the septum stood still in the heart: the great-vessel
 * short axis showed the same 1.2 and 7.3 mm, 5 mm apart, in every phase.
 */
const STEP_MAX_CM = 0.2;
const THICK_MAX_CM = 0.6;
const BOW_MIN_CM = 0.15;
/** The share of the mitral annulus's systolic descent the fossa's membrane follows at least. */
const FOSSA_DESCENT_MIN_SHARE = 0.35;

describe('the interatrial septum thins smoothly into the fossa and moves with the beat (decision 369)', () => {
  for (const { id } of CASE_INPUTS)
    it(id, () => {
      const { heart, tables } = buildCaseModels(loadCaseById(id), {
        position: 'left-lateral',
        respiration: 'expiration',
        headElevationDeg: 0,
      });
      const A = heartAnchors(heart);
      const s = makeSample();
      /** The septum's run across x at (y, z): its thickness and its centre, or null where the line misses it. */
      const run = (pose: ReturnType<typeof computeHeartPose>, y: number, z: number) => {
        let x0 = NaN;
        let x1 = NaN;
        for (let x = A.iasX - 1.2; x < A.iasX + 1.2; x += 0.005)
          if (
            classifyHeart(heart, pose, x + pose.swingX, y, z, s) &&
            s.structure === Structure.InteratrialSeptum
          ) {
            if (Number.isNaN(x0)) x0 = x;
            x1 = x;
          }
        return Number.isNaN(x0) ? null : { t: x1 - x0 + 0.005, c: (x0 + x1) / 2 };
      };
      const ed = computeHeartPose(heart, cycleStateAt(tables, 0));
      const es = computeHeartPose(
        heart,
        cycleStateAt(tables, tables.timings.ejectionEndS / tables.rrS),
      );
      const problems: string[] = [];
      const zEd = A.fossaZ + IAS_FOSSA_DESCENT_SHARE * ed.zAnn;
      let last: number | null = null;
      let thickest = 0;
      for (let y = A.fossaY - 1.2; y <= A.fossaY + 1.2; y += 0.1) {
        const r = run(ed, y, zEd);
        if (!r) {
          last = null;
          continue;
        }
        thickest = Math.max(thickest, r.t);
        if (last !== null && Math.abs(r.t - last) > STEP_MAX_CM + 1e-9)
          problems.push(
            `steps from ${(last * 10).toFixed(1)} to ${(r.t * 10).toFixed(1)} mm at y ${y.toFixed(1)}`,
          );
        last = r.t;
      }
      if (thickest > THICK_MAX_CM)
        problems.push(`${(thickest * 10).toFixed(1)} mm thick across the fossa`);
      const atEd = run(ed, A.fossaY, zEd);
      const atEs = run(es, A.fossaY, A.fossaZ + IAS_FOSSA_DESCENT_SHARE * es.zAnn);
      if (!atEd || !atEs) problems.push('no septum at the fossa centre');
      else if (!(atEd.c - atEs.c >= BOW_MIN_CM))
        problems.push(
          `moves ${((atEd.c - atEs.c) * 10).toFixed(1)} mm toward the right atrium from end-diastole to end-systole`,
        );
      // the fossa itself follows the base: its membrane moves toward the apex
      // (the centre of the membrane, where the septum is under 2 mm: its thinnest stretch is a plateau)
      const thinnest = (pose: ReturnType<typeof computeHeartPose>): number => {
        let sum = 0;
        let n = 0;
        for (let z = A.fossaZ - 1.5; z <= A.fossaZ + 2; z += 0.05) {
          const r = run(pose, A.fossaY, z);
          if (r && r.t < 0.2) {
            sum += z;
            n++;
          }
        }
        return sum / n;
      };
      const descent = thinnest(es) - thinnest(ed);
      const annulus = es.zAnn - ed.zAnn;
      if (!(descent >= FOSSA_DESCENT_MIN_SHARE * annulus))
        problems.push(
          `the fossa moves ${(descent * 10).toFixed(1)} mm toward the apex in systole, the annulus ${(annulus * 10).toFixed(1)}`,
        );
      expect(problems).toEqual([]);
    });
});

/**
 * The septum's measured thickness is the muscular septum's, where the line crosses from right atrial blood through the
 * septum to left atrial blood, outside the fossa (decision 369). The median of nine fixed points read the 7 mm limbus
 * where it ran and, where the atria are small, the veins and the pericardium beside the septum: 0.08-0.36 cm in four cases
 * once the limbus was gone.
 */
describe('the septum is measured on the muscular septum between the two bloods (decision 369)', () => {
  for (const { id } of CASE_INPUTS)
    it(id, () => {
      const ias = measureModel(loadCaseById(id), undefined, 2000).rows.find((r) => r.id === 'ias')!;
      expect(Math.abs(ias.value - IAS_MUSCULAR_CM)).toBeLessThanOrEqual(0.06);
    });
});
