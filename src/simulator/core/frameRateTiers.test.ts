// @tier fast
import { describe, expect, it } from 'vitest';
import { SimulatorCore } from './simulatorCore';
import { baseInput } from './baseInput';
import { loadCaseById } from '@/cases';

/**
 * The frame rate the HUD shows is the scanner's, set by the console, and the quality tier is a computing choice of the
 * simulator (decision 178): through the app chain, the three tiers report the same frame rate — 2D and colour — and form
 * frames at their own cadence, never above it. Until decision 178 the HUD showed the cadence: 48.8, 36.9 and 27.3 Hz at
 * 16 cm and 80° in the low, medium and high tiers.
 */
describe('the frame rate of the HUD', () => {
  it('is the same in the three quality tiers, in 2D and in colour', { timeout: 300_000 }, () => {
    const c = loadCaseById('normal-excellent-window');
    for (const modality of ['2d', 'color'] as const) {
      const reported = new Set<number>();
      const cadences = new Set<number>();
      for (const quality of ['low', 'medium', 'high'] as const) {
        const core = new SimulatorCore(c, baseInput({ quality, modality }));
        const out = core.step(1 / 30)!;
        core.dispose();
        expect(out.cadenceHz).toBeLessThanOrEqual(out.simulatedFps);
        reported.add(Number(out.simulatedFps.toFixed(6)));
        cadences.add(Number(out.cadenceHz.toFixed(6)));
      }
      expect([...reported], modality).toHaveLength(1);
      expect([...cadences].length, modality).toBe(3);
    }
  });
});
