// @tier slow
import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { computeHeartPose, createHeartModel } from '@/simulator/anatomy/heartModel';
import { createThoraxModel } from '@/simulator/anatomy/thoraxModel';
import { Tissue } from '@/simulator/anatomy/tissue';
import { buildBeatTables, cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import {
  allocPolarFrame,
  DEFAULT_ACQUISITION,
  polarSpecFor,
  type Scene,
} from '@/simulator/renderer/types';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import { ProceduralSliceRenderer } from './sliceRenderer';

/**
 * A rib's shadow must not depend on how finely the line is sampled (external audit F04, decision 89). Bone, calcium and
 * spine lost a fixed 1.2 Np per sample while every other tissue lost attenuation × length, so the same rib under the
 * probe shadowed 17 dB more in the high tier (0.5 mm samples) than in the low tier (1 mm) 1 cm behind 4 mm of bone.
 */
describe('bone attenuation is integrated over distance', () => {
  const c = loadCaseById('normal-excellent-window');
  const thorax = createThoraxModel(
    c.bodyHabitus,
    c.acousticWindow,
    { position: 'left-lateral', respiration: 'expiration', headElevationDeg: 0 },
    c.anatomy.ivc.collapsePct,
  );
  const heart = createHeartModel(
    c.anatomy,
    c.physiology,
    thorax.heartOffset,
    c.seed,
    thorax.ivcCollapse,
  );
  const tables = buildBeatTables(
    60 / c.rhythm.heartRateBpm,
    c.physiology,
    c.rhythm,
    c.hemodynamics,
  );
  const scene: Scene = {
    heart,
    heartPose: computeHeartPose(heart, cycleStateAt(tables, 0.1)),
    thorax,
    physics: {
      frequencyMHz: 2.5,
      harmonics: true,
      clutterLevel: 0.1,
      windowAttenuation: 0.1,
      seed: 3,
    },
  };
  const renderer = new ProceduralSliceRenderer();

  /** Mean two-way transmission (dB) 1 cm behind the last bone sample, over the lines that cross bone, for one tier. */
  const shadowDb = (
    offsetV: number,
    tier: 'low' | 'medium' | 'high',
  ): { db: number; boneLineShare: number; pathMm: number } => {
    const ctrl = canonicalControl(getViewTarget('a4c'), heart, thorax);
    const beam = beamFrameFromPose(poseFromControl(thorax, { ...ctrl, v: ctrl.v + offsetV }), 1);
    const spec = { ...polarSpecFor({ ...DEFAULT_ACQUISITION }, tier), elevationSamples: 1 };
    const f = allocPolarFrame(spec);
    renderer.render(scene, beam, spec, 0.1, f);
    const dr = spec.depthCm / spec.samples;
    let lines = 0,
      sum = 0,
      path = 0;
    for (let li = 0; li < spec.lines; li++) {
      let last = -1,
        inBone = 0;
      for (let si = 0; si < spec.samples; si++) {
        const t = f.tissue[li * spec.samples + si];
        if (t === Tissue.Bone || t === Tissue.Spine) {
          last = si;
          inBone++;
        }
      }
      if (last < 0) continue;
      lines++;
      path += inBone * dr;
      sum +=
        20 *
        Math.log10(
          Math.max(
            1e-6,
            f.transmission[
              li * spec.samples + Math.min(spec.samples - 1, last + Math.round(1 / dr))
            ]!,
          ),
        );
    }
    return {
      db: sum / Math.max(1, lines),
      boneLineShare: lines / spec.lines,
      pathMm: (10 * path) / Math.max(1, lines),
    };
  };

  it('the same rib shadows alike in the low, medium and high tiers', { timeout: 120_000 }, () => {
    // on a rib (4 mm of bone along most lines) and at a rib's edge (about 1 mm along a few lines)
    for (const offsetV of [1.4, -1.4]) {
      const tiers = (['low', 'medium', 'high'] as const).map((t) => shadowDb(offsetV, t));
      for (const t of tiers) expect(t.boneLineShare).toBeGreaterThan(0.02);
      const dbs = tiers.map((t) => t.db);
      // the layer is the same in every tier: its sampled path length agrees to a sample of the coarsest tier
      expect(
        Math.max(...tiers.map((t) => t.pathMm)) - Math.min(...tiers.map((t) => t.pathMm)),
      ).toBeLessThan(1);
      expect(
        Math.max(...dbs) - Math.min(...dbs),
        `probe v${offsetV}: ${dbs.map((d) => d.toFixed(1)).join(' / ')} dB`,
      ).toBeLessThan(3);
    }
  });
});
