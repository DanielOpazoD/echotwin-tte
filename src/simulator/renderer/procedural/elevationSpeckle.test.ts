import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { computeHeartPose, createHeartModel } from '@/simulator/anatomy/heartModel';
import { createThoraxModel } from '@/simulator/anatomy/thoraxModel';
import { Tissue } from '@/simulator/anatomy/tissue';
import { buildBeatTables, cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import { allocPolarFrame, DEFAULT_ACQUISITION, polarSpecFor, type PolarFrame, type Scene } from '@/simulator/renderer/types';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import { add, scale } from '@/core/vec3';
import { ProceduralSliceRenderer } from './sliceRenderer';

/**
 * Speckle decorrelates with out-of-plane motion over the elevational beam width (Chen, Fowlkes, Carson and Rubin, Int J
 * Imaging Syst Technol 1997; 8:38–44), not over a scatterer cell (decision 99). The scatterer lattice of a frame had the
 * same 0.4 mm cell across the plane as in it: moving the heart 0.2 mm out of the canonical A4C left the interior myocardium
 * with an envelope correlation of 0.76 and 0.4 mm with 0.64, while the slice there is about 4 mm thick. Across the plane the
 * cell is now the slice thickness, as it already was for an M-mode line (decision 84).
 */
describe('frame speckle across the slice thickness', () => {
  it('keeps its correlation for a fraction of the slice and loses it over the slice', () => {
    const c = loadCaseById('normal-excellent-window');
    const thorax = createThoraxModel(c.bodyHabitus, c.acousticWindow, { position: 'left-lateral', respiration: 'expiration', headElevationDeg: 0 }, c.anatomy.ivc.collapsePct);
    const tables = buildBeatTables(60 / c.rhythm.heartRateBpm, c.physiology, c.rhythm, c.hemodynamics);
    const reference = createHeartModel(c.anatomy, c.physiology, thorax.heartOffset, c.seed, thorax.ivcCollapse);
    const beam = beamFrameFromPose(poseFromControl(thorax, canonicalControl(getViewTarget('a4c'), reference, thorax)), 1);
    const spec = polarSpecFor({ ...DEFAULT_ACQUISITION }, 'medium');
    const renderer = new ProceduralSliceRenderer();
    const physics = { frequencyMHz: 2.5, harmonics: true, clutterLevel: 0, windowAttenuation: c.acousticWindow.chestWallAttenuation, seed: c.seed };
    /** The heart moved `shiftCm` along the plane normal, the probe fixed: a pure elevational translation. */
    const render = (shiftCm: number): PolarFrame => {
      const heart = createHeartModel(c.anatomy, c.physiology, add(thorax.heartOffset, scale(beam.normal, shiftCm)), c.seed, thorax.ivcCollapse);
      const scene: Scene = { heart, heartPose: computeHeartPose(heart, cycleStateAt(tables, 0.1)), thorax, physics };
      const f = allocPolarFrame(spec);
      renderer.render(scene, beam, spec, 0.1, f);
      return f;
    };
    const S = spec.samples;
    const dr = spec.depthCm / S;
    // interior myocardium: the same tissue three samples along and one line across, away from interfaces
    const interior = (f: PolarFrame, li: number, si: number): boolean => {
      for (let dl = -1; dl <= 1; dl++)
        for (let ds = -3; ds <= 3; ds++) {
          const l = li + dl,
            s = si + ds;
          if (l < 0 || l >= spec.lines || s < 0 || s >= S || f.tissue[l * S + s] !== Tissue.Myocardium) return false;
        }
      return true;
    };
    const ref = render(0);
    const correlation = (shiftCm: number): number => {
      const f = render(shiftCm);
      let sa = 0,
        sb = 0,
        saa = 0,
        sbb = 0,
        sab = 0,
        n = 0;
      for (let li = 0; li < spec.lines; li++)
        for (let si = 0; si < S; si++) {
          const r = (si + 0.5) * dr;
          if (r < 5 || r > 12 || !interior(ref, li, si) || !interior(f, li, si)) continue;
          const a = ref.amplitude[li * S + si]!,
            b = f.amplitude[li * S + si]!;
          sa += a;
          sb += b;
          saa += a * a;
          sbb += b * b;
          sab += a * b;
          n++;
        }
      expect(n).toBeGreaterThan(500);
      return (sab / n - (sa / n) * (sb / n)) / Math.sqrt((saa / n - (sa / n) ** 2) * (sbb / n - (sb / n) ** 2));
    };
    const near = correlation(0.02);
    const across = correlation(0.32);
    // before: 0.76 at 0.2 mm, already at the 0.63 plateau of the non-speckle structure by 0.4 mm
    expect(near, `0.2 mm: ${near.toFixed(3)}`).toBeGreaterThan(0.97);
    expect(across, `3.2 mm: ${across.toFixed(3)}`).toBeLessThan(0.8);
  });
});
