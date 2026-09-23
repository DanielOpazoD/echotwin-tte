import { describe, expect, it } from 'vitest';
import { DEFAULT_ACQUISITION, polarSpecFor } from './types';
import { DEFAULT_COLOR } from '@/simulator/doppler/color/colorDoppler';
import { acquisitionFrameRate, cadenceHz } from './frameRate';

/**
 * The acquisition frame rate of the console (decision 178): conventional 2D echocardiography runs at about 40–80
 * frames/s (Fujikura et al., J Clin Med 2021) and focused colour Doppler at 10–30 (Puig et al., IEEE TUFFC 2024); the
 * panel asked for 45–70 Hz with the default console at 16 cm and 80°. It teaches the trade-offs of a real console, so
 * each control moves it the way it moves a scanner's.
 */
describe('the acquisition frame rate', () => {
  it('is 45–70 Hz with the default console, and 10–30 Hz with the default colour box', () => {
    const bmode = acquisitionFrameRate(DEFAULT_ACQUISITION);
    expect(bmode).toBeGreaterThanOrEqual(45);
    expect(bmode).toBeLessThanOrEqual(70);
    const colour = acquisitionFrameRate(DEFAULT_ACQUISITION, DEFAULT_COLOR);
    expect(colour).toBeGreaterThanOrEqual(10);
    expect(colour).toBeLessThanOrEqual(30);
  });

  it('falls with depth, sector width, line density and the width and depth of the colour box', () => {
    const at = (s: Partial<typeof DEFAULT_ACQUISITION>, c?: Partial<typeof DEFAULT_COLOR>) =>
      acquisitionFrameRate(
        { ...DEFAULT_ACQUISITION, ...s },
        c ? { ...DEFAULT_COLOR, ...c } : undefined,
      );
    const base = at({});
    expect(at({ depthCm: 20 })).toBeLessThan(base);
    expect(at({ sectorDeg: 90 })).toBeLessThan(base);
    expect(at({ lineDensity: 'high' })).toBeLessThan(base);
    expect(at({ lineDensity: 'low' })).toBeGreaterThan(base);
    const colour = at({}, {});
    expect(colour).toBeLessThan(base);
    expect(at({}, { boxThetaMinRad: -0.5, boxThetaMaxRad: 0.5 })).toBeLessThan(colour);
    expect(at({}, { boxRMaxCm: 16 })).toBeLessThan(colour);
  });
});

describe('the cadence', () => {
  it('never exceeds the acquisition rate, and keeps the pre-178 cadence of each tier with the default console', () => {
    const before = { low: 48.8, medium: 36.9, high: 27.3 };
    for (const tier of ['low', 'medium', 'high'] as const) {
      const spec = polarSpecFor(DEFAULT_ACQUISITION, tier);
      const hz = cadenceHz(spec, acquisitionFrameRate(DEFAULT_ACQUISITION));
      expect(Number(hz.toFixed(1))).toBe(before[tier]);
      for (const acquisition of [10, 30, 200])
        expect(cadenceHz(spec, acquisition)).toBeLessThanOrEqual(acquisition);
    }
  });
});
