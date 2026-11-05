// @tier slow
import { describe, expect, it } from 'vitest';
import { CASE_INPUTS, loadCaseById } from '@/cases';
import { SimulatorCore } from '@/simulator/core/simulatorCore';
import { baseInput } from '@/simulator/core/baseInput';
import { classifyHeart, computeHeartPose } from '@/simulator/anatomy/heartModel';
import { makeSample, Structure } from '@/simulator/anatomy/tissue';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import { ProceduralSliceRenderer } from '@/simulator/renderer/procedural/sliceRenderer';
import { scenePhysicsFor } from '@/simulator/renderer/scenePhysics';
import {
  allocPolarFrame,
  CALIBRATED_TIER,
  DEFAULT_ACQUISITION,
  polarSpecFor,
} from '@/simulator/renderer/types';

/**
 * The right atrial appendage holds its published volume and the five-chamber view shows the right atrium (decision 388).
 *
 * - On CT the appendage holds 13.3 ± 3.5 mL in men and 10.7 ± 2.8 mL in women at its largest (BMC Cardiovasc Disord
 *   2025, 60 patients in sinus rhythm). At end-systole every case's appendage is within one SD of its sex's mean. The
 *   finger of decision 323 held 7.1-8.8 mL, below that range in every man and in pulmonary hypertension.
 * - In the canonical five-chamber view at end-diastole the right atrium and its appendage take at least MIN_A5C_RIGHT
 *   of the sector in every case: the finger was cut as a small circle far from the root, 0.30-0.47 % of the sector, and
 *   Daniel saw no right atrium there.
 */
const PUBLISHED_MAX_ML = {
  male: { mean: 13.3, sd: 3.5 },
  female: { mean: 10.7, sd: 2.8 },
} as const;
const MIN_A5C_RIGHT = 0.005;

/** The appendage's blood (mL) at `phase`, counted on a 1.5 mm grid over a box around it. */
function appendageMl(id: string, phase: number): number {
  const { heart, tables } = new SimulatorCore(loadCaseById(id), baseInput()).models;
  const hp = computeHeartPose(heart, cycleStateAt(tables, phase));
  const s = makeSample();
  const g = 0.15;
  let n = 0;
  for (let x = -7.5; x <= -1.5; x += g)
    for (let y = -1.5; y <= 6.5; y += g)
      for (let z = -5; z <= 1; z += g)
        if (
          classifyHeart(heart, hp, x + hp.swingX, y, z, s) &&
          s.structure === Structure.RaAppendage
        )
          n++;
  return n * g ** 3;
}

describe('the right atrial appendage holds its published volume at end-systole (decision 388)', () => {
  for (const { id } of CASE_INPUTS)
    it(id, () => {
      const c = loadCaseById(id);
      const { tables } = new SimulatorCore(c, baseInput()).models;
      const ref = PUBLISHED_MAX_ML[c.demographics.sexForReference];
      const ml = appendageMl(id, tables.endSystoleS / tables.rrS);
      expect(ml).toBeGreaterThanOrEqual(ref.mean - ref.sd);
      expect(ml).toBeLessThanOrEqual(ref.mean + ref.sd);
    });
});

describe('the five-chamber view shows the right atrium (decision 388)', () => {
  for (const { id } of CASE_INPUTS)
    it(id, () => {
      const c = loadCaseById(id);
      const { heart, thorax, tables } = new SimulatorCore(c, baseInput()).models;
      const spec = polarSpecFor(DEFAULT_ACQUISITION, CALIBRATED_TIER);
      const beam = beamFrameFromPose(
        poseFromControl(thorax, canonicalControl(getViewTarget('a5c'), heart, thorax)),
        1,
      );
      const f = allocPolarFrame(spec);
      new ProceduralSliceRenderer().render(
        {
          heart,
          heartPose: computeHeartPose(heart, cycleStateAt(tables, 0)),
          thorax,
          physics: scenePhysicsFor(c, DEFAULT_ACQUISITION),
        },
        beam,
        spec,
        0,
        f,
      );
      let right = 0;
      for (const st of f.structure)
        if (st === Structure.RaCavity || st === Structure.RaAppendage) right++;
      expect(right / f.structure.length).toBeGreaterThanOrEqual(MIN_A5C_RIGHT);
    });
});
