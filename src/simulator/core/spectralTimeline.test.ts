// @tier slow
import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { SimulatorCore } from './simulatorCore';
import { baseInput } from './baseInput';

describe('the real core never compresses spectral time to fit a per-step work cap', () => {
  it('fills the same physical duration at both screen widths and sweep rates', () => {
    for (const [width, dt, sweep] of [
      [1024, 0.05, 50],
      [320, 0.02, 50],
      [1024, 0.05, 100],
    ]) {
      const input = baseInput({ modality: 'pw', display: { width: width!, height: 260 } });
      input.spectral.sweepSpeedMmPerS = sweep!;
      const core = new SimulatorCore(loadCaseById('normal-excellent-window'), input);
      try {
        let out;
        for (let i = 0; i < Math.round(1 / dt!); i++) {
          const next = core.step(dt!);
          if (next) {
            if (out) core.recycle(out.rgba);
            out = next;
          }
        }
        if (!out) throw new Error('Expected acquired strip');
        expect(out.strip.kind).toBe('spectral');
        const strip = core.spectralStrip,
          cps = (width! * sweep!) / 100;
        expect(strip.head).toBe(cps);
        expect(out.strip.headTimeS).toBeCloseTo(1 - 0.5 / cps, 10);
        expect(out.strip.estimatorIntervalS).toBe(1 / cps);
        for (let j = 0; j < strip.head; j++) {
          const displayTime = (j + 0.5) / cps,
            age = displayTime - strip.sampleTimeS[j % width!]!;
          expect(age).toBeGreaterThanOrEqual(-1e-10);
          expect(age).toBeLessThan(1e-10);
        }
      } finally {
        core.dispose();
      }
    }
  });
});
