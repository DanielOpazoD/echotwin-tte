import { describe, expect, it } from 'vitest';
import {
  ATTEN_NP_PER_DB,
  attenuationFrequencyMHz,
  HARMONIC_ATTEN_FACTOR,
  SOFT_TISSUE_ATTEN_DB,
  softTissueTransmission,
} from './acoustics';

/**
 * One definition of what an acquisition loses through tissue (decision 168): the renderer, the GPU parameters, the colour
 * shadow and the view engine's shadow test read it. The view engine applied the harmonic factor with harmonics off and
 * expected 1.2 times the soft-tissue loss of the image it judged.
 */
describe('the attenuation of an acquisition', () => {
  it('scales with the transmit frequency, and with the harmonic factor only with harmonics on', () => {
    expect(attenuationFrequencyMHz(2.5, false)).toBe(2.5);
    expect(attenuationFrequencyMHz(2.5, true)).toBeCloseTo(2.5 * HARMONIC_ATTEN_FACTOR, 12);
  });
  it('leaves through soft tissue the two-way transmission of its attenuation', () => {
    for (const harmonics of [false, true]) {
      const f = attenuationFrequencyMHz(2.5, harmonics);
      expect(softTissueTransmission(10, 2.5, harmonics)).toBeCloseTo(
        Math.exp(-ATTEN_NP_PER_DB * SOFT_TISSUE_ATTEN_DB * f * 10),
        12,
      );
    }
    expect(softTissueTransmission(10, 2.5, false)).toBeGreaterThan(
      softTissueTransmission(10, 2.5, true),
    );
  });
});
