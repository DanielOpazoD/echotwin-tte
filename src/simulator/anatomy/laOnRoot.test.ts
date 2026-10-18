// @tier slow
/**
 * The left atrium lies on the aortic root through the beat (decision 341). In the parasternal long axis the root's
 * posterior wall is the atrium's anterior one, and in M-mode the two move together. Scaled whole with the reservoir and
 * the kick, the atrium's front left the root: on the beam lines through the root lumen, the median distance from the
 * lumen to the atrial blood was 2.4 mm at end-systole and 10.2 mm at end-diastole in the normal case (16.4 in pulmonary
 * hypertension), with fat, the pericardium and lung in between. Measured here, on the canonical PLAX of every case: at
 * each phase that distance stays within 1 mm of the case's end-systolic one.
 */
import { describe, expect, it } from 'vitest';
import { CASE_INPUTS, loadCaseById } from '@/cases';
import { buildCaseModels } from './caseModels';
import { computeHeartPose } from './heartModel';
import { sceneClassifier } from './sceneClassifier';
import { makeSample, Structure, Tissue } from './tissue';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';

const PHASES = [0, 0.09, 0.2, 0.6, 0.8];
const END_SYSTOLE = 0.4;
/** How much farther from the root the atrium may lie than at end-systole (mm). */
const SLACK_MM = 1;
/**
 * Declared, with the largest distance measured (mm): in the tamponade the effusion fills the transverse sinus between the
 * root and the atrium in diastole (22.4 mm at 0.8), as fluid there does in large effusions; the atrium is held where the
 * root's wall is, but the sac's fluid comes first.
 */
const KNOWN_OFF_ROOT: Record<string, number> = { 'pericardial-effusion-tamponade': 22.4 };

/** Median distance (mm) from the root lumen to the atrial blood on the PLAX lines that cross both within 4 cm. */
function rootGapMm(id: string, phase: number): number {
  const m = buildCaseModels(loadCaseById(id), {
    position: 'left-lateral',
    respiration: 'expiration',
    headElevationDeg: 0,
  });
  const beam = beamFrameFromPose(
    poseFromControl(m.thorax, canonicalControl(getViewTarget('plax'), m.heart, m.thorax)),
    1,
  );
  const cl = sceneClassifier({
    heart: m.heart,
    heartPose: computeHeartPose(m.heart, cycleStateAt(m.tables, phase)),
    thorax: m.thorax,
  });
  const q = makeSample();
  const gaps: number[] = [];
  for (let a = -0.7; a <= 0.7; a += 0.01) {
    const ct = Math.cos(a),
      sn = Math.sin(a);
    let lumenEnd = -1;
    for (let r = 2; r < 16; r += 0.02) {
      cl(
        beam.origin.x + (beam.forward.x * ct + beam.lateral.x * sn) * r,
        beam.origin.y + (beam.forward.y * ct + beam.lateral.y * sn) * r,
        beam.origin.z + (beam.forward.z * ct + beam.lateral.z * sn) * r,
        q,
      );
      if (q.structure === Structure.AorticRoot && q.tissue === Tissue.Blood) {
        lumenEnd = r;
        continue;
      }
      if (lumenEnd < 0) continue;
      if (q.structure === Structure.LaCavity && q.tissue === Tissue.Blood) {
        gaps.push((r - lumenEnd) * 10);
        break;
      }
      if (r - lumenEnd > 4) break;
    }
  }
  gaps.sort((x, y) => x - y);
  return gaps.length ? gaps[gaps.length >> 1]! : Infinity;
}

describe('the left atrium lies on the aortic root through the beat (decision 341)', () => {
  for (const { id } of CASE_INPUTS)
    it(id, () => {
      const es = rootGapMm(id, END_SYSTOLE);
      expect(es, `${id}: the atrium reaches the root at end-systole`).toBeLessThan(10);
      const far = PHASES.map((ph) => ({ ph, gap: rootGapMm(id, ph) })).filter(
        (x) => x.gap > es + SLACK_MM,
      );
      const declared = KNOWN_OFF_ROOT[id];
      if (declared !== undefined) {
        expect(far.length, `${id}: declared off the root, and it lies on it`).toBeGreaterThan(0);
        expect(Math.max(...far.map((x) => x.gap))).toBeLessThanOrEqual(declared + SLACK_MM);
        return;
      }
      expect(
        far.map((x) => `@${x.ph}: ${x.gap.toFixed(1)} mm (end-systole ${es.toFixed(1)})`),
      ).toEqual([]);
    });
});
