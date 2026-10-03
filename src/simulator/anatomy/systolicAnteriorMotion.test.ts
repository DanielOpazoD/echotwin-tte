// @tier slow
import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { SimulatorCore } from '@/simulator/core/simulatorCore';
import { baseInput } from '@/simulator/core/baseInput';
import { classifyHeart, computeHeartPose } from '@/simulator/anatomy/heartModel';
import { torsoToHeart } from '@/simulator/anatomy/heartFrame';
import { makeSample, Structure, Tissue } from '@/simulator/anatomy/tissue';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import { add, scale } from '@/core/vec3';

/**
 * Systolic anterior motion reaches the septum in obstructive hypertrophic cardiomyopathy (decision 268): the mitral–
 * septal contact is what defines it on the parasternal long axis. The anterior leaflet blended toward its open profile
 * with the contraction, which peaks at end-systole, and no further than 0.8 of the way: on the drawn long axis it stayed
 * 19–21 mm from the septal muscle through systole, as in the normal heart (21.5 mm).
 */
const STEP = 0.05;

/** Closest approach (cm) on the drawn long axis of the anterior mitral leaflet to the septal muscle at a phase. */
function leafletToSeptum(id: string, phase: number): number {
  const { heart, thorax, tables } = new SimulatorCore(loadCaseById(id), baseInput()).models;
  const beam = beamFrameFromPose(
    poseFromControl(thorax, canonicalControl(getViewTarget('plax'), heart, thorax)),
    1,
  );
  const pose = computeHeartPose(heart, cycleStateAt(tables, phase));
  const s = makeSample();
  const leaflet: [number, number][] = [],
    septum: [number, number][] = [];
  for (let dep = 2; dep < 14; dep += STEP)
    for (let lat = -6; lat < 6; lat += STEP) {
      const p = add(beam.origin, add(scale(beam.forward, dep), scale(beam.lateral, lat)));
      const h = torsoToHeart(heart.frame, p);
      if (!classifyHeart(heart, pose, h.x + pose.swingX, h.y, h.z, s)) continue;
      if (s.structure === Structure.MitralAnterior) leaflet.push([dep, lat]);
      // the septal muscle, not the fibrous curtain the leaflet hangs from
      else if (s.structure === Structure.LvWallSeptal && s.tissue === Tissue.Myocardium)
        septum.push([dep, lat]);
    }
  let best = Infinity;
  for (const [a, b] of leaflet)
    for (const [c, d] of septum) best = Math.min(best, Math.hypot(a - c, b - d));
  return best;
}

/** Phases of the ejection, from the aortic valve's opening to its closure. */
function ejectionPhases(id: string): number[] {
  const { tables } = new SimulatorCore(loadCaseById(id), baseInput()).models;
  const out: number[] = [];
  for (let ph = 0; ph < 1; ph += 0.05) if (cycleStateAt(tables, ph).avOpen > 0) out.push(ph);
  return out;
}

describe('systolic anterior motion (decision 268)', () => {
  it('in the obstructive hypertrophic case the anterior leaflet touches the septum for at least a fifth of the ejection', () => {
    const phases = ejectionPhases('hocm-sam');
    const touching = phases.filter((ph) => leafletToSeptum('hocm-sam', ph) <= 0.1).length;
    expect(touching / phases.length).toBeGreaterThanOrEqual(0.2);
  });

  it('in the normal heart it stays more than 15 mm from the septum through the ejection', () => {
    const closest = Math.min(
      ...ejectionPhases('normal-excellent-window').map((ph) =>
        leafletToSeptum('normal-excellent-window', ph),
      ),
    );
    expect(closest).toBeGreaterThan(1.5);
  });
});
