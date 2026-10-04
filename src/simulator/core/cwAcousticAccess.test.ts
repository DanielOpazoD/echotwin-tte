// @tier slow
import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { SimulatorCore } from './simulatorCore';
import { baseInput } from './baseInput';
import { heartLandmarks, heartToTorso } from '@/simulator/anatomy/heartModel';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import { beamFrameFromPose, poseFromControl, controlAimingAt } from '@/simulator/probe/pose';
import { sub, dot } from '@/core/vec3';
import { SPECTRAL_BINS } from '@/simulator/doppler/spectral/spectrum';

describe('CW receives from the acquired scene, independently of the previous B frame', () => {
  function inputs() {
    const c = loadCaseById('normal-excellent-window');
    const seed = new SimulatorCore(c, baseInput());
    const { heart, thorax } = seed.models;
    const ref = canonicalControl(getViewTarget('a5c'), heart, thorax);
    const rb = beamFrameFromPose(poseFromControl(thorax, ref));
    const target = heartToTorso(heart.frame, heartLandmarks(heart).find((l) => l.id === 'lvot')!.p);
    seed.dispose();
    return [0, 4].map((du) => {
      const probe = controlAimingAt(thorax, ref.u + du, ref.v, target, rb.lateral);
      const beam = beamFrameFromPose(poseFromControl(thorax, probe)),
        d = sub(target, beam.origin);
      const input = baseInput({
        modality: 'cw',
        quality: 'low',
        probe,
        gateDepthCm: Math.hypot(dot(d, beam.forward), dot(d, beam.lateral)),
        cursorThetaRad: Math.atan2(dot(d, beam.lateral), dot(d, beam.forward)),
      });
      input.settings.frequencyMHz = 1.5;
      input.settings.depthCm = 20;
      input.spectral.wallFilterMps = 0;
      return input;
    });
  }
  const c = loadCaseById('normal-excellent-window');
  function acquire(core: SimulatorCore) {
    const before = core.spectralStrip;
    const head = before.head;
    const out = core.step(0.1);
    if (out) core.recycle(out.rgba);
    const strip = core.spectralStrip;
    let peak = 0;
    // A new acquisition can reset storage; otherwise inspect only newly acquired columns, including wrap.
    for (let i = before.data === strip.data ? head : 0; i < strip.head; i++) {
      const offset = (i % strip.cols) * SPECTRAL_BINS;
      for (const v of strip.data!.subarray(offset, offset + SPECTRAL_BINS))
        peak = Math.max(peak, v);
    }
    return peak;
  }
  it('rejects blood behind lung from the first column, before any B frame exists', () => {
    const core = new SimulatorCore(c, inputs()[1]!);
    try {
      expect(acquire(core)).toBeLessThan(0.15);
    } finally {
      core.dispose();
    }
  });
  it('loses and recovers signal immediately when the real probe crosses the acoustic window', () => {
    const [open, blocked] = inputs();
    const core = new SimulatorCore(c, open!);
    try {
      expect(acquire(core)).toBeGreaterThan(0.5);
      core.setInput(blocked!);
      expect(acquire(core)).toBeLessThan(0.15);
      core.setInput(open!);
      expect(acquire(core)).toBeGreaterThan(0.5);
    } finally {
      core.dispose();
    }
  });
});
