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
 * Calcified cusps reflect more than healthy ones (decision 266). Soft tissue against hydroxyapatite reflects far more
 * than against fibrous valve tissue (impedance about 7 against 1.6–1.7 MRayl, R ≈ 0.6), which is why calcium is graded
 * by an echo as dense as the pericardium. Since decision 251 the calcium of a stenotic valve shadows what lies behind
 * it, but its echo stayed weak, so the severe stenosis showed a valve darker than a normal one: its leading echo on the
 * lines that cross it, what an echocardiographer grades, read 156 of grey in the long axis at end-diastole against 200
 * for the healthy valve.
 */
const settings = DEFAULT_ACQUISITION;
const spec = polarSpecFor(settings, CALIBRATED_TIER);

/** Median over the scan lines that cross the aortic valve of the brightest valve sample on each. */
function leadingEcho(id: string, view: string, phase: number): number {
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
  const N = spec.samples;
  const tops: number[] = [];
  for (let li = 0; li < spec.lines; li++) {
    let top = -1;
    for (let s = 0; s < N; s++)
      if (f.structure[li * N + s] === Structure.AorticValve) top = Math.max(top, d[li * N + s]!);
    if (top >= 0) tops.push(top);
  }
  tops.sort((a, b) => a - b);
  return tops.length > 5 ? tops[tops.length >> 1]! : NaN;
}

describe('calcified cusps reflect more than healthy ones (decision 266)', () => {
  it('closed, the leading echo of the severely stenotic valve is brighter than that of the healthy valve', () => {
    const problems: string[] = [];
    // closed valves only: in systole the healthy leaflets open parallel to the root walls and face the long-axis beam
    // squarely (a specular echo of 234 against 220), while the stenotic ones barely open
    for (const view of ['plax', 'psax-av']) {
      const calcified = leadingEcho('aortic-stenosis-severe', view, 0);
      const healthy = leadingEcho('normal-excellent-window', view, 0);
      if (!(calcified > healthy))
        problems.push(`${view}: calcified ${calcified} against healthy ${healthy}`);
    }
    expect(problems).toEqual([]);
  });
});
