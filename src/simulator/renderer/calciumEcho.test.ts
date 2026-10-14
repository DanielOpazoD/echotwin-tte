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

/**
 * Median over the scan lines that cross the aortic valve of the brightest valve sample on each, and of the length (mm)
 * of each line within 5 mm of the valve brighter than 200 of grey: how thick the valve's echo reads.
 */
function valveEcho(id: string, view: string, phase: number): { top: number; brightMm: number } {
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
  const dr = spec.depthCm / N;
  const w = Math.round(0.5 / dr);
  const tops: number[] = [];
  const bright: number[] = [];
  for (let li = 0; li < spec.lines; li++) {
    let top = -1,
      first = -1,
      last = -1;
    for (let s = 0; s < N; s++)
      if (f.structure[li * N + s] === Structure.AorticValve) {
        top = Math.max(top, d[li * N + s]!);
        if (first < 0) first = s;
        last = s;
      }
    if (top < 0) continue;
    tops.push(top);
    let n = 0;
    for (let s = Math.max(0, first - w); s <= Math.min(N - 1, last + w); s++)
      if (d[li * N + s]! >= 200) n++;
    bright.push(n * dr * 10);
  }
  const median = (v: number[]) => {
    const s = [...v].sort((a, b) => a - b);
    return s.length > 5 ? s[s.length >> 1]! : NaN;
  };
  return { top: median(tops), brightMm: median(bright) };
}
const leadingEcho = (id: string, view: string, phase: number): number =>
  valveEcho(id, view, phase).top;

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

  it('closed, the severely stenotic valve reads thick and bright in the long axis, the healthy one does not (decision 316)', () => {
    // the limitation said the calcium put out the cusp behind its first millimetre, a point or a line; measured again,
    // 7.5 mm of each line crossing the closed stenotic valve is brighter than 200 against none for the healthy one
    const calcified = valveEcho('aortic-stenosis-severe', 'plax', 0).brightMm;
    const healthy = valveEcho('normal-excellent-window', 'plax', 0).brightMm;
    expect(calcified, `stenotic ${calcified} mm, healthy ${healthy} mm`).toBeGreaterThanOrEqual(3);
    expect(healthy).toBeLessThan(1.5);
  });
});
