import { describe, expect, it } from 'vitest';
import { computeGroundTruth } from './groundTruth';
import { normalExcellentCase } from '@/cases/normal-excellent';
import { validateCase } from '@/cases/schema';

const c = validateCase(normalExcellentCase).case!;

describe('ground truth coherence (spec 36: golden checks)', () => {
  const gt = computeGroundTruth(c);
  it('LVOT Doppler SV equals volumetric SV (no regurgitation)', () => {
    expect(
      Math.abs(gt.lvot.strokeVolumeMl - gt.lv.strokeVolumeMl) / gt.lv.strokeVolumeMl,
    ).toBeLessThan(0.02);
  });
  it('continuity AVA equals the configured effective area', () => {
    expect(gt.aorticValve.continuityAvaCm2).toBeCloseTo(c.hemodynamics.avEffectiveAreaCm2, 2);
  });
  it('Bernoulli gradients consistent with Vmax', () => {
    expect(gt.aorticValve.peakGradientMmHg).toBeCloseTo(4 * gt.aorticValve.vmaxMps ** 2, 6);
    expect(gt.aorticValve.meanGradientMmHg).toBeLessThan(gt.aorticValve.peakGradientMmHg);
  });
  it('normal case has physiologic LVOT VTI and velocities', () => {
    expect(gt.lvot.vtiCm).toBeGreaterThan(16);
    expect(gt.lvot.vtiCm).toBeLessThan(28);
    expect(gt.lvot.vmaxMps).toBeGreaterThan(0.7);
    expect(gt.lvot.vmaxMps).toBeLessThan(1.4);
    expect(gt.aorticValve.vmaxMps).toBeLessThan(1.9);
    expect(gt.lv.efPct).toBeCloseTo(62.5, 0);
  });
  it('TR-derived RVSP coherent with PASP', () => {
    expect(gt.rightHeart.rvspMmHg).toBeCloseTo(c.hemodynamics.paspMmHg, 5);
  });
});
