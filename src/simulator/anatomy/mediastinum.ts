import type { Vec3 } from '@/core/vec3';
import { heartAnchors } from './anchors';
import { heartToTorso, ROOT_EXCURSION } from './heartFrame';
import type { HeartModel, HeartPose } from './heartModel';
import {
  DESC_AORTA_X,
  DESC_AORTA_Z,
  NOTCH_V_CM,
  skinZ,
  SPINE_R,
  SPINE_Z,
  STERNUM_DEPTH_FRACTION,
  STERNUM_THICKNESS_CM,
  type ThoraxModel,
} from './thoraxModel';

/**
 * The base of the heart and the mediastinum measured on the model with the definitions `tools/clinical/ct-mediastinum.ts`
 * uses on CT (decision 307), so the two can be compared number for number. Torso frame, cm; angles in degrees.
 *
 * The CT measures its axial sections at the carina, which the model does not have: the model's sections are taken at the
 * CT's median height of the carina above the aortic root (`levelAboveRootCm`). Root and carina move together with the
 * breath; the arch apex and the notch do not, and the CT is taken at deep inspiration (decision 307).
 */
export interface MediastinumMeasures {
  sternumToAscendingAorta: number;
  ascendingDepth: number;
  descendingDepth: number;
  vertebraDepth: number;
  archWidth: number;
  chestAp: number;
  notchToArchApex: number;
  archApexBelowNotch: number;
  archApexBehindNotch: number;
  rootDepth: number;
  ascendingForwardTiltDeg: number;
  ascendingRightTiltDeg: number;
  rootToArchApexHeight: number;
  rootToNotchHeight: number;
}

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const len = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);

/** The point of a polyline at height y (torso), searched from `from` to `to` (inclusive indices), or null. */
function atHeight(path: Vec3[], y: number, from: number, to: number): Vec3 | null {
  const step = from <= to ? 1 : -1;
  for (let i = from; i !== to; i += step) {
    const a = path[i]!,
      b = path[i + step]!;
    if ((a.y - y) * (b.y - y) <= 0 && a.y !== b.y) {
      const u = (y - a.y) / (b.y - a.y);
      return { x: a.x + (b.x - a.x) * u, y, z: a.z + (b.z - a.z) * u };
    }
  }
  return null;
}

export function measureMediastinum(
  heart: HeartModel,
  thorax: ThoraxModel,
  edPose: HeartPose,
  levelAboveRootCm: number,
): MediastinumMeasures {
  const A = heartAnchors(heart);
  const arch = edPose.aorta.geometry.arch;
  const path = arch.map((p) => heartToTorso(heart.frame, p.p));
  const radius = arch.map((p) => p.radiusCm);
  // the apex: the highest point of the course
  let top = 0;
  for (let i = 1; i < path.length; i++) if (path[i]!.y > path[top]!.y) top = i;
  const apex = path[top]!;
  const notch = { x: 0, y: NOTCH_V_CM, z: skinZ(thorax, 0, NOTCH_V_CM) };
  // the aortic root (valve centre) and the root and ascending centre line up to 4 cm above it
  const avH = { ...A.avCenter, z: A.avCenter.z + edPose.zAnn * ROOT_EXCURSION };
  const root = heartToTorso(heart.frame, avH);
  const centreLine: Vec3[] = [];
  for (let t = 0; t <= 1.6; t += 0.2)
    centreLine.push(
      heartToTorso(heart.frame, {
        x: avH.x + A.avAxis.x * t,
        y: avH.y + A.avAxis.y * t,
        z: avH.z + A.avAxis.z * t,
      }),
    );
  for (let i = 0; i <= top && path[i]!.y - root.y <= 4; i++) centreLine.push(path[i]!);
  // principal axis of the centre line, pointing up (as the CT tool does)
  const c = centreLine.reduce((s, p) => ({ x: s.x + p.x, y: s.y + p.y, z: s.z + p.z }), {
    x: 0,
    y: 0,
    z: 0,
  });
  const m = { x: c.x / centreLine.length, y: c.y / centreLine.length, z: c.z / centreLine.length };
  const C = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const p of centreLine) {
    const d = [p.x - m.x, p.y - m.y, p.z - m.z];
    for (let r = 0; r < 3; r++)
      for (let q = 0; q < 3; q++) C[3 * r + q] = C[3 * r + q]! + d[r]! * d[q]!;
  }
  let v = [0, 1, 0];
  for (let it = 0; it < 50; it++) {
    const n = [0, 1, 2].map(
      (r) => C[3 * r]! * v[0]! + C[3 * r + 1]! * v[1]! + C[3 * r + 2]! * v[2]!,
    );
    const l = Math.hypot(n[0]!, n[1]!, n[2]!) || 1;
    v = n.map((x) => x / l);
  }
  if (v[1]! < 0) v = v.map((x) => -x);

  // the axial level of the sections: above the root by the CT's median carina height
  const y = root.y + levelAboveRootCm;
  const asc = atHeight(path, y, 0, top) ?? root;
  const ascR =
    radius[
      Math.max(
        0,
        Math.min(
          top,
          path.findIndex((p) => p.y >= y),
        ),
      )
    ] ?? radius[0]!;
  const desc = atHeight(path, y, path.length - 1, top) ?? {
    x: DESC_AORTA_X,
    y,
    z: DESC_AORTA_Z + heart.columnShiftCm,
  };
  const T = thorax.chestWall;
  const sternumBack = skinZ(thorax, 0, y) - (STERNUM_DEPTH_FRACTION * T + STERNUM_THICKNESS_CM);
  const skin = (p: Vec3) => skinZ(thorax, p.x, p.y);
  return {
    sternumToAscendingAorta: sternumBack - (asc.z + ascR),
    ascendingDepth: skin(asc) - asc.z,
    descendingDepth: skin(desc) - desc.z,
    vertebraDepth: skinZ(thorax, 0, y) - (SPINE_Z + heart.columnShiftCm + SPINE_R),
    archWidth: len(sub(asc, desc)),
    chestAp: thorax.bDepth * 2,
    notchToArchApex: len(sub(notch, apex)),
    archApexBelowNotch: notch.y - apex.y,
    archApexBehindNotch: notch.z - apex.z,
    rootDepth: skin(root) - root.z,
    ascendingForwardTiltDeg: (Math.atan2(v[2]!, v[1]!) * 180) / Math.PI,
    ascendingRightTiltDeg: (Math.atan2(-v[0]!, v[1]!) * 180) / Math.PI,
    rootToArchApexHeight: apex.y - root.y,
    rootToNotchHeight: notch.y - root.y,
  };
}
