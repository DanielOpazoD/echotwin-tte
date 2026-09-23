import { describe, expect, it } from 'vitest';
import { DEFAULT_QUALITY } from '@/simulator/core/protocol';
import { resolveQualityTier } from '@/simulator/core/quality';
import { CALIBRATED_TIER } from '@/simulator/renderer/types';
import { useSimStore } from './store';

/** The app opens on the automatic quality, the calibrated tier whenever the GPU forms the image (decision 154). */
describe('default quality of the app', () => {
  it('is the automatic choice, which the GPU draws at the calibrated tier', () => {
    const q = useSimStore.getState().quality;
    expect(q).toBe(DEFAULT_QUALITY);
    expect(resolveQualityTier(q, true)).toBe(CALIBRATED_TIER);
  });
});
