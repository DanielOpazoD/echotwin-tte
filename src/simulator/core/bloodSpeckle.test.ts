// @tier slow
import { describe, expect, it } from 'vitest';
import { SimulatorCore } from './simulatorCore';
import { baseInput } from './baseInput';
import { loadCaseById } from '@/cases';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import { DEFAULT_ACQUISITION, type PolarFrame } from '@/simulator/renderer/types';
import { Structure } from '@/simulator/anatomy/tissue';

/**
 * Flowing blood is a new speckle realization in every frame (decision 163). Blood travels 1–20 mm between two frames
 * where the speckle cell is 0.4 mm deep, so a scanner's cavity speckle does not persist from one frame to the next
 * while the tissue's does; the simulator anchored both to the heart, and the cavity's speckle stood still with the walls
 * (log-amplitude correlation 1.000 between consecutive frames in diastasis, as in the myocardium). The probe runs the
 * app chain: two consecutive raw frames of the A4C in the middle of diastasis, when the walls barely move, and the
 * correlation of the log amplitude over the eroded LV cavity and the eroded LV walls. The cavity keeps a correlated
 * part — clutter, reverberation and the walls' echoes spread by the beam do not move with the blood — and measures
 * 0.67 at the low tier.
 */
const LV_WALL = new Set<number>([
  Structure.LvWallSeptal,
  Structure.LvWallLateral,
  Structure.LvApex,
]);

function logCorrelation(a: PolarFrame, b: PolarFrame, keep: (st: number) => boolean): number {
  const { lines: L, samples: N, depthCm } = a.spec;
  const k = Math.max(1, Math.round(0.3 / (depthCm / N)));
  const xs: number[] = [],
    ys: number[] = [];
  // eroded region: ±3 mm along the beam and ±2 lines hold the same region in both frames
  for (let li = 2; li < L - 2; li++)
    for (let si = k; si < N - k; si++) {
      let inside = true;
      for (let dl = -2; dl <= 2 && inside; dl++)
        for (const ds of [-k, 0, k]) {
          const i = (li + dl) * N + si + ds;
          if (!keep(a.structure[i]!) || !keep(b.structure[i]!)) inside = false;
        }
      if (!inside) continue;
      xs.push(Math.log(a.amplitude[li * N + si]! + 1e-9));
      ys.push(Math.log(b.amplitude[li * N + si]! + 1e-9));
    }
  const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
  const mx = mean(xs),
    my = mean(ys);
  let sxy = 0,
    sxx = 0,
    syy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) ** 2;
    syy += (ys[i]! - my) ** 2;
  }
  expect(xs.length, 'samples in the eroded region').toBeGreaterThan(500);
  return sxy / Math.sqrt(sxx * syy);
}

describe('the flowing blood decorrelates from frame to frame (decision 163)', () => {
  it(
    'the LV cavity speckle changes between consecutive frames while the walls keep theirs',
    { timeout: 120_000 },
    () => {
      const c = loadCaseById('normal-excellent-window');
      const setup = new SimulatorCore(c, baseInput());
      const probe = canonicalControl(getViewTarget('a4c'), setup.models.heart, setup.models.thorax);
      const core = new SimulatorCore(
        c,
        baseInput({
          probe,
          settings: {
            ...DEFAULT_ACQUISITION,
            tgcDb: [...DEFAULT_ACQUISITION.tgcDb],
            persistence: 0,
          },
        }),
      );
      const marks = core.phaseMarks();
      const fps = core.step(1 / 30)!.simulatedFps;
      const target = (marks.eEnd + marks.aStart) / 2;
      let out = core.step(1 / fps)!;
      for (let n = 0; n < 200 && Math.abs(out.phase - target) > 0.6 / fps / out.rrS; n++)
        out = core.step(1 / fps)!;
      const first = core.lastFrame!;
      const a: PolarFrame = {
        ...first,
        amplitude: new Float32Array(first.amplitude),
        structure: new Uint8Array(first.structure),
      };
      core.step(1 / fps);
      const b = core.lastFrame!;
      const cavity = logCorrelation(a, b, (st) => st === Structure.LvCavity);
      const wall = logCorrelation(a, b, (st) => LV_WALL.has(st));
      expect(wall, 'LV walls, log-amplitude correlation between frames').toBeGreaterThan(0.98);
      expect(cavity, 'LV cavity, log-amplitude correlation between frames').toBeLessThan(0.85);
    },
  );
});
