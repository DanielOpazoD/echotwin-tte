import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import {
  classifyHeart,
  computeHeartPose,
  createHeartModel,
  heartAnchors,
  ROOT_EXCURSION,
} from './heartModel';
import { aorticCuspTip, aorticCoaptationBand, rootRadiusAt, AV_PHI0 } from './aorticValve';
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
import { makeSample, Structure, Tissue } from './tissue';
import { SimulatorCore } from '@/simulator/core/simulatorCore';
import { baseInput } from '@/simulator/core/baseInput';

/** Regression: the aortic cusps must be visible in the AV short-axis cut in systole AND diastole, for a normal and a stenotic valve. */
describe('aortic valve visibility in PSAX-AV', () => {
  it('retains broad lateral coaptation rather than tapering the whole contact zone to the commissure', () => {
    const c = loadCaseById('normal-excellent-window');
    const heart = createHeartModel(c.anatomy, c.physiology);
    const tables = buildBeatTables(
      60 / c.rhythm.heartRateBpm,
      c.physiology,
      c.rhythm,
      c.hemodynamics,
    );
    const av = computeHeartPose(heart, cycleStateAt(tables, 0)).valves.aortic;
    const [bottom, top] = aorticCoaptationBand(av, 0.5);
    expect(top - bottom).toBeGreaterThanOrEqual(0.53);
    expect(top - bottom).toBeLessThanOrEqual(0.65);
    const centre = aorticCoaptationBand(av, 0);
    const attachment = aorticCoaptationBand(av, 1);
    expect(centre[1] - centre[0]).toBeCloseTo(av.cH, 10);
    expect(attachment[0]).toBeCloseTo(av.hComm - 0.1, 10);
  });

  it('keeps the free-margin length and apposed surface within the anatomical reference range', () => {
    const c = loadCaseById('normal-excellent-window');
    const heart = createHeartModel(c.anatomy, c.physiology);
    const tables = buildBeatTables(
      60 / c.rhythm.heartRateBpm,
      c.physiology,
      c.rhythm,
      c.hemodynamics,
    );
    const hp = computeHeartPose(heart, cycleStateAt(tables, 0));
    const a = heartAnchors(heart),
      sample = makeSample();
    let halfMargin = 0,
      previous: { r: number; t: number } | undefined;
    for (let i = 0; i <= 1000; i++) {
      const u = i / 1000,
        t = aorticCoaptationBand(hp.valves.aortic, u)[1];
      const r = u * rootRadiusAt(hp.valves.root, t, AV_PHI0 + Math.PI / 3);
      if (previous) halfMargin += Math.hypot(r - previous.r, t - previous.t);
      previous = { r, t };
    }
    expect(20 * halfMargin).toBeGreaterThanOrEqual(34.3 - 2 * 3.1);
    expect(20 * halfMargin).toBeLessThanOrEqual(34.3 + 2 * 3.1);
    let area = 0;
    for (let i = 0; i < 3; i++) {
      const phi = AV_PHI0 + ((i + 0.5) * 2 * Math.PI) / 3;
      for (let t = 0.005; t < hp.valves.aortic.hComm; t += 0.01) {
        const R = rootRadiusAt(hp.valves.root, t, phi);
        for (let r = 0.005; r < 0.97 * R; r += 0.01) {
          const u = r * Math.cos(phi),
            v = r * Math.sin(phi);
          const x = a.avCenter.x + a.avAxis.x * t + a.avE1.x * u + a.avE2.x * v;
          const y = a.avCenter.y + a.avAxis.y * t + a.avE1.y * u + a.avE2.y * v;
          const z =
            a.avCenter.z + hp.zAnn * ROOT_EXCURSION + a.avAxis.z * t + a.avE1.z * u + a.avE2.z * v;
          if (
            classifyHeart(heart, hp, x, y, z, sample) &&
            sample.structure === Structure.AorticValve
          )
            area += 0.0001;
        }
      }
    }
    expect(area).toBeGreaterThanOrEqual(1.84 - 2 * 0.32);
    expect(area).toBeLessThanOrEqual(1.84 + 2 * 0.32);
  });

  it('has three coaptation arms across the central closed-valve section', () => {
    const c = loadCaseById('normal-excellent-window');
    const heart = createHeartModel(c.anatomy, c.physiology);
    const tables = buildBeatTables(
      60 / c.rhythm.heartRateBpm,
      c.physiology,
      c.rhythm,
      c.hemodynamics,
    );
    const hp = computeHeartPose(heart, cycleStateAt(tables, 0.9));
    const A = heartAnchors(heart),
      av = hp.valves.aortic,
      t = av.eH - av.cH / 2;
    const R = rootRadiusAt(hp.valves.root, t, AV_PHI0),
      sample = makeSample();
    for (const fraction of [0.25, 0.45, 0.65]) {
      const ring: boolean[] = [];
      for (let i = 0; i < 1440; i++) {
        const phi = (i * 2 * Math.PI) / 1440,
          u = fraction * R * Math.cos(phi),
          v = fraction * R * Math.sin(phi);
        const x = A.avCenter.x + A.avAxis.x * t + A.avE1.x * u + A.avE2.x * v;
        const y = A.avCenter.y + A.avAxis.y * t + A.avE1.y * u + A.avE2.y * v;
        const z =
          A.avCenter.z + hp.zAnn * ROOT_EXCURSION + A.avAxis.z * t + A.avE1.z * u + A.avE2.z * v;
        ring.push(
          classifyHeart(heart, hp, x, y, z, sample) && sample.structure === Structure.AorticValve,
        );
      }
      const arms = ring.reduce(
        (n, present, i) => n + (present && !ring[(i + ring.length - 1) % ring.length] ? 1 : 0),
        0,
      );
      expect(arms, `closed-valve arms at ${fraction} of root radius`).toBe(3);
    }
  });
  it('releases coaptation continuously as the cusps open instead of deleting a fixed Y at 20 percent', () => {
    const c = loadCaseById('normal-excellent-window'),
      input = baseInput(),
      core = new SimulatorCore(c, input);
    input.probe = canonicalControl(getViewTarget('psax-av'), core.models.heart, core.models.thorax);
    core.setInput(input);
    const out = core.step(0)!;
    const { heart, thorax, tables } = core.models,
      beam = core.lastBeam!,
      spec = core.lastFrame!.spec;
    core.recycle(out.rgba);
    const state = cycleStateAt(tables, 0),
      renderer = new ProceduralSliceRenderer();
    const partial = computeHeartPose(heart, { ...state, avOpen: 0.1 }),
      a = heartAnchors(heart),
      sample = makeSample();
    const t = partial.valves.aortic.eH - partial.valves.aortic.cH / 2;
    classifyHeart(
      heart,
      partial,
      a.avCenter.x + a.avAxis.x * t,
      a.avCenter.y + a.avAxis.y * t,
      a.avCenter.z + partial.zAnn * ROOT_EXCURSION + a.avAxis.z * t,
      sample,
    );
    expect(sample.tissue, 'the closed Y must not stay across an opening central orifice').toBe(
      Tissue.Blood,
    );
    const frames = [0.2 - 1e-8, 0.2 + 1e-8].map((avOpen) => {
      const frame = allocPolarFrame(spec);
      renderer.render(
        {
          heart,
          thorax,
          heartPose: computeHeartPose(heart, { ...state, avOpen }),
          physics: {
            frequencyMHz: input.settings.frequencyMHz,
            harmonics: input.settings.harmonics,
            seed: c.seed,
            clutterLevel: c.acousticWindow.clutterLevel,
            windowAttenuation: c.acousticWindow.chestWallAttenuation,
          },
        },
        beam,
        spec,
        0,
        frame,
      );
      return frame.structure;
    });
    let changed = 0;
    for (let i = 0; i < frames[0]!.length; i++) if (frames[0]![i] !== frames[1]![i]) changed++;
    expect(
      changed,
      'a vanishingly small opening change must not remove a finite coaptation sheet',
    ).toBe(0);
  });

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
