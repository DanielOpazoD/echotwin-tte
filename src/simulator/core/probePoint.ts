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
  return probeTorsoPointAt(
    heart,
    thorax,
    pose,
    beam,
    {
      x: beam.origin.x + (beam.forward.x * ct + beam.lateral.x * sn) * rCm,
      y: beam.origin.y + (beam.forward.y * ct + beam.lateral.y * sn) * rCm,
      z: beam.origin.z + (beam.forward.z * ct + beam.lateral.z * sn) * rCm,
    },
    phase,
  );
}

/**
 * The same reading for a torso-frame point (a click on the 3D navigator, decision 135): its polar position
 * projected onto the image plane and its distance from that plane come with the classification.
 */
export function probeTorsoPointAt(
  heart: HeartModel,
  thorax: ThoraxModel,
  pose: HeartPose,
  beam: BeamFrame,
  p: { x: number; y: number; z: number },
  phase: number,
): ProbePointInfo {
  const dx = p.x - beam.origin.x,
    dy = p.y - beam.origin.y,
    dz = p.z - beam.origin.z;
  const along = dx * beam.forward.x + dy * beam.forward.y + dz * beam.forward.z;
  const lat = dx * beam.lateral.x + dy * beam.lateral.y + dz * beam.lateral.z;
  const off = dx * beam.normal.x + dy * beam.normal.y + dz * beam.normal.z;
  const h = torsoToHeart(heart.frame, p);
  const q = sample;
  let inHeart = false;
  if (isAnteriorLung(thorax, p.x, p.y, p.z)) {
    q.tissue = Tissue.Lung;
    q.structure = Structure.Lung;
    q.sdf = -1;
  } else if (classifyHeart(heart, pose, h.x, h.y, h.z, q)) inHeart = true;
  else classifyThorax(thorax, p.x, p.y, p.z, q, q.sdf);
  const nearRoot = inHeart && classifyCtx.rootT > -50;
  return {
    rCm: Math.hypot(along, lat),
    thetaRad: Math.atan2(lat, along),
    offPlaneCm: off,
    phase,
    torso: { x: p.x, y: p.y, z: p.z },
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
