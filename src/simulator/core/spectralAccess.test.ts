// @tier slow
import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { SimulatorCore } from './simulatorCore';
import { baseInput } from './baseInput';
import {
  classifyHeart,
  computeHeartPose,
  heartLandmarks,
  heartToTorso,
} from '@/simulator/anatomy/heartModel';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import { beamFrameFromPose, poseFromControl, controlAimingAt } from '@/simulator/probe/pose';
import { dot, sub } from '@/core/vec3';
import { makeSample, Tissue } from '@/simulator/anatomy/tissue';
import { SPECTRAL_BINS } from '@/simulator/doppler/spectral/spectrum';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';

/** Same LVOT target reached through different actual skin poses, not a view-name switch. */
describe('pulsed spectral acoustic access', () => {
  const c = loadCaseById('normal-excellent-window');
  function acquire(du: number, dv: number, modality: 'pw' | 'tdi' = 'pw', wallFilter?: number) {
    const seed = new SimulatorCore(c, baseInput());
    const { heart, thorax, tables } = seed.models;
    const ref = canonicalControl(getViewTarget('a5c'), heart, thorax);
    const refBeam = beamFrameFromPose(poseFromControl(thorax, ref));
    let target = heartToTorso(heart.frame, heartLandmarks(heart).find((l) => l.id === 'lvot')!.p);
    if (modality === 'tdi') {
      const sample = makeSample();
      const pose = computeHeartPose(heart, cycleStateAt(tables, 0));
      const wall: number[] = [];
      for (let x = -0.5; x > -5; x -= 0.05) {
        if (classifyHeart(heart, pose, x, 0, 1, sample) && sample.tissue === Tissue.Myocardium)
          wall.push(x);
        else if (wall.length) break;
      }
      expect(wall.length).toBeGreaterThan(0);
      target = heartToTorso(heart.frame, { x: (wall[0]! + wall.at(-1)!) / 2, y: 0, z: 1 });
    }
    seed.dispose();
    const probe = controlAimingAt(thorax, ref.u + du, ref.v + dv, target, refBeam.lateral);
    const beam = beamFrameFromPose(poseFromControl(thorax, probe));
    const d = sub(target, beam.origin);
    const input = baseInput({
      modality,
      probe,
      gateDepthCm: Math.hypot(dot(d, beam.forward), dot(d, beam.lateral)),
      cursorThetaRad: Math.atan2(dot(d, beam.lateral), dot(d, beam.forward)),
    });
    input.settings.depthCm = 20;
    input.settings.frequencyMHz = 1.5;
    if (wallFilter !== undefined) input.spectral.wallFilterMps = wallFilter;
    const core = new SimulatorCore(c, input);
    try {
      for (let i = 0; i < 6; i++) core.step(0.05);
      const trace = core.request({ kind: 'autoTrace', x0: 0, x1: core.spectralStrip.head - 1 });
      if (trace?.kind !== 'autoTrace') throw new Error('missing acquisition');
      if (wallFilter === 0) {
        const strip = core.spectralStrip;
        expect(Math.max(...strip.data!.slice(0, strip.head * SPECTRAL_BINS))).toBeLessThan(0.15);
      }
      return Math.max(...trace.velocitiesMps.map(Math.abs));
    } finally {
      core.dispose();
    }
  }
  it('preserves the accessible apical LVOT envelope', () => {
    expect(acquire(0, 0)).toBeGreaterThan(0.5);
  });
  it('preserves septal tissue velocity through an accessible path', () => {
    expect(acquire(0, 0, 'tdi')).toBeGreaterThan(0.03);
  });
  it('does not receive stationary blood through lung with the wall filter off', () => {
    acquire(4, 0, 'pw', 0);
  });
  it('rejects tissue velocity behind lung', () => {
    expect(acquire(4, 0, 'tdi')).toBe(0);
  });
  it.each([
    [2, 1.5],
    [4, 0],
  ])('rejects LVOT behind lung at skin displacement %s,%s cm', (du, dv) => {
    expect(acquire(du, dv)).toBe(0);
  });
});
