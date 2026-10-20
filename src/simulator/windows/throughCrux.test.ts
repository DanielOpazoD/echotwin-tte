/**
 * A preset turned through a heart's own crux (decision 359): the tilt that puts a point in the image plane, and only the
 * four-chamber view turned.
 */
import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { dot, sub } from '@/core/vec3';
import { buildCaseModels, REST_PATIENT } from '@/simulator/anatomy/caseModels';
import { heartToTorso } from '@/simulator/anatomy/heartFrame';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import {
  canonicalControl,
  controlThroughCrux,
  getViewTarget,
  THROUGH_POINT_TILT_DEG,
  tiltThroughPoint,
} from './viewTargets';

const { heart, thorax } = buildCaseModels(loadCaseById('normal-excellent-window'), REST_PATIENT);
const a4c = canonicalControl(getViewTarget('a4c'), heart, thorax);
const planeDistance = (c: typeof a4c, p: { x: number; y: number; z: number }) => {
  const b = beamFrameFromPose(poseFromControl(thorax, c), 1);
  return dot(sub(p, b.origin), b.normal);
};

describe('a preset through a point (decision 359)', () => {
  it('turns the tilt until the plane holds the point', () => {
    // a point 0.6 cm off the four-chamber plane, 10 cm down the beam
    const b = beamFrameFromPose(poseFromControl(thorax, a4c), 1);
    const p = {
      x: b.origin.x + 10 * b.forward.x + 0.6 * b.normal.x,
      y: b.origin.y + 10 * b.forward.y + 0.6 * b.normal.y,
      z: b.origin.z + 10 * b.forward.z + 0.6 * b.normal.z,
    };
    expect(Math.abs(planeDistance(a4c, p))).toBeCloseTo(0.6, 6);
    const t = tiltThroughPoint(a4c, thorax, p);
    expect(Math.abs(planeDistance(t, p))).toBeLessThan(0.03);
    expect(Math.abs(t.tiltDeg - a4c.tiltDeg)).toBeGreaterThan(1);
    expect(Math.abs(t.tiltDeg - a4c.tiltDeg)).toBeLessThanOrEqual(THROUGH_POINT_TILT_DEG);
    // only the tilt moves
    expect({ ...t, tiltDeg: 0 }).toEqual({ ...a4c, tiltDeg: 0 });
  });

  it('turns the four-chamber view only, and only when the heart brings a crux', () => {
    const crux = { x: -1.8, y: -1.2, z: -0.4 };
    const turned = controlThroughCrux(getViewTarget('a4c'), a4c, heart, thorax, crux);
    expect(Math.abs(planeDistance(turned, heartToTorso(heart.frame, crux)))).toBeLessThan(0.03);
    expect(controlThroughCrux(getViewTarget('a4c'), a4c, heart, thorax, null)).toBe(a4c);
    const a2c = canonicalControl(getViewTarget('a2c'), heart, thorax);
    expect(controlThroughCrux(getViewTarget('a2c'), a2c, heart, thorax, crux)).toBe(a2c);
  });
});
