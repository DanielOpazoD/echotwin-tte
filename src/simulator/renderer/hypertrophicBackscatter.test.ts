// @tier slow
import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
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
 * Hypertrophic myocardium echoes more than normal myocardium (decision 267). Calibrated integrated backscatter, measured
 * from the parasternal window, is some 6 dB higher in hypertrophic cardiomyopathy (septum −23.9 ± 2.9 against
 * −30 ± 0.7 dB, posterior wall −24.6 against −32), from myocyte disarray and interstitial fibrosis. The model gave the
 * hypertrophic case a normal myocardium, and its thick septum read as dark as blood in the four-chamber view (87 against
 * 65 in the cavity) and only 5 grey brighter than the normal septum in the long axis. The bound is half the published
 * difference, 3 dB: 13 grey levels at the default 60 dB dynamic range.
 */
const settings = DEFAULT_ACQUISITION;
const spec = polarSpecFor(settings, CALIBRATED_TIER);
const MARGIN_GREY = (3 / settings.dynamicRangeDb) * 255;

function septumGrey(id: string, view: string, phase: number): number {
  const c = loadCaseById(id);
  const { heart, thorax, tables } = new SimulatorCore(c, baseInput()).models;
  const beam = beamFrameFromPose(
    poseFromControl(thorax, canonicalControl(getViewTarget(view), heart, thorax)),
    1,
  );
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
  applyConsole(f, settings, createConsoleState(c.seed), d, consoleArtifacts(caseArtifactLevels(c)));
  let sum = 0,
    n = 0;
  for (let i = 0; i < d.length; i++)
    if (f.structure[i] === Structure.LvWallSeptal) {
      sum += d[i]!;
      n++;
    }
  return sum / n;
}

describe('hypertrophic myocardium echoes more than normal (decision 267)', () => {
  it('from the parasternal window the hypertrophic septum is at least 3 dB brighter than a normal one', () => {
    const problems: string[] = [];
    for (const view of ['plax', 'psax-pm'])
      for (const phase of [0, 0.35]) {
        const hcm = septumGrey('hocm-sam', view, phase);
        const normal = septumGrey('normal-excellent-window', view, phase);
        if (!(hcm >= normal + MARGIN_GREY))
          problems.push(`${view} @${phase}: ${hcm.toFixed(0)} against ${normal.toFixed(0)}`);
      }
    expect(problems).toEqual([]);
  });
});
