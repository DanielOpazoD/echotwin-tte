// @tier slow
import { describe, expect, it } from 'vitest';
import { CASE_INPUTS, loadCaseById } from '@/cases';
import { SimulatorCore } from '@/simulator/core/simulatorCore';
import { baseInput } from '@/simulator/core/baseInput';
import { computeHeartPose } from '@/simulator/anatomy/heartModel';
import { Structure } from '@/simulator/anatomy/tissue';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import { ProceduralSliceRenderer } from '@/simulator/renderer/procedural/sliceRenderer';
import { allocPolarFrame, DEFAULT_ACQUISITION, polarSpecFor } from '@/simulator/renderer/types';

/**
 * Under the left hemidiaphragm the gastric fundus lies behind the left lobe of the liver (decision 271). Everything under
 * the diaphragm was liver, so once the diaphragm rose to the left ventricle's inferior wall (decision 262) the long axis
 * showed liver behind the posterior wall (4.8 % of the normal case's frame), where an echocardiographer sees lung, and
 * the papillary short axis showed it below the inferior wall (22 %). The subcostal window images the heart through the
 * left lobe, which stays.
 */
function liverShare(id: string, view: string): number {
  const { heart, thorax, tables } = new SimulatorCore(loadCaseById(id), baseInput()).models;
  const spec = polarSpecFor(DEFAULT_ACQUISITION, 'medium');
  const beam = beamFrameFromPose(
    poseFromControl(thorax, canonicalControl(getViewTarget(view), heart, thorax)),
    1,
  );
  const f = allocPolarFrame(spec);
  new ProceduralSliceRenderer().render(
    {
      heart,
      heartPose: computeHeartPose(heart, cycleStateAt(tables, 0)),
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
    0,
    f,
  );
  let n = 0;
  for (const st of f.structure) if (st === Structure.Liver) n++;
  return n / f.structure.length;
}

describe('the gastric fundus under the left hemidiaphragm (decision 271)', () => {
  it('no liver behind the posterior wall of the long axis, and the subcostal window keeps the left lobe', () => {
    const problems: string[] = [];
    for (const { id } of CASE_INPUTS) {
      const plax = liverShare(id, 'plax');
      const subcostal = liverShare(id, 'subcostal-4c');
      if (plax > 0.002) problems.push(`${id}: ${(plax * 100).toFixed(1)} % liver in the long axis`);
      if (subcostal < 0.04)
        problems.push(`${id}: ${(subcostal * 100).toFixed(1)} % liver in the subcostal view`);
    }
    expect(problems).toEqual([]);
  });
});
