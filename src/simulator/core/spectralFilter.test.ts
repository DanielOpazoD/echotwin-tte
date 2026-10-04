// @tier slow
import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { dot, sub } from '@/core/vec3';
import { heartLandmarks, heartToTorso } from '@/simulator/anatomy/heartModel';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import { beamFrameFromPose, poseFromControl, controlAimingAt } from '@/simulator/probe/pose';
import { SPECTRAL_BINS } from '@/simulator/doppler/spectral/spectrum';
import { SimulatorCore } from './simulatorCore';
import { baseInput } from './baseInput';

describe('the acquired PW wall filter acts on sampled frequency', () => {
  it('removes a real LVOT signal when it aliases into the stop band, while preserving flow outside it', () => {
    const c = loadCaseById('normal-excellent-window'),
      seed = new SimulatorCore(c, baseInput()),
      { heart, thorax } = seed.models;
    const ref = canonicalControl(getViewTarget('a5c'), heart, thorax),
      refBeam = beamFrameFromPose(poseFromControl(thorax, ref));
    const target = heartToTorso(heart.frame, heartLandmarks(heart).find((l) => l.id === 'lvot')!.p);
    seed.dispose();
    const probe = controlAimingAt(thorax, ref.u, ref.v, target, refBeam.lateral),
      beam = beamFrameFromPose(poseFromControl(thorax, probe)),
      d = sub(target, beam.origin);
    const input = baseInput({
      modality: 'pw',
      probe,
      gateDepthCm: Math.hypot(dot(d, beam.forward), dot(d, beam.lateral)),
      cursorThetaRad: Math.atan2(dot(d, beam.lateral), dot(d, beam.forward)),
    });
    input.settings.depthCm = 20;
    input.settings.frequencyMHz = 1.5;
    input.spectral.scaleMps = 0.3;
    input.spectral.wallFilterMps = 0.08;
    const core = new SimulatorCore(c, input);
    try {
      for (let i = 0; i < 30; i++) core.step(0.05);
      const strip = core.spectralStrip;
      let stopBand = 0,
        passBand = 0;
      for (let col = 0; col < Math.min(strip.head, strip.cols); col++)
        for (let b = 0; b < SPECTRAL_BINS; b++) {
          const v = 0.3 - ((b + 0.5) * 0.6) / SPECTRAL_BINS,
            value = strip.data![col * SPECTRAL_BINS + b]!;
          if (Math.abs(v) < 0.04) stopBand = Math.max(stopBand, value);
          const t = strip.phase[col]! * core.models.tables.rrS;
          const timings = core.models.tables.timings;
          if (
            Math.abs(v) > 0.12 &&
            t > timings.ejectionStartS + 0.06 &&
            t < timings.ejectionEndS - 0.04
          )
            passBand = Math.max(passBand, value);
        }
      expect(passBand).toBeGreaterThan(0.35);
      expect(stopBand).toBeLessThan(0.15); // calibrated receiver noise remains; no flow power in the stop band
    } finally {
      core.dispose();
    }
  });
});
