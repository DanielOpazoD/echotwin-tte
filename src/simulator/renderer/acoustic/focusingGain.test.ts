import { describe, expect, it } from 'vitest';
import { focusingGain } from './acoustics';
import {
  consoleCompensation,
  DEPTH_COMPENSATION_DB_PER_CM_MHZ,
} from '../postprocess/consolePipeline';
import { DEFAULT_ACQUISITION, polarSpecFor } from '../types';

/**
 * The beam's on-axis sensitivity (decision 144): unity at the transmit focus, lowest at the transducer face, rising
 * monotonically towards the focus and falling again beyond it; the console's default curve gives back the far-side
 * loss and none of the near-side one.
 */
describe('focusing gain', () => {
  it('is 1 at the focus, lowest at the face and monotonic on each side', () => {
    const F = 9;
    expect(focusingGain(F, F)).toBeCloseTo(1, 6);
    const face = focusingGain(0, F);
    expect(face).toBeLessThan(0.4);
    expect(face).toBeGreaterThan(0.15);
    let prev = face;
    for (let r = 0.5; r <= F; r += 0.5) {
      const g = focusingGain(r, F);
      expect(g).toBeGreaterThan(prev);
      prev = g;
    }
    for (let r = F + 0.5; r <= 20; r += 0.5) {
      const g = focusingGain(r, F);
      expect(g).toBeLessThan(prev);
      prev = g;
    }
    // at the face the beam is the aperture whatever the focus; at 3 cm a shallow focus is already narrowing the beam
    expect(focusingGain(0, 12)).toBeCloseTo(focusingGain(0, 6), 6);
    expect(focusingGain(3, 12)).toBeLessThan(focusingGain(3, 6));
  });

  it('the console restores the loss beyond the focus and leaves the near field to fall', () => {
    const spec = polarSpecFor(DEFAULT_ACQUISITION, 'medium');
    const settings = { ...DEFAULT_ACQUISITION, gainDb: 0, tgcDb: [0, 0, 0, 0, 0, 0, 0, 0] };
    const comp = new Float64Array(spec.samples);
    consoleCompensation(settings, spec, comp);
    const dr = spec.depthCm / spec.samples;
    const slope = DEPTH_COMPENSATION_DB_PER_CM_MHZ * settings.frequencyMHz;
    for (let si = 0; si < spec.samples; si++) {
      const r = (si + 0.5) * dr;
      const attenuationOnly = Math.pow(10, (slope * r) / 20);
      const net = comp[si]! * focusingGain(r, spec.focusCm);
      if (r >= spec.focusCm) expect(net / attenuationOnly).toBeCloseTo(1, 6);
      else expect(net / attenuationOnly).toBeLessThan(1);
    }
  });
});
