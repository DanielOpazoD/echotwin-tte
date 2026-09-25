// @tier slow
import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { SimulatorCore } from '@/simulator/core/simulatorCore';
import { baseInput } from '@/simulator/core/baseInput';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { add, scale, v3 } from '@/core/vec3';
import { classifyHeart } from './classify';
import { torsoToHeart } from './heartFrame';
import { computeHeartPose } from './heartPose';
import {
  classifyThorax,
  DESC_AORTA_R,
  DESC_AORTA_WALL,
  DESC_AORTA_X,
  DESC_AORTA_Z,
  isAnteriorLung,
} from './thoraxModel';
import { makeSample, Structure } from './tissue';

/**
 * The descending aorta (decision 213): left-anterolateral to the vertebral body, against the posterior wall of the left
 * atrium, and in the parasternal long axis behind the atrioventricular groove in cross-section (Goldstein et al., JASE
 * 2015). It used to run 1 cm right of the midline, where the long axis cut it behind the upper atrium on the side of the
 * aortic root, 22° off the centre of the sector; the left superior pulmonary vein ran backwards through its proper place.
 */
const OUTER = DESC_AORTA_R + DESC_AORTA_WALL;

describe('descending aorta (decision 213)', () => {
  const c = loadCaseById('normal-excellent-window');
  const { heart, thorax, tables } = new SimulatorCore(c, baseInput()).models;
  const s = makeSample();
  const inHeart = (x: number, y: number, z: number, hp: ReturnType<typeof computeHeartPose>) => {
    const h = torsoToHeart(heart.frame, v3(x, y, z));
    return classifyHeart(heart, hp, h.x + hp.swingX, h.y, h.z, s);
  };

  it('runs left of the midline beside the vertebral body and against the pericardium behind the left atrium', () => {
    expect(DESC_AORTA_X).toBeGreaterThan(1.5);
    // clear of the vertebral body (x 0, z −17.3, radius 2.2), and not more than a few millimetres from it
    const spine = Math.hypot(DESC_AORTA_X, DESC_AORTA_Z + 17.3) - 2.2 - OUTER;
    expect(spine).toBeGreaterThan(0);
    expect(spine).toBeLessThan(0.6);
    // at the height of the atrium the sac lies within 3 mm of the aortic wall, straight in front of it
    const hp = computeHeartPose(heart, cycleStateAt(tables, 0));
    let gap = Infinity;
    for (let y = -1.5; y <= 0.5; y += 0.25) {
      let r = OUTER;
      while (r < OUTER + 3 && !inHeart(DESC_AORTA_X, y, DESC_AORTA_Z + r, hp)) r += 0.02;
      gap = Math.min(gap, r - OUTER);
    }
    expect(gap).toBeLessThan(0.3);
  });

  it('is never crossed by the heart or the pulmonary veins, which pass in front of it through the cycle', () => {
    let inside = 0;
    for (const phase of [0, 0.2, 0.35, 0.6, 0.85]) {
      const hp = computeHeartPose(heart, cycleStateAt(tables, phase));
      for (let y = -6; y <= 4; y += 0.25)
        for (let k = 0; k < 24; k++) {
          const a = (k / 24) * 2 * Math.PI;
          for (const r of [0, 0.5, DESC_AORTA_R - 0.05]) {
            if (inHeart(DESC_AORTA_X + r * Math.cos(a), y, DESC_AORTA_Z + r * Math.sin(a), hp)) {
              inside++;
              if (s.structure === Structure.PulmonaryVein) inside += 100;
            }
          }
        }
    }
    expect(inside).toBe(0);
  });

  it('lies behind the atrioventricular groove in the long axis, with mediastinal fat and no lung in front of it', () => {
    const b = beamFrameFromPose(
      poseFromControl(thorax, canonicalControl(getViewTarget('plax'), heart, thorax)),
    );
    const hp = computeHeartPose(heart, cycleStateAt(tables, 0));
    const at = (r: number, th: number) =>
      add(b.origin, add(scale(b.forward, r * Math.cos(th)), scale(b.lateral, r * Math.sin(th))));
    let n = 0,
      st = 0,
      sr = 0;
    for (let r = 8; r < 18; r += 0.05)
      for (let th = -0.6; th <= 0.6; th += 0.01) {
        const p = at(r, th);
        if (Math.hypot(p.x - DESC_AORTA_X, p.z - DESC_AORTA_Z) > OUTER) continue;
        if (isAnteriorLung(thorax, p.x, p.y, p.z) || inHeart(p.x, p.y, p.z, hp)) continue;
        n++;
        st += th;
        sr += r;
      }
    // seen in cross-section in the middle of the sector, behind the atrium (before: 22° off the centre)
    expect(n * 0.05 * 0.01 * (sr / n)).toBeGreaterThan(2);
    const th = st / n;
    expect(Math.abs((th * 180) / Math.PI)).toBeLessThan(8);
    // along that line: the heart, then soft tissue and no lung, then the aorta within 1.5 cm of the heart
    let last = NaN,
      lung = 0,
      first = NaN;
    for (let r = 6; r < 18; r += 0.02) {
      const p = at(r, th);
      if (Math.hypot(p.x - DESC_AORTA_X, p.z - DESC_AORTA_Z) <= OUTER) {
        first = r;
        break;
      }
      if (inHeart(p.x, p.y, p.z, hp)) {
        last = r;
        lung = 0;
      } else if (Number.isFinite(last) && classifyThorax(thorax, p.x, p.y, p.z, s, s.sdf))
        if (s.structure === Structure.Lung) lung++;
    }
    expect(Number.isFinite(last) && Number.isFinite(first)).toBe(true);
    expect(first - last).toBeLessThan(1.5);
    expect(lung).toBe(0);
  });
});
