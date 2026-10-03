// @tier slow
import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { buildCaseModels, REST_PATIENT } from '@/simulator/anatomy/caseModels';
import { computeHeartPose } from '@/simulator/anatomy/heartModel';
import { Structure, Tissue, TISSUE_PROPS } from '@/simulator/anatomy/tissue';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { ProceduralSliceRenderer } from '@/simulator/renderer/procedural/sliceRenderer';
import { scenePhysicsFor } from '@/simulator/renderer/scenePhysics';
import {
  allocPolarFrame,
  DEFAULT_ACQUISITION,
  polarSpecFor,
  type Scene,
} from '@/simulator/renderer/types';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import { CALCIUM_ATTEN_DB, CALCIUM_ATTEN_THRESHOLD, calciumAttenDb } from './acoustics';

/**
 * A calcified valve shadows what lies behind it (decision 251). A calcified leaflet added a fixed ≈ 4.4 dB·cm⁻¹·MHz⁻¹, a
 * sixth of the attenuation the model gives calcium, and the severely stenotic aortic valve took 2.5–3.9 dB off the
 * beam that crossed it (5–8 dB of shadow on the screen, where the panel asked for at least 15).
 */
describe('calcium shadow (decision 251)', () => {
  it('the calcium share of a leaflet attenuates as calcium does, and a fibrous one adds nothing', () => {
    expect(CALCIUM_ATTEN_DB).toBe(TISSUE_PROPS[Tissue.Calcium]!.attenuation);
    expect(calciumAttenDb(CALCIUM_ATTEN_THRESHOLD)).toBe(0);
    expect(calciumAttenDb(0.3)).toBe(0);
    expect(calciumAttenDb(1)).toBe(CALCIUM_ATTEN_DB);
    expect(calciumAttenDb(0.7)).toBeCloseTo(CALCIUM_ATTEN_DB / 2, 12);
  });

  /** Median two-way transmission (dB) across the aortic valve on the lines that cross ≥ 1 mm of it. */
  function acrossValve(id: string, view: string, phase: number): number {
    const c = loadCaseById(id);
    const { thorax, heart, tables } = buildCaseModels(c, REST_PATIENT);
    const spec = polarSpecFor(DEFAULT_ACQUISITION, 'high');
    const beam = beamFrameFromPose(
      poseFromControl(thorax, canonicalControl(getViewTarget(view), heart, thorax)),
      1,
    );
    const scene: Scene = {
      heart,
      heartPose: computeHeartPose(heart, cycleStateAt(tables, phase)),
      thorax,
      physics: scenePhysicsFor(c, DEFAULT_ACQUISITION),
    };
    const f = allocPolarFrame(spec);
    new ProceduralSliceRenderer().render(scene, beam, spec, phase, f);
    const S = spec.samples,
      dr = spec.depthCm / S;
    const losses: number[] = [];
    for (let li = 0; li < spec.lines; li++) {
      let first = -1,
        last = -1;
      for (let s = 0; s < S; s++)
        if (f.structure[li * S + s] === Structure.AorticValve) {
          if (first < 0) first = s;
          last = s;
        }
      if (first < 0 || (last - first + 1) * dr < 0.1) continue;
      const before = f.transmission[li * S + Math.max(0, first - 3)]!;
      const after = f.transmission[li * S + Math.min(S - 1, last + 3)]!;
      losses.push(10 * Math.log10(after / before));
    }
    expect(losses.length, `${id} ${view}`).toBeGreaterThan(5);
    return [...losses].sort((a, b) => a - b)[Math.floor(losses.length / 2)]!;
  }

  it('the severely stenotic valve takes at least 15 dB off the beam that crosses it; a normal one almost nothing', () => {
    const out: string[] = [];
    for (const view of ['plax', 'psax-av'])
      for (const phase of [0, 0.25]) {
        const severe = acrossValve('aortic-stenosis-severe', view, phase);
        const normal = acrossValve('normal-excellent-window', view, phase);
        if (!(severe < -15)) out.push(`severe stenosis ${view} @${phase}: ${severe.toFixed(1)} dB`);
        if (!(normal > -2)) out.push(`normal ${view} @${phase}: ${normal.toFixed(1)} dB`);
      }
    expect(out).toEqual([]);
  });
});
