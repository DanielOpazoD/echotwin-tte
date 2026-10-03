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
 * The chest-wall reverberation fades within the first centimetres (decision 264). A replica needs two more reflections,
 * the strongest at the transducer face against the skin (R ≈ 0.2–0.3), so it loses some R² ≈ 0.06 per wall thickness
 * (~2 cm): an e-fold of about 0.7 cm. With the inherited 1.8 cm the reverberation filled the right ventricle of the
 * parasternal views, 2–5 cm deep, and its blood read 24–45 grey above the left ventricle's in the long axis and the
 * papillary short axis (33 of 48 frames more than 15 above; 10 with the 0.8 cm decay, 9 since the brighter papillary muscles of decision 265, declared below). The same blood at similar depths should differ by little
 * more than the haze between them: at most a quarter of the cavity–myocardium contrast (~60), 15 grey.
 *
 * Declared (baseline in grey above the left ventricle): the small cavities beside thick or bright walls, where the haze
 * and the wall's point-spread function weigh more. A declared frame that comes within the bound, or moves more than
 * 3 grey from its baseline, fails the test so the list stays honest.
 */
const BOUND = 15;
const TOLERANCE = 3;
const KNOWN_RV_EXCESS: ReadonlyMap<string, number> = new Map([
  ['hfref-severe-mr plax @0', 16],
  ['hfref-severe-mr plax @0.35', 16],
  ['hfref-severe-mr psax-pm @0', 17],
  ['inferior-rwma psax-pm @0', 16],
  ['aortic-stenosis-severe psax-pm @0', 15.8],
  ['hocm-sam plax @0', 25],
  ['hocm-sam plax @0.35', 17],
  ['hocm-sam psax-pm @0', 19],
  ['artifact-challenge plax @0.35', 17],
]);

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
  return sum / n;
};

describe('the near-field reverberation fades within the chest wall (decision 264)', () => {
  it('the right ventricle of the parasternal views is not much brighter than the left', () => {
    const out = { outside: [] as string[], stale: [] as string[], moved: [] as string[] };
    for (const { id } of CASE_INPUTS) {
      const c = loadCaseById(id);
      const { heart, thorax, tables } = new SimulatorCore(c, baseInput()).models;
      const settings = DEFAULT_ACQUISITION;
      const spec = polarSpecFor(settings, CALIBRATED_TIER);
      for (const view of ['plax', 'psax-pm']) {
        const beam = beamFrameFromPose(
          poseFromControl(thorax, canonicalControl(getViewTarget(view), heart, thorax)),
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
          const excess =
            mean(d, f.structure, Structure.RvCavity) - mean(d, f.structure, Structure.LvCavity);
          const key = `${id} ${view} @${phase}`;
          const known = KNOWN_RV_EXCESS.get(key);
          if (known === undefined) {
            if (excess > BOUND) out.outside.push(`${key}: ${excess.toFixed(1)}`);
          } else if (excess <= BOUND) out.stale.push(`${key}: ${excess.toFixed(1)}`);
          else if (Math.abs(excess - known) > TOLERANCE)
            out.moved.push(`${key}: ${excess.toFixed(1)} against ${known}`);
        }
      }
    }
    expect(out).toEqual({ outside: [], stale: [], moved: [] });
  });
});
