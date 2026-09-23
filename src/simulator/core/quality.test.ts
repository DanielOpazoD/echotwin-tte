import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { CALIBRATED_TIER, polarSpecFor } from '@/simulator/renderer/types';
import { baseInput } from './baseInput';
import { DEFAULT_QUALITY } from './protocol';
import { resolveQualityTier } from './quality';
import { SimulatorCore } from './simulatorCore';

/** The quality the app opens on is the tier the clinical comparison calibrates, when the GPU forms the image (decision 154). */
describe('quality tier', () => {
  it('resolves «auto» to the calibrated tier with a GPU and to medium on the CPU tracer; fixed tiers stay', () => {
    expect(DEFAULT_QUALITY).toBe('auto');
    expect(resolveQualityTier('auto', true)).toBe(CALIBRATED_TIER);
    expect(CALIBRATED_TIER).toBe('high');
    expect(resolveQualityTier('auto', false)).toBe('medium');
    for (const t of ['low', 'medium', 'high'] as const) {
      expect(resolveQualityTier(t, true)).toBe(t);
      expect(resolveQualityTier(t, false)).toBe(t);
    }
  });

  it('renders «auto» without a GPU (Node) on the medium grid and reports the tier it used', () => {
    const input = baseInput({ quality: 'auto' });
    const core = new SimulatorCore(loadCaseById('normal-excellent-window'), input);
    let out = core.step(0.05);
    for (let i = 0; i < 3 && !out; i++) out = core.step(0.05);
    expect(out).not.toBeNull();
    const medium = polarSpecFor(input.settings, 'medium');
    expect(out!.stats['tier']).toBe('medium');
    expect(out!.polar.lines).toBe(medium.lines);
    expect(out!.polar.samples).toBe(medium.samples);
  }, 60_000);
});
