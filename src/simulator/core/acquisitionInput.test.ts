import { describe, expect, it } from 'vitest';
import { baseInput } from './baseInput';
import { acquisitionLimits, constrainAcquisition } from './acquisitionInput';
import { pulsedAcquisition } from '@/simulator/renderer/pulseTiming';
import { acquisitionFrameRate } from '@/simulator/renderer/frameRate';

describe('range-unambiguous Doppler acquisition', () => {
  it('obeys the round-trip budget and the Doppler equation in physical units', () => {
    const a = pulsedAcquisition(20, 2.5, 5);
    expect(a.maxPrfHz).toBeCloseTo(1 / (0.4 / 1540 + 0.00002), 8);
    expect(a.scaleMps).toBeCloseTo((1540 * a.prfHz) / (4 * 2.5e6), 10);
    expect(a.prfHz).toBe(a.maxPrfHz);
    expect(a.scaleMps).toBeLessThan(0.6);
    expect(pulsedAcquisition(10, 2.5, 5).scaleMps).toBeGreaterThan(a.scaleMps);
    expect(pulsedAcquisition(20, 5, 5).scaleMps).toBeCloseTo(a.scaleMps / 2, 10);
  });

  it('uses the far edge of a PW gate and the color box, leaving CW unrestricted', () => {
    const input = baseInput({ modality: 'pw', gateDepthCm: 18 });
    input.settings.depthCm = 20;
    input.spectral.scaleMps = 6;
    input.spectral.gateLengthCm = 1;
    input.color.scaleMps = 3;
    const next = constrainAcquisition(input);
    expect(next.spectral.scaleMps).toBe(pulsedAcquisition(18.5, 2.5, 6).scaleMps);
    expect(next.color.scaleMps).toBe(pulsedAcquisition(13, 2.5, 3).scaleMps);
    expect(input.spectral.scaleMps).toBe(6);
    expect(constrainAcquisition({ ...input, modality: 'cw' }).spectral.scaleMps).toBe(6);
    expect(constrainAcquisition({ ...input, modality: 'tdi' }).spectral.scaleMps).toBe(
      next.spectral.scaleMps,
    );
    expect(constrainAcquisition({ ...input, modality: 'cmm' }).color.scaleMps).toBe(
      pulsedAcquisition(20, 2.5, 3).scaleMps,
    );
  });

  it('does not invent extra PRF from baseline shift, harmonic imaging or display depth', () => {
    const input = baseInput({ modality: 'pw' });
    const before = acquisitionLimits(input).spectral;
    input.spectral.baselineShiftMps = 2;
    input.settings.harmonics = !input.settings.harmonics;
    input.settings.depthCm = 22;
    expect(acquisitionLimits(input).spectral).toEqual(before);
  });

  it('spends more time collecting low-PRF color packets', () => {
    const input = baseInput();
    const fast = acquisitionFrameRate(input.settings, input.color);
    const slow = acquisitionFrameRate(input.settings, { ...input.color, scaleMps: 0.15 });
    expect(slow).toBeLessThan(fast);
  });
});
