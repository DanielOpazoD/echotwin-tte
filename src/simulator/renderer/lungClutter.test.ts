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
import { ProceduralSliceRenderer } from './procedural/sliceRenderer';
import { scenePhysicsFor } from './scenePhysics';
import { allocPolarFrame, CALIBRATED_TIER, DEFAULT_ACQUISITION, polarSpecFor } from './types';

/**
 * The chest wall's reverberation appears over the lung too (decision 270). It is an artifact of the wall, arriving at
 * each depth whatever lies there; the renderer drew behind a pleura only the pleural reverberation, so the lung at the
 * edges of the apical sectors and behind the heart lost the clutter its neighbours carried. The echo of the lung behind
 * the posterior pleura of the long axis must grow with the scene's clutter.
 */
function lungEcho(clutterLevel: number): number {
  const c = loadCaseById('normal-excellent-window');
  const { heart, thorax, tables } = new SimulatorCore(c, baseInput()).models;
  const settings = DEFAULT_ACQUISITION;
  const spec = polarSpecFor(settings, CALIBRATED_TIER);
  const beam = beamFrameFromPose(
    poseFromControl(thorax, canonicalControl(getViewTarget('plax'), heart, thorax)),
    1,
  );
  const f = allocPolarFrame(spec);
  new ProceduralSliceRenderer().render(
    {
      heart,
      heartPose: computeHeartPose(heart, cycleStateAt(tables, 0)),
      thorax,
      physics: { ...scenePhysicsFor(c, settings, { seed: c.seed }), clutterLevel },
    },
    beam,
    spec,
    0,
    f,
  );
  const N = spec.samples,
    dr = spec.depthCm / N;
  let sum = 0;
  for (let li = 0; li < spec.lines; li++) {
    let e = -1;
    for (let s = 0; s < N; s++)
      if (f.structure[li * N + s] === Structure.Lung) {
        e = s;
        break;
      }
    // the posterior lung, 2 cm and more past its pleura
    if (e < 0 || e * dr < 6) continue;
    for (let s = e + Math.round(2 / dr); s < N; s++) sum += f.amplitude[li * N + s]!;
  }
  return sum;
}

describe('the chest wall reverberation over the lung (decision 270)', () => {
  it('the lung behind the heart echoes more with more clutter', () => {
    expect(lungEcho(0.6)).toBeGreaterThan(1.2 * lungEcho(0));
  });
});
