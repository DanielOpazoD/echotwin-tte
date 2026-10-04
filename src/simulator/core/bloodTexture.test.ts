// @tier slow
import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { Structure } from '@/simulator/anatomy/tissue';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import { polarToPixel } from '@/simulator/renderer/scanConvert';
import { SimulatorCore } from './simulatorCore';
import { baseInput } from './baseInput';

/** Image acceptance, not a diagnostic threshold: normal blood must not acquire coarse bright islands.
 * Erode the label before measuring so real wall/valve partial-volume echoes do not count as blood texture.
 * The lower bounds also reject replacing the cavity with a black or constant painted region.
 * This goes through the actual core, console and scan-converted output, at all three rendering tiers.
 */
describe('normal blood texture through the acquisition chain', () => {
  for (const quality of ['low', 'medium', 'high'] as const)
    it(`${quality}: blood stays weakly textured without a second coarse noise envelope`, () => {
      for (const viewId of ['plax', 'psax-mv', 'psax-pm']) {
        const c = loadCaseById('normal-excellent-window');
        const view = getViewTarget(viewId);
        const input = baseInput({ quality, display: { width: 700, height: 600 } });
        input.settings = {
          ...input.settings,
          depthCm: (view.recommendedDepthRangeCm[0] + view.recommendedDepthRangeCm[1]) / 2,
          focusCm: view.recommendedFocusCm,
        };
        const core = new SimulatorCore(c, input);
        try {
          core.setInput({
            ...input,
            probe: canonicalControl(view, core.models.heart, core.models.thorax),
          });
          const out = core.step(0)!;
          const { lines: L, samples: N, depthCm, sectorRad } = out.polar;
          const pixels = new Uint8ClampedArray(out.rgba);
          const k = Math.ceil((0.4 / depthCm) * N);
          const values: number[] = [];
          for (let li = 3; li < L - 3; li++)
            for (let si = k; si < N - k; si++) {
              let inside = true;
              for (let dl = -3; dl <= 3; dl++)
                for (const ds of [-k, 0, k])
                  if (out.structure[(li + dl) * N + si + ds] !== Structure.LvCavity) inside = false;
              if (!inside) continue;
              const p = polarToPixel(
                out.sector,
                ((si + 0.5) * depthCm) / N,
                -sectorRad / 2 + ((li + 0.5) * sectorRad) / L,
              );
              const x = Math.round(p.x + out.sector.x),
                y = Math.round(p.y + out.sector.y);
              values.push(pixels[(y * out.width + x) * 4]!);
            }
          expect(values.length, viewId).toBeGreaterThan(300);
          const mean = values.reduce((a, b) => a + b, 0) / values.length;
          const std = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
          expect(mean, `${viewId} blood mean`).toBeGreaterThan(30);
          expect(mean, `${viewId} blood mean`).toBeLessThan(85);
          expect(std, `${viewId} retained texture`).toBeGreaterThan(5);
          expect(std / mean, `${viewId} blood heterogeneity`).toBeLessThan(0.25);
        } finally {
          core.dispose();
        }
      }
    });
});
