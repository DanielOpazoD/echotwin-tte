// @tier slow
/**
 * In the parasternal short axis at the aortic valve the pulmonary trunk shows up to its bifurcation: in a prospective
 * cohort it was seen in every patient imaged (Kaiser et al., Echo Res Pract 2020, PMC7337354). The lung wrapped the
 * trunk at 1.5 mm from its sac on every side, also in front of it, where the mediastinum's fat stands, and hid 42-65 % of
 * it on the drawn plane (decision 336). Measured here: of the trunk's samples on the drawn plane, the share the beam
 * reaches before it meets the lung.
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

/** Share of the trunk on the plane the beam must reach. */
const TRUNK_SEEN_MIN = 0.75;
/**
 * Cases under it, as measured (share seen): the two windows whose lung comes over the heart by design (the difficult
 * window and the artifact case: the left lung's border drawn medially), which the mediastinum's fat does not change.
 */
const KNOWN_TRUNK_HIDDEN: Record<string, number> = {
  'normal-difficult-window ED': 0.28,
  'normal-difficult-window ES': 0.18,
  'artifact-challenge ED': 0.43,
  'artifact-challenge ES': 0.38,
};
const TOLERANCE = 0.05;

function trunkSeen(caseId: string, es: boolean): number {
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
  let seen = 0,
    hidden = 0;
  for (let a = -0.6; a <= 0.6; a += 0.005) {
    const ct = Math.cos(a),
      sn = Math.sin(a);
    let behindLung = false;
    for (let r = 0.5; r <= 16; r += 0.05) {
      const k = classify(
        beam.origin.x + (beam.forward.x * ct + beam.lateral.x * sn) * r,
        beam.origin.y + (beam.forward.y * ct + beam.lateral.y * sn) * r,
        beam.origin.z + (beam.forward.z * ct + beam.lateral.z * sn) * r,
        q,
      );
      if (k > 0 && q.tissue === Tissue.Lung) behindLung = true;
      // the lung's entry hides what lies behind it; the heart classifier still names the trunk there
      if (k === 2 && q.structure === Structure.PulmonaryArtery) {
        if (behindLung) hidden++;
        else seen++;
      }
    }
  }
  return seen / Math.max(1, seen + hidden);
}

describe('the pulmonary trunk shows in the parasternal short axis', () => {
  it('lets the beam reach the trunk before the lung, or the share it declares', () => {
    const under: string[] = [];
    const stale: string[] = [];
    for (const { id } of CASE_INPUTS)
      for (const es of [false, true]) {
        const key = `${id} ${es ? 'ES' : 'ED'}`;
        const share = trunkSeen(id, es);
        const declared = KNOWN_TRUNK_HIDDEN[key];
        if (share < (declared ?? TRUNK_SEEN_MIN) - (declared === undefined ? 0 : TOLERANCE))
          under.push(
            `${key}: ${(100 * share).toFixed(0)} % of the trunk seen (declared ${declared ?? '-'})`,
          );
        if (declared !== undefined && share >= TRUNK_SEEN_MIN)
          stale.push(`${key}: declared ${declared}, now ${share.toFixed(2)}`);
      }
    expect(under).toEqual([]);
    expect(stale, 'drop these entries of KNOWN_TRUNK_HIDDEN').toEqual([]);
  });
});
