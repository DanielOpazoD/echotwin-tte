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

describe('spectral power responds to acquired probe coupling', () => {
  it('progressively loses received signal instead of keeping full intensity until a binary cutoff', () => {
    const c = loadCaseById('normal-excellent-window');
    const seed = new SimulatorCore(c, baseInput());
    const { heart, thorax } = seed.models;
    const ref = canonicalControl(getViewTarget('a5c'), heart, thorax);
    const rb = beamFrameFromPose(poseFromControl(thorax, ref));
    const target = heartToTorso(heart.frame, heartLandmarks(heart).find((l) => l.id === 'lvot')!.p);
    seed.dispose();
    const peaks = [0.35, 0.07, 0.035, 0.007, 0].map((pressure) => {
      const probe = controlAimingAt(thorax, ref.u, ref.v, target, rb.lateral, pressure);
      const b = beamFrameFromPose(poseFromControl(thorax, probe)),
        d = sub(target, b.origin);
      const input = baseInput({
        modality: 'pw',
        quality: 'low',
        probe,
        gateDepthCm: Math.hypot(dot(d, b.forward), dot(d, b.lateral)),
        cursorThetaRad: Math.atan2(dot(d, b.lateral), dot(d, b.forward)),
      });
      input.settings.frequencyMHz = 1.5;
      input.spectral.wallFilterMps = 0;
      const core = new SimulatorCore(c, input);
      try {
        for (let i = 0; i < 4; i++) {
          const out = core.step(0.05);
          if (out) core.recycle(out.rgba);
        }
        const strip = core.spectralStrip;
        return Math.max(...strip.data!.subarray(0, strip.head * SPECTRAL_BINS));
      } finally {
        core.dispose();
      }
    });
    expect(peaks[0]).toBeGreaterThan(0.9);
    for (let i = 1; i < peaks.length; i++) expect(peaks[i]).toBeLessThan(peaks[i - 1]!);
    expect(peaks[3]).toBeLessThan(0.15);
    expect(peaks[4]).toBeLessThan(0.125);
  });
});
