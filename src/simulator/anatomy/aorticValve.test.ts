import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { computeHeartPose, createHeartModel, ROOT_EXCURSION } from './heartModel';
import { createThoraxModel } from './thoraxModel';
import { buildBeatTables, cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { ProceduralSliceRenderer } from '@/simulator/renderer/procedural/sliceRenderer';
import { allocPolarFrame, DEFAULT_ACQUISITION, polarSpecFor, type Scene } from '@/simulator/renderer/types';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import { Structure } from './tissue';

/** Regression: the aortic cusps must be visible in the AV short-axis cut in systole AND diastole, for a normal and a stenotic valve. */
describe('aortic valve visibility in PSAX-AV', () => {
  for (const id of ['normal-excellent-window', 'aortic-stenosis-severe']) {
    it(`${id}: cusps are cut by the PSAX-AV plane in diastole and systole`, () => {
      const c = loadCaseById(id);
      const thorax = createThoraxModel(c.bodyHabitus, c.acousticWindow, { position: 'left-lateral', respiration: 'expiration', headElevationDeg: 0 });
      const heart = createHeartModel(c.anatomy, c.physiology, thorax.heartOffset, c.seed);
      const tables = buildBeatTables(60 / c.rhythm.heartRateBpm, c.physiology, c.rhythm, c.hemodynamics);
      const spec = polarSpecFor(DEFAULT_ACQUISITION, 'low');
      const beam = beamFrameFromPose(poseFromControl(thorax, canonicalControl(getViewTarget('psax-av'), heart, thorax)), 1);
      const renderer = new ProceduralSliceRenderer();
      for (const phase of [0.05, 0.2, 0.6]) {
        const scene: Scene = { heart, heartPose: computeHeartPose(heart, cycleStateAt(tables, phase)), thorax, physics: { frequencyMHz: 2.5, harmonics: true, clutterLevel: 0.1, windowAttenuation: 0.1, seed: c.seed } };
        const frame = allocPolarFrame(spec);
        renderer.render(scene, beam, spec, phase, frame);
        let n = 0;
        for (let i = 0; i < frame.structure.length; i++) if (frame.structure[i] === Structure.AorticValve) n++;
        expect(n, `${id} phase ${phase}`).toBeGreaterThan(15);
      }
    });
  }
  it('a restricted valve opens to a smaller orifice than a normal one', () => {
    const reach = (id: string) => {
      const c = loadCaseById(id);
      const thorax = createThoraxModel(c.bodyHabitus, c.acousticWindow, { position: 'left-lateral', respiration: 'expiration', headElevationDeg: 0 });
      const heart = createHeartModel(c.anatomy, c.physiology, thorax.heartOffset, c.seed);
      const tables = buildBeatTables(60 / c.rhythm.heartRateBpm, c.physiology, c.rhythm, c.hemodynamics);
      const hp = computeHeartPose(heart, cycleStateAt(tables, (tables.timings.ejectionStartS + 0.1) / tables.rrS));
      const s = hp.valves.segs,
        L = hp.valves.cuspSegLen;
      // tip radius of cusp 0 from the root axis
      const tip = [s[0]! + s[3]! * L + s[9]! * L, s[1]! + s[4]! * L + s[10]! * L, s[2]! + s[5]! * L + s[11]! * L];
      const A = (heart as unknown as { _anchors: { avCenter: { x: number; y: number; z: number }; avAxis: { x: number; y: number; z: number } } })._anchors;
      const cz = A.avCenter.z + hp.zAnn * ROOT_EXCURSION;
      const d = [tip[0]! - A.avCenter.x, tip[1]! - A.avCenter.y, tip[2]! - cz];
      const t = d[0]! * A.avAxis.x + d[1]! * A.avAxis.y + d[2]! * A.avAxis.z;
      return Math.hypot(d[0]! - A.avAxis.x * t, d[1]! - A.avAxis.y * t, d[2]! - A.avAxis.z * t);
    };
    expect(reach('aortic-stenosis-severe')).toBeLessThan(reach('normal-excellent-window') * 0.6);
  });
});
