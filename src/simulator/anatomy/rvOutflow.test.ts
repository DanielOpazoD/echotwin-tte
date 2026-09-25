// @tier slow
import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { SimulatorCore } from '@/simulator/core/simulatorCore';
import { baseInput } from '@/simulator/core/baseInput';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { add, scale, sub } from '@/core/vec3';
import { classifyHeart } from './classify';
import { torsoToHeart } from './heartFrame';
import { computeHeartPose } from './heartPose';
import { rvRadialContraction } from './rv';
import { makeSample, Structure } from './tissue';

/**
 * The RV free wall runs into the outflow tract without an edge (decision 214). Daniel marked it in the long axis: «the
 * contraction of the RV free wall in relation to the outflow tract seems too abrupt where the contraction ends». The body
 * lost 35 % of its cavity depth up to the edge of the outflow cones, which lose 15 %; the infundibular narrowing was a
 * step at the tricuspid plane, which descends with the annulus and swept the wall in systole; and the two cavities were
 * a plain union. The endocardial excursion jumped by 3.3 mm between neighbouring scan lines and in systole a centimetre
 * of wall stood between the body and the outflow lumen.
 */
describe('RV free wall and outflow tract (decision 214)', () => {
  const c = loadCaseById('normal-excellent-window');
  const { heart, thorax, tables } = new SimulatorCore(c, baseInput()).models;
  const b = beamFrameFromPose(
    poseFromControl(thorax, canonicalControl(getViewTarget('plax'), heart, thorax)),
  );
  const O = torsoToHeart(heart.frame, b.origin);
  const F = sub(torsoToHeart(heart.frame, add(b.origin, b.forward)), O);
  const L = sub(torsoToHeart(heart.frame, add(b.origin, b.lateral)), O);
  const s = makeSample();
  const structureAt = (hp: ReturnType<typeof computeHeartPose>, r: number, thDeg: number) => {
    const t = (thDeg * Math.PI) / 180;
    const p = add(O, add(scale(F, r * Math.cos(t)), scale(L, r * Math.sin(t))));
    return classifyHeart(heart, hp, p.x + hp.swingX, p.y, p.z, s) ? s.structure : Structure.None;
  };
  const LINES = Array.from({ length: 23 }, (_, i) => -10 + 2 * i);

  it('moves the anterior wall of the long axis smoothly from the body into the outflow tract', () => {
    const poses = Array.from({ length: 20 }, (_, i) =>
      computeHeartPose(heart, cycleStateAt(tables, i / 20)),
    );
    const excursion = LINES.map((th) => {
      const depths = poses.map((hp) => {
        let inWall = false;
        for (let r = 0.5; r < 7; r += 0.01) {
          const st = structureAt(hp, r, th);
          if (st === Structure.RvWall) inWall = true;
          else if (inWall && (st === Structure.RvCavity || st === Structure.Rvot)) return r;
        }
        return NaN;
      });
      expect(depths.every(Number.isFinite), `θ ${th}°`).toBe(true);
      return (Math.max(...depths) - Math.min(...depths)) * 10;
    });
    const jumps = excursion.slice(1).map((e, i) => Math.abs(e - excursion[i]!));
    expect(Math.max(...jumps), excursion.map((e) => e.toFixed(1)).join(' ')).toBeLessThan(2);
  });

  it('leaves no band of wall between the body and the outflow lumens in systole', () => {
    const hp = computeHeartPose(heart, cycleStateAt(tables, 0.35));
    const banded: number[] = [];
    for (const th of LINES) {
      let seenBody = false,
        wallAfter = 0;
      for (let r = 0.5; r < 6; r += 0.01) {
        const st = structureAt(hp, r, th);
        if (st === Structure.RvCavity) {
          seenBody = true;
          wallAfter = 0;
        } else if (seenBody && st === Structure.RvWall) wallAfter += 0.01;
        else if (st === Structure.Rvot) {
          if (seenBody && wallAfter > 0.05) banded.push(th);
          break;
        }
      }
    }
    expect(banded).toEqual([]);
  });

  it('contracts the outflow tract less than the body, as the infundibulum does', () => {
    // groove fraction: the outflow cones run from u 0.38 to the pulmonary valve at 0.03; the inflow is at 0.75
    expect(rvRadialContraction(0.05)).toBeCloseTo(0.15, 6);
    expect(rvRadialContraction(0.75)).toBeCloseTo(0.42, 6);
    for (let u = 0; u < 1; u += 0.05)
      expect(rvRadialContraction(u + 0.05)).toBeGreaterThanOrEqual(rvRadialContraction(u));
  });
});
