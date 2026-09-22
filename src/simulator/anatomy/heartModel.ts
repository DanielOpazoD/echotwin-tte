import type { AnatomyConfig, PhysiologyConfig } from '@/cases/schema';
import { Structure, Tissue, type TissueSample } from './tissue';
import { lvCavityRadius, lvRadialOffsetFactor } from './lvShape';
import { noiseLattice } from '@/core/noise';
import type { Vec3 } from '@/core/vec3';
import { add, scale, v3 } from '@/core/vec3';
import {
  lvGeometryFromVolume,
  regionalMeanFraction,
  segmentAmplitudes,
  ahaSegment,
  type LvGeometry,
  type SegmentAmplitudes,
} from './lvGeometry';
import { buildHeartFrame, type HeartFrame } from './heartFrame';
import { wallThicknessAt } from './lvWall';
import { classifyHeart } from './classify';
import { anchorsCached } from './anchors';
import type { HeartPose } from './heartPose';

/**
 * Parametric, kinematic heart model — the conceptual source of truth for anatomy (spec 6).
 *
 * HEART FRAME (cm): origin = centre of the mitral annulus at end diastole.
 *   +z : long axis, base → apex
 *   +x : septal → lateral (medial → lateral)
 *   +y : inferior → anterior (the RV and aortic root are anterior)
 * Standard planes: PLAX contains z and the anteroseptal↔inferolateral direction; A4C contains z
 * and x (inferoseptal↔anterolateral); A2C contains z and y (anterior↔inferior).
 *
 * Geometry is analytic (ellipsoids, tubes, thin patches). Contraction is volume-consistent:
 * cavity radii follow V(φ) from the beat tables, the myocardium is incompressible (wall thickening
 * emerges), the base descends by MAPSE·long(φ) (atria lengthen in systole), valves open with flow.
 *
 * The implementation is split by responsibility (this module is the public facade):
 *   heartFrame.ts   heart↔torso coordinate frame and shared constants
 *   lvGeometry.ts   LV cavity geometry and AHA segments
 *   lvWall.ts       local wall thickness and septal flattening
 *   valveSkirt.ts   leaflet "skirt" surfaces and semilunar cusp chains
 *   rv.ts           RV crescent geometry
 *   anchors.ts      fixed anatomical anchor points and landmarks
 *   heartPose.ts    per-frame deformation state and valve geometry
 *   classify.ts     the point classifier (SDF → tissue sample)
 */

export interface HeartModel {
  anatomy: AnatomyConfig;
  physiology: PhysiologyConfig;
  lv: LvGeometry;
  segAmp: SegmentAmplitudes;
  frame: HeartFrame;
  /** Bounding sphere in heart frame for early-out. */
  boundRadius: number;
  boundCenter: Vec3;
  /** Lattice for wall-thickness modulation (seeded). */
  wallNoise: Uint8Array;
  /** Surface-weighted mean of (1 − amplitude) over the 17 segments: the outward cavity shift that akinetic segments add. */
  regionalMeanFrac: number;
  /** Inferior vena cava diameter reduction 0..1 for the current respiratory state (sniff / inspiration). */
  ivcCollapse: number;
}

export function createHeartModel(
  anatomy: AnatomyConfig,
  physiology: PhysiologyConfig,
  offset: Vec3 = v3(),
  seed = 1,
  ivcCollapse = 0,
): HeartModel {
  const lv = lvGeometryFromVolume(
    physiology.edvMl,
    anatomy.lv.lengthEdCm,
    anatomy.lv.sphericity,
    anatomy.lv,
  );
  return {
    anatomy,
    physiology,
    lv,
    segAmp: segmentAmplitudes(anatomy),
    frame: buildHeartFrame(anatomy, offset),
    boundRadius: lv.lengthCm * 0.5 + 8.5,
    boundCenter: v3(-1.2, 0.2, lv.lengthCm * 0.5 - 1.5),
    wallNoise: noiseLattice(seed ^ 0x5157),
    regionalMeanFrac: regionalMeanFraction(segmentAmplitudes(anatomy)),
    ivcCollapse: Math.min(0.95, Math.max(0, ivcCollapse)),
  };
}

// ---- Public API re-exports (the model was split by responsibility; the import surface is unchanged) ----
export {
  AV_AXIS,
  ROOT_EXCURSION,
  PV_ROOT_EXCURSION,
  ROOT_ASC_T,
  ROOT_SINUS_T,
  ROOT_STJ_T,
  AV_COAPT_HALF,
  buildHeartFrame,
  torsoToHeart,
  heartToTorso,
  heartDirToTorso,
} from './heartFrame';
export type { HeartFrame } from './heartFrame';
export { lvGeometryFromVolume, segmentAmplitudes, ahaSegment } from './lvGeometry';
export type { LvGeometry, SegmentAmplitudes } from './lvGeometry';
export { computeHeartPose, TV_SYSTOLIC_SHORTENING } from './heartPose';
export type { HeartPose, ValveGeometry } from './heartPose';
export type { SkirtDesc, SkirtZone } from './valveSkirt';
export { classifyHeart } from './classify';
export { anchors, anchorsCached, heartAnchors, heartLandmarks, heartRootAxis } from './anchors';
export type { Anchors, AnchorsCached, HeartAnchors, Landmark } from './anchors';

/** Utility for tests/devtools: Monte-Carlo cavity volume (mL) of a structure. */
export function estimateStructureVolume(
  m: HeartModel,
  hp: HeartPose,
  structures: Structure[],
  samples: number,
  seedRng: () => number,
  box?: { min: Vec3; max: Vec3 },
): number {
  const out: TissueSample = {
    tissue: Tissue.None,
    sdf: 0,
    nx: 0,
    ny: 0,
    nz: 0,
    mx: 0,
    my: 0,
    mz: 0,
    extraReflect: 0,
    structure: Structure.None,
    transmural: -1,
    segment: 0,
  };
  const R = m.boundRadius;
  const c = m.boundCenter;
  const min = box?.min ?? v3(c.x - R, c.y - R, c.z - R);
  const max = box?.max ?? v3(c.x + R, c.y + R, c.z + R);
  const vol = (max.x - min.x) * (max.y - min.y) * (max.z - min.z);
  let hits = 0;
  for (let i = 0; i < samples; i++) {
    const x = min.x + seedRng() * (max.x - min.x);
    const y = min.y + seedRng() * (max.y - min.y);
    const z = min.z + seedRng() * (max.z - min.z);
    if (classifyHeart(m, hp, x, y, z, out) && structures.includes(out.structure)) hits++;
  }
  return (hits / samples) * vol;
}

/** Simple translucent primitives (heart frame) for the 3D torso ghost; derived from the same anchors as the SDF model. */
export interface GhostPrimitive {
  kind: 'ellipsoid' | 'tube';
  center: Vec3;
  radii: Vec3;
  /** tube only: end point */
  end?: Vec3;
  color: number;
  opacity: number;
}
export function heartGhostPrimitives(m: HeartModel): GhostPrimitive[] {
  const A = anchorsCached(m);
  const lv = m.lv;
  const t = (lv.ivsd + lv.lvpwd) / 2;
  const rootEnd = add(A.avCenter, scale(A.avAxis, 4.5));
  return [
    {
      kind: 'ellipsoid',
      center: v3(0, 0, lv.lengthCm * 0.48),
      radii: v3(lv.rMax + t, lv.rMax * lv.shape.ratio + t, lv.lengthCm * 0.55),
      color: 0xc0413f,
      opacity: 0.35,
    },
    {
      kind: 'ellipsoid',
      center: A.rvCenter,
      radii: v3(A.rvR.x * 0.75, A.rvR.y * 0.62, A.rvR.z * 0.9),
      color: 0x8a3a6a,
      opacity: 0.28,
    },
    { kind: 'ellipsoid', center: A.laCenter, radii: A.laR, color: 0xb05050, opacity: 0.25 },
    { kind: 'ellipsoid', center: A.raCenter, radii: A.raR, color: 0x7a4a7a, opacity: 0.25 },
    {
      kind: 'tube',
      center: A.avCenter,
      end: rootEnd,
      radii: v3(A.sinusR, A.sinusR, A.sinusR),
      color: 0xd86a6a,
      opacity: 0.3,
    },
  ];
}

/** LV cavity radius (cm, from the long axis) at azimuth `az` and height `z` for a pose (measurement tools). */
export function lvCavityRadiusAt(m: HeartModel, hp: HeartPose, az: number, z: number): number {
  return lvCavityRadius(m.lv.shape, hp.prof, az, z);
}

/** LV epicardial radius at azimuth `az` and height `z`: cavity radius plus the local wall thickness (radial). */
export function lvEpicardialRadiusAt(m: HeartModel, hp: HeartPose, az: number, z: number): number {
  const levelFrac = Math.min(1, Math.max(0, (z - hp.zAnn) / Math.max(hp.lengthNow, 1)));
  const amp = m.segAmp[ahaSegment(az, levelFrac)] ?? 1;
  return (
    lvCavityRadius(m.lv.shape, hp.prof, az, z) +
    wallThicknessAt(m, hp.thickK, az, levelFrac, amp) *
      lvRadialOffsetFactor(m.lv.shape, hp.prof, az, z)
  );
}
