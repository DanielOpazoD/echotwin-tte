// @tier slow
import { describe, expect, it } from 'vitest';
import { CASE_INPUTS, loadCaseById } from '@/cases';
import { add, scale } from '@/core/vec3';
import { buildCaseModels } from '@/simulator/anatomy/caseModels';
import { torsoToHeart } from '@/simulator/anatomy/heartFrame';
import { classifyHeart, computeHeartPose } from '@/simulator/anatomy/heartModel';
import { makeSample, Structure } from '@/simulator/anatomy/tissue';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import { canonicalControl, VIEW_TARGETS } from '@/simulator/windows/viewTargets';

/**
 * The mitral short axis keeps the whole ventricle through the cycle (decision 368). On the canonical plane, at every
 * phase, rays from the left ventricular cavity's centroid meet the ventricle's own wall at least RING_MIN of the time
 * (past the cavity, the papillary muscles, the chords, the leaflets and the outflow tract); in diastole the leaflets
 * cross the plane (at least LEAFLETS_MIN samples at their widest), and no papillary muscle does. At the level of 1.4 cm,
 * from the PLAX space, the left atrium took 28-57 % of the ring from mid-systole to early diastole in every case: the
 * annulus descends 1.3-1.5 cm, and the window's obliquity put the plane's inferolateral side 0.1-1.2 cm from it.
 */
const RING_MIN = 0.95;
const LEAFLETS_MIN = 50;
const RAYS = 72;
const STEP_CM = 0.12;

/**
 * Where the ring opens, `case` → [phase where it is narrowest, its share]: the difficult window and the artifact case
 * cannot climb (the lung covers more than 30 % of the upper space's rays) and their planes, 24-25° off the short axis,
 * meet the left atrium or the mitral annulus in diastole; the prolapse's touches the annulus in early diastole; and the inferior infarct's akinetic basal wall
 * stands 4 mm off its cavity in systole, with fat between, whatever the plane.
 */
const KNOWN_OPEN_RING: Record<string, [phase: number, share: number]> = {
  'normal-difficult-window': [0.55, 0.69],
  'artifact-challenge': [0.7, 0.85],
  'mvp-primary-mr': [0.55, 0.85],
  'inferior-rwma': [0.46, 0.63],
};

const WALLS = new Set<number>([
  Structure.LvWallSeptal,
  Structure.LvWallLateral,
  Structure.LvWallAnterior,
  Structure.LvWallInferior,
]);
const INSIDE = new Set<number>([
  Structure.LvCavity,
  Structure.PapillaryMuscle,
  Structure.MitralAnterior,
  Structure.MitralPosterior,
  Structure.Chordae,
  Structure.Lvot,
]);

describe('the mitral short axis keeps the whole ventricle through the cycle (decision 368)', () => {
  for (const { id } of CASE_INPUTS)
    it(id, () => {
      const { heart, thorax, tables } = buildCaseModels(loadCaseById(id), {
        position: 'left-lateral',
        respiration: 'expiration',
        headElevationDeg: 0,
      });
      const view = VIEW_TARGETS.find((v) => v.id === 'psax-mv')!;
      const beam = beamFrameFromPose(
        poseFromControl(thorax, canonicalControl(view, heart, thorax)),
        1,
      );
      const s = makeSample();
      const es = tables.timings.ejectionEndS / tables.rrS;
      let narrowest = { phase: 0, share: 1 };
      let leaflets = 0;
      let papillary = 0;
      for (const phase of [0, 0.1, 0.2, 0.3, es, 0.55, 0.6, 0.65, 0.7, 0.8, 0.9]) {
        const pose = computeHeartPose(heart, cycleStateAt(tables, phase));
        const at = (u: number, d: number): number => {
          const h = torsoToHeart(
            heart.frame,
            add(add(beam.origin, scale(beam.forward, d)), scale(beam.lateral, u)),
          );
          return classifyHeart(heart, pose, h.x + pose.swingX, h.y, h.z, s) ? s.structure : 0;
        };
        let cu = 0;
        let cd = 0;
        let n = 0;
        let mv = 0;
        for (let d = 4; d < 16; d += STEP_CM)
          for (let u = -5; u < 5; u += STEP_CM) {
            const st = at(u, d);
            if (st === Structure.LvCavity) {
              cu += u;
              cd += d;
              n++;
            } else if (st === Structure.PapillaryMuscle) papillary++;
            else if (st === Structure.MitralAnterior || st === Structure.MitralPosterior) mv++;
          }
        if (phase > es) leaflets = Math.max(leaflets, mv);
        cu /= n;
        cd /= n;
        let wall = 0;
        for (let k = 0; k < RAYS; k++) {
          const a = (k / RAYS) * 2 * Math.PI;
          let st: number = Structure.LvCavity;
          for (let t = 0; t < 5 && INSIDE.has(st); t += 0.03)
            st = at(cu + t * Math.sin(a), cd + t * Math.cos(a));
          if (WALLS.has(st)) wall++;
        }
        if (wall / RAYS < narrowest.share) narrowest = { phase, share: wall / RAYS };
      }
      const problems: string[] = [];
      const known = KNOWN_OPEN_RING[id];
      const ring = `${Math.round(narrowest.share * 100)} % of the ring at ${narrowest.phase.toFixed(2)}`;
      if (known === undefined) {
        if (narrowest.share < RING_MIN)
          problems.push(`the ventricle's own wall holds only ${ring}`);
      } else if (!(narrowest.share < RING_MIN && Math.abs(narrowest.share - known[1]) <= 0.06))
        problems.push(`${ring}, where KNOWN_OPEN_RING declares ${known[1]} at ${known[0]}`);
      if (leaflets < LEAFLETS_MIN)
        problems.push(`the leaflets cross the plane in ${leaflets} samples at most in diastole`);
      if (papillary > 0) problems.push(`papillary muscle in the plane (${papillary} samples)`);
      expect(problems).toEqual([]);
    });
});
