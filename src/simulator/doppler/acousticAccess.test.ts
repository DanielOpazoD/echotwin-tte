import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import {
  createHeartModel,
  computeHeartPose,
  heartLandmarks,
  heartToTorso,
} from '@/simulator/anatomy/heartModel';
import { createThoraxModel } from '@/simulator/anatomy/thoraxModel';
import { buildBeatTables, cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import { beamFrameFromPose, controlAimingAt, poseFromControl } from '@/simulator/probe/pose';
import { acousticAccess, relativeEchoAmplitude } from './acousticAccess';
import { sub, normalize } from '@/core/vec3';
import type { Scene } from '@/simulator/renderer/types';

const c = loadCaseById('normal-excellent-window');
const thorax = createThoraxModel(c.bodyHabitus, c.acousticWindow, {
  position: 'left-lateral',
  respiration: 'expiration',
  headElevationDeg: 0,
});
const heart = createHeartModel(c.anatomy, c.physiology, thorax.heartOffset, c.seed);
const tables = buildBeatTables(60 / c.rhythm.heartRateBpm, c.physiology, c.rhythm, c.hemodynamics);
const ref = canonicalControl(getViewTarget('a5c'), heart, thorax);
const refBeam = beamFrameFromPose(poseFromControl(thorax, ref));
const p = heartToTorso(heart.frame, heartLandmarks(heart).find((l) => l.id === 'lvot')!.p);
function scene(phase: number, frequencyMHz = 1.5): Scene {
  return {
    heart,
    thorax,
    heartPose: computeHeartPose(heart, cycleStateAt(tables, phase)),
    physics: {
      frequencyMHz,
      harmonics: false,
      clutterLevel: 0,
      windowAttenuation: 0,
      seed: c.seed,
    },
  };
}

function accessToTarget(s: Scene, origin: typeof p, contact: number, step?: number) {
  const d = sub(p, origin);
  return acousticAccess(s, origin, normalize(d), contact, step)(Math.hypot(d.x, d.y, d.z));
}

describe('spectral path quadrature', () => {
  it('has no signal without acoustic contact', () => {
    expect(accessToTarget(scene(0), refBeam.origin, 0)).toBe(false);
  });
  it('loses an attenuated path as transmit frequency increases', () => {
    const probe = controlAimingAt(thorax, ref.u - 2, ref.v - 1.5, p, refBeam.lateral);
    const beam = beamFrameFromPose(poseFromControl(thorax, probe));
    expect(accessToTarget(scene(0.2, 1.5), beam.origin, beam.contact)).toBe(true);
    expect(accessToTarget(scene(0.2, 5), beam.origin, beam.contact)).toBe(false);
  });
  it('does not reinterpret fundamental Doppler when THI is selected', () => {
    const s = scene(0.2);
    const a = accessToTarget(s, refBeam.origin, refBeam.contact);
    s.physics.harmonics = true;
    expect(accessToTarget(s, refBeam.origin, refBeam.contact)).toBe(a);
  });
  it('agrees with 0.25 mm refinement across unobstructed and lung-blocked paths and cardiac phases', () => {
    let open = 0,
      blocked = 0;
    for (const du of [0, 2, 4])
      for (const dv of [0, 1.5, 3]) {
        const probe = controlAimingAt(thorax, ref.u + du, ref.v + dv, p, refBeam.lateral);
        const beam = beamFrameFromPose(poseFromControl(thorax, probe));
        for (const phase of [0, 0.2, 0.5, 0.8])
          for (const frequency of [1.5, 5]) {
            const s = scene(phase, frequency);
            const fine = accessToTarget(s, beam.origin, beam.contact, 0.025);
            const coarse = accessToTarget(s, beam.origin, beam.contact);
            expect(coarse, `pose ${du},${dv}; phase ${phase}; MHz ${frequency}`).toBe(fine);
            if (fine) open++;
            else blocked++;
          }
      }
    expect(open).toBeGreaterThan(0);
    expect(blocked).toBeGreaterThan(0);
  });
});

describe('received amplitude preserves coupling before reference compensation', () => {
  it('halving coupling quarters signal power on the same physical path', () => {
    const s = scene(0.2),
      d = sub(p, refBeam.origin),
      depth = Math.hypot(d.x, d.y, d.z);
    const direction = normalize(d);
    const a = relativeEchoAmplitude(s, refBeam.origin, direction, 1)(depth);
    const half = relativeEchoAmplitude(s, refBeam.origin, direction, 0.5)(depth);
    expect(a).toBeGreaterThan(0);
    expect(half / a).toBeCloseTo(0.5, 12);
    expect(half ** 2 / a ** 2).toBeCloseTo(0.25, 12);
  });
});
