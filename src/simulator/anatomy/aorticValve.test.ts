import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { computeHeartPose, createHeartModel } from './heartModel';
import { aorticCuspTip } from './aorticValve';
import { createThoraxModel } from './thoraxModel';
import { buildBeatTables, cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { ProceduralSliceRenderer } from '@/simulator/renderer/procedural/sliceRenderer';
import {
  allocPolarFrame,
  DEFAULT_ACQUISITION,
  polarSpecFor,
  type Scene,
} from '@/simulator/renderer/types';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import { Structure } from './tissue';

/** Regression: the aortic cusps must be visible in the AV short-axis cut in systole AND diastole, for a normal and a stenotic valve. */
describe('aortic valve visibility in PSAX-AV', () => {
  for (const id of ['normal-excellent-window', 'aortic-stenosis-severe']) {
    it(`${id}: cusps are cut by the PSAX-AV plane in diastole and systole`, () => {
      const c = loadCaseById(id);
      const thorax = createThoraxModel(c.bodyHabitus, c.acousticWindow, {
        position: 'left-lateral',
        respiration: 'expiration',
        headElevationDeg: 0,
      });
      const heart = createHeartModel(c.anatomy, c.physiology, thorax.heartOffset, c.seed);
      const tables = buildBeatTables(
        60 / c.rhythm.heartRateBpm,
        c.physiology,
        c.rhythm,
        c.hemodynamics,
      );
      const spec = polarSpecFor(DEFAULT_ACQUISITION, 'low');
      const beam = beamFrameFromPose(
        poseFromControl(thorax, canonicalControl(getViewTarget('psax-av'), heart, thorax)),
        1,
      );
      const renderer = new ProceduralSliceRenderer();
      for (const phase of [0.05, 0.2, 0.6]) {
        const scene: Scene = {
          heart,
          heartPose: computeHeartPose(heart, cycleStateAt(tables, phase)),
          thorax,
          physics: {
            frequencyMHz: 2.5,
            harmonics: true,
            clutterLevel: 0.1,
            windowAttenuation: 0.1,
            seed: c.seed,
          },
        };
        const frame = allocPolarFrame(spec);
        renderer.render(scene, beam, spec, phase, frame);
        let n = 0;
        for (let i = 0; i < frame.structure.length; i++)
          if (frame.structure[i] === Structure.AorticValve) n++;
        expect(n, `${id} phase ${phase}`).toBeGreaterThan(15);
      }
    });
  }
  it('a restricted valve opens to a smaller orifice than a normal one', () => {
    const reach = (id: string) => {
      const c = loadCaseById(id);
      const thorax = createThoraxModel(c.bodyHabitus, c.acousticWindow, {
        position: 'left-lateral',
        respiration: 'expiration',
        headElevationDeg: 0,
      });
      const heart = createHeartModel(c.anatomy, c.physiology, thorax.heartOffset, c.seed);
      const tables = buildBeatTables(
        60 / c.rhythm.heartRateBpm,
        c.physiology,
        c.rhythm,
        c.hemodynamics,
      );
      const hp = computeHeartPose(
        heart,
        cycleStateAt(tables, (tables.timings.ejectionStartS + 0.1) / tables.rrS),
      );
      // radius of the free edge at the centre of a cusp from the root axis
      return aorticCuspTip(hp.valves.aortic, hp.valves.root, 0).r;
    };
    expect(reach('aortic-stenosis-severe')).toBeLessThan(reach('normal-excellent-window') * 0.6);
  });
});
