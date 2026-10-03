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
import { applyConsole, createConsoleState } from './postprocess/consolePipeline';
import { ProceduralSliceRenderer } from './procedural/sliceRenderer';
import { caseArtifactLevels, consoleArtifacts, scenePhysicsFor } from './scenePhysics';
import { allocPolarFrame, CALIBRATED_TIER, DEFAULT_ACQUISITION, polarSpecFor } from './types';

/**
 * The chest-wall reverberation is not reinforced behind blood or fluid (decision 263). It reaches each depth through the
 * wall, so it carries at most the loss of average soft tissue; the renderer scaled it by the transmission of the beam's
 * axis like a true echo, and behind the blood of the ventricle (0.18 dB/cm/MHz against 0.5) the receiver's depth gain
 * lifted it: the left atrium of the four-chamber view came out brighter than the septum in fifteen of twenty-four frames
 * (98–125 against 95–120 at end-diastole), and as bright as the brighter wall or brighter in the inferior infarct, the
 * severe stenosis and the hypertrophic case at end-diastole. Blood scatters some 30 dB below myocardium, so a cavity
 * brighter than both walls cannot be. The difficult window is left out: its walls fall into the floor
 * (docs/LIMITATIONS.md).
 */
const mean = (
  d: Uint8ClampedArray,
  st: Uint8Array | Uint16Array | Int32Array,
  s: Structure,
): number => {
  let sum = 0,
    n = 0;
  for (let i = 0; i < d.length; i++)
    if (st[i] === s) {
      sum += d[i]!;
      n++;
    }
  return n > 200 ? sum / n : NaN;
};

describe('cavity clutter is not reinforced behind blood (decision 263)', () => {
  it('the left atrium of the four-chamber view is darker than the brighter of the walls beside it', () => {
    const problems: string[] = [];
    for (const { id } of CASE_INPUTS) {
      if (id === 'normal-difficult-window') continue;
      const c = loadCaseById(id);
      const { heart, thorax, tables } = new SimulatorCore(c, baseInput()).models;
      const settings = DEFAULT_ACQUISITION;
      const spec = polarSpecFor(settings, CALIBRATED_TIER);
      const beam = beamFrameFromPose(
        poseFromControl(thorax, canonicalControl(getViewTarget('a4c'), heart, thorax)),
        1,
      );
      for (const phase of [0, 0.35]) {
        const f = allocPolarFrame(spec);
        new ProceduralSliceRenderer().render(
          {
            heart,
            heartPose: computeHeartPose(heart, cycleStateAt(tables, phase)),
            thorax,
            physics: scenePhysicsFor(c, settings, { seed: c.seed }),
          },
          beam,
          spec,
          phase,
          f,
        );
        const d = new Uint8ClampedArray(spec.lines * spec.samples);
        applyConsole(
          f,
          settings,
          createConsoleState(c.seed),
          d,
          consoleArtifacts(caseArtifactLevels(c)),
        );
        const la = mean(d, f.structure, Structure.LaCavity);
        const wall = Math.max(
          mean(d, f.structure, Structure.LvWallSeptal),
          mean(d, f.structure, Structure.LvWallLateral),
        );
        if (!(la < wall))
          problems.push(
            `${id} @${phase}: atrium ${la.toFixed(0)} against walls ${wall.toFixed(0)}`,
          );
      }
    }
    expect(problems).toEqual([]);
  });
});
