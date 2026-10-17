// @tier slow
/**
 * In the parasternal short axis at the aortic valve the interatrial septum runs from the back of the root to the back of
 * the atria, its anterior rim resting on the non-coronary sinus (decision 335). A wedge of fat 7-10 mm across stood
 * between the two atria and the root, the left atrium held off its septal face by the curtain's straight bound where the
 * round root had already receded. Measured on the drawn plane: the fat within JUNCTION_MM at once of the right atrium
 * (blood or wall), the left atrium (blood or wall) and the root's wall.
 */
import { describe, expect, it } from 'vitest';
import { CASE_INPUTS, loadCaseById } from '@/cases';
import { SimulatorCore } from '@/simulator/core/simulatorCore';
import { baseInput } from '@/simulator/core/baseInput';
import { computeHeartPose } from '@/simulator/anatomy/heartModel';
import { sceneClassifier } from '@/simulator/anatomy/sceneClassifier';
import { makeSample, Structure, Tissue } from '@/simulator/anatomy/tissue';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';

const JUNCTION_MM = 4;
/** Fat at the junction allowed on the plane (mm²): the films between the atrial walls and the root. */
const JUNCTION_FAT_MAX_MM2 = 7.5;
/**
 * Junctions over it, as measured (mm²): at end-systole in these cases the right atrium is released from the septal plane
 * toward the root (decision 222), and there the left atrium keeps its distance and the curtain's bound stands.
 */
const KNOWN_JUNCTION_FAT: Record<string, number> = {
  'normal-difficult-window ES': 10.3,
  'pulmonary-hypertension-rv ES': 10.4,
  'pericardial-effusion-tamponade ES': 10.5,
};
const TOLERANCE_MM2 = 1;

/** Polar grid over the sector: 0.25° by 0.25 mm. */
function junctionFat(caseId: string, es: boolean): number {
  const c = loadCaseById(caseId);
  const { heart, thorax, tables } = new SimulatorCore(c, baseInput()).models;
  const phase = es ? tables.endSystoleS / tables.rrS : 0;
  const classify = sceneClassifier({
    heart,
    heartPose: computeHeartPose(heart, cycleStateAt(tables, phase)),
    thorax,
  });
  const beam = beamFrameFromPose(
    poseFromControl(thorax, canonicalControl(getViewTarget('psax-av'), heart, thorax)),
    1,
  );
  const q = makeSample();
  const ra: [number, number][] = [],
    la: [number, number][] = [],
    root: [number, number][] = [],
    fat: [number, number, number][] = [];
  const dA = (0.25 * Math.PI) / 180,
    dR = 0.025;
  for (let a = -0.6; a <= 0.6; a += dA)
    for (let r = 4; r <= 14; r += dR) {
      const ct = Math.cos(a),
        sn = Math.sin(a);
      const k = classify(
        beam.origin.x + (beam.forward.x * ct + beam.lateral.x * sn) * r,
        beam.origin.y + (beam.forward.y * ct + beam.lateral.y * sn) * r,
        beam.origin.z + (beam.forward.z * ct + beam.lateral.z * sn) * r,
        q,
      );
      if (k !== 2 && q.tissue !== Tissue.Fat) continue;
      const p: [number, number] = [10 * r * sn, 10 * r * ct];
      const st = q.structure;
      if (st === Structure.RaCavity || st === Structure.RaWall) ra.push(p);
      else if (st === Structure.LaCavity || st === Structure.LaWall) la.push(p);
      else if (st === Structure.AorticRoot && q.tissue !== Tissue.Blood) root.push(p);
      else if (q.tissue === Tissue.Fat) fat.push([p[0], p[1], 100 * dR * r * dA]);
    }
  const near = (p: readonly number[], set: [number, number][]): boolean =>
    set.some(([x, y]) => (x - p[0]!) ** 2 + (y - p[1]!) ** 2 < JUNCTION_MM * JUNCTION_MM);
  let area = 0;
  for (const p of fat) if (near(p, root) && near(p, ra) && near(p, la)) area += p[2];
  return area;
}

describe('the interatrial septum reaches the aortic root in the parasternal short axis', () => {
  it('leaves no wedge of fat between the atria and the root, or the junction it declares', () => {
    const over: string[] = [];
    const stale: string[] = [];
    for (const { id } of CASE_INPUTS)
      for (const es of [false, true]) {
        const key = `${id} ${es ? 'ES' : 'ED'}`;
        const area = junctionFat(id, es);
        const declared = KNOWN_JUNCTION_FAT[key];
        if (
          area >
          (declared ?? JUNCTION_FAT_MAX_MM2) + (declared === undefined ? 0 : TOLERANCE_MM2)
        )
          over.push(
            `${key}: ${area.toFixed(1)} mm² of fat at the junction (declared ${declared ?? '-'})`,
          );
        if (declared !== undefined && area <= JUNCTION_FAT_MAX_MM2)
          stale.push(`${key}: declared ${declared}, now ${area.toFixed(1)} mm²`);
      }
    expect(over).toEqual([]);
    expect(stale, 'drop these entries of KNOWN_JUNCTION_FAT').toEqual([]);
  });
});
