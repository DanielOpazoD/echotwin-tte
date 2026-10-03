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
 * Both papillary muscles stand out in the papillary short axis (decision 265). Their fibres run along the muscle, near
 * the long axis, so the short-axis beam crosses them and they scatter at least as strongly as the wall around them,
 * whose fibres it crosses only in part. They took the surface-normal response of tissue without a known fibre
 * direction, bright only where their surface faced the beam: in 23 of 24 frames one of them came out darker than the
 * mean of the LV wall (the posteromedial one 114 against 116 and 87 against 98 in the normal case), and an expert saw a
 * single papillary muscle. The difficult window and the artifact challenge degrade the image by design and are left out.
 *
 * Declared (baseline: the dimmer muscle minus the wall, grey levels); a declared frame that comes within the bound, or
 * moves more than 3 grey from its baseline, fails the test.
 */
const KNOWN_DIM_PAPILLARY: ReadonlyMap<string, number> = new Map([['af-diastolic @0', -2]]);
const TOLERANCE = 3;
const POOR_WINDOWS = new Set(['normal-difficult-window', 'artifact-challenge']);

describe('papillary muscles scatter across their fibres (decision 265)', () => {
  it('in the papillary short axis each papillary muscle is at least as bright as the LV wall', () => {
    const out = { outside: [] as string[], stale: [] as string[], moved: [] as string[] };
    for (const { id } of CASE_INPUTS) {
      if (POOR_WINDOWS.has(id)) continue;
      const c = loadCaseById(id);
      const { heart, thorax, tables } = new SimulatorCore(c, baseInput()).models;
      const settings = DEFAULT_ACQUISITION;
      const spec = polarSpecFor(settings, CALIBRATED_TIER);
      const beam = beamFrameFromPose(
        poseFromControl(thorax, canonicalControl(getViewTarget('psax-pm'), heart, thorax)),
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
        const N = spec.samples;
        // the two muscles lie on either side of the median scan line of their samples
        const lines: number[] = [];
        for (let i = 0; i < d.length; i++)
          if (f.structure[i] === Structure.PapillaryMuscle) lines.push(Math.floor(i / N));
        lines.sort((a, b) => a - b);
        const cut = lines[lines.length >> 1]!;
        const sum = [0, 0],
          count = [0, 0];
        let wall = 0,
          wn = 0;
        for (let i = 0; i < d.length; i++) {
          const st = f.structure[i]!;
          if (st === Structure.PapillaryMuscle) {
            const k = Math.floor(i / N) < cut ? 0 : 1;
            sum[k] = sum[k]! + d[i]!;
            count[k] = count[k]! + 1;
          } else if (st >= Structure.LvWallSeptal && st <= Structure.LvApex) {
            wall += d[i]!;
            wn++;
          }
        }
        const margin = Math.min(sum[0]! / count[0]!, sum[1]! / count[1]!) - wall / wn;
        const key = `${id} @${phase}`;
        const known = KNOWN_DIM_PAPILLARY.get(key);
        if (known === undefined) {
          if (margin < 0) out.outside.push(`${key}: ${margin.toFixed(1)}`);
        } else if (margin >= 0) out.stale.push(`${key}: ${margin.toFixed(1)}`);
        else if (Math.abs(margin - known) > TOLERANCE)
          out.moved.push(`${key}: ${margin.toFixed(1)} against ${known}`);
      }
    }
    expect(out).toEqual({ outside: [], stale: [], moved: [] });
  });
});
