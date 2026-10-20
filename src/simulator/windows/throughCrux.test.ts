/**
 * The four-chamber preset turned through a heart's own crux (decision 359): about the LV's long axis, so the plane holds
 * both, and only that view.
 */
import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { dot, sub, v3, type Vec3 } from '@/core/vec3';
import { anchorsCached } from '@/simulator/anatomy/anchors';
import { buildCaseModels, REST_PATIENT } from '@/simulator/anatomy/caseModels';
import { heartToTorso } from '@/simulator/anatomy/heartFrame';
import { beamFrameFromPose, poseFromControl, type ProbeControl } from '@/simulator/probe/pose';
import { canonicalControl, controlThroughCrux, CRUX_PLANE_CM, getViewTarget } from './viewTargets';

const { heart, thorax } = buildCaseModels(loadCaseById('normal-excellent-window'), REST_PATIENT);
/** Distance (cm) of a heart-frame point from a control's image plane. */
const off = (c: ProbeControl, pH: Vec3) => {
  const b = beamFrameFromPose(poseFromControl(thorax, c), 1);
  return Math.abs(dot(sub(heartToTorso(heart.frame, pH), b.origin), b.normal));
};
const apex = v3(0, 0, heart.lv.lengthCm);
const mv = anchorsCached(heart).mvCenter;
const base = v3(mv.x * 0.5, mv.y * 0.5, mv.z);

describe('the four-chamber preset through a crux (decision 359)', () => {
  // a crux 1.6 cm septal and 1.2 cm behind the mitral centre's level, as the Rodero heart's
  const crux = v3(-1.8, -1.2, -0.4);
  const declared = canonicalControl(getViewTarget('a4c'), heart, thorax);
  const turned = controlThroughCrux(getViewTarget('a4c'), heart, thorax, crux);

  it('holds the crux, and the LV axis still', () => {
    expect(off(declared, crux)).toBeGreaterThan(0.3);
    expect(off(turned, crux)).toBeLessThanOrEqual(CRUX_PLANE_CM);
    expect(off(turned, apex)).toBeLessThan(0.15);
    expect(off(turned, base)).toBeLessThan(0.15);
  });

  it('turns the four-chamber view only, and only when the heart brings a crux', () => {
    expect(controlThroughCrux(getViewTarget('a4c'), heart, thorax, null)).toEqual(declared);
    expect(controlThroughCrux(getViewTarget('a2c'), heart, thorax, crux)).toEqual(
      canonicalControl(getViewTarget('a2c'), heart, thorax),
    );
  });
});
