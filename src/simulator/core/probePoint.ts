import type { BeamFrame } from '@/simulator/probe/pose';
import { classifyHeart, type HeartModel } from '@/simulator/anatomy/heartModel';
import type { HeartPose } from '@/simulator/anatomy/heartPose';
import { torsoToHeart } from '@/simulator/anatomy/heartFrame';
import { classifyThorax, isAnteriorLung, type ThoraxModel } from '@/simulator/anatomy/thoraxModel';
import { makeSample, Structure, Tissue } from '@/simulator/anatomy/tissue';
import { ctx as classifyCtx } from '@/simulator/anatomy/classify/context';
import type { ProbePointInfo } from './protocol';

const sample = makeSample();

/**
 * What the model holds at one polar point of the image (review mode, decision 134): the same ray geometry,
 * lung test and classifiers the tracer uses for that sample, so a marker on the screen names exactly the
 * structure the pixel was formed from. Shared by the simulator core (worker request) and the offline
 * reproduction of a review report (tools/offline/review/render-report.ts).
 */
export function probePointAt(
  heart: HeartModel,
  thorax: ThoraxModel,
  pose: HeartPose,
  beam: BeamFrame,
  rCm: number,
  thetaRad: number,
  phase: number,
): ProbePointInfo {
  const ct = Math.cos(thetaRad),
    sn = Math.sin(thetaRad);
  const px = beam.origin.x + (beam.forward.x * ct + beam.lateral.x * sn) * rCm;
  const py = beam.origin.y + (beam.forward.y * ct + beam.lateral.y * sn) * rCm;
  const pz = beam.origin.z + (beam.forward.z * ct + beam.lateral.z * sn) * rCm;
  const h = torsoToHeart(heart.frame, { x: px, y: py, z: pz });
  const q = sample;
  let inHeart = false;
  if (isAnteriorLung(thorax, px, py, pz)) {
    q.tissue = Tissue.Lung;
    q.structure = Structure.Lung;
    q.sdf = -1;
  } else if (classifyHeart(heart, pose, h.x, h.y, h.z, q)) inHeart = true;
  else classifyThorax(thorax, px, py, pz, q);
  const nearRoot = inHeart && classifyCtx.rootT > -50;
  return {
    rCm,
    thetaRad,
    phase,
    torso: { x: px, y: py, z: pz },
    heart: h,
    inHeart,
    structure: q.structure,
    tissue: q.tissue,
    sdfCm: q.sdf,
    azRad: inHeart ? Math.atan2(h.y, h.x) : null,
    levelFrac: inHeart
      ? Math.min(1, Math.max(0, (h.z - pose.zAnn) / Math.max(pose.lengthNow, 1)))
      : null,
    rootT: nearRoot ? classifyCtx.rootT : null,
    rootR: nearRoot ? classifyCtx.rootRr : null,
  };
}
