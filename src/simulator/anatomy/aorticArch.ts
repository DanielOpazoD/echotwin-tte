import { add, normalize, scale, sub, type Vec3 } from '@/core/vec3';
import type { AnchorsCached } from './anchors';
import { ROOT_STJ_T, rootRadiusAt } from './aorticValve';
import { rootBend } from './classify/root';
import { heartToTorso, torsoToHeart, ROOT_EXCURSION } from './heartFrame';
import type { HeartModel, HeartPose } from './heartModel';
import { DESC_AORTA_X, DESC_AORTA_Z } from './thoraxModel';
import type { VascularPathPoint } from './vascularTube';

/** Idealized extension of the existing root; dimensions in cm, all returned points in HEART frame.
 * Mansouri et al., Front Cardiovasc Med 2024, DOI 10.3389/fcvm.2024.1358601, tables 3/6/7.
 * The pooled geometry is an explicit approximation, not a patient-specific reconstruction.
 */
export type AorticPathPoint = VascularPathPoint;
export interface AorticArchGeometry {
  arch: AorticPathPoint[];
  branches: AorticPathPoint[][];
  descendingTopTorsoY: number;
}
const STEPS_PER_CURVE = 16;
const ARCH_HEIGHT_CM = 4.06;
const ARCH_RADIUS_CM = 2.65 / 2;
const JOIN_T = ROOT_STJ_T;
// STJ to arch onset: weak prior (five subjects, table 4). Sets tangent lengths;
// the resulting curved length is an approximation, not a reproduced measurement.
const ASCENDING_LENGTH_CM = 2.6;

function hermite(a: Vec3, b: Vec3, da: Vec3, db: Vec3, u: number): Vec3 {
  const u2 = u * u,
    u3 = u2 * u;
  const at = 2 * u3 - 3 * u2 + 1,
    bt = -2 * u3 + 3 * u2;
  const ad = u3 - 2 * u2 + u,
    bd = u3 - u2;
  return {
    x: at * a.x + bt * b.x + ad * da.x + bd * db.x,
    y: at * a.y + bt * b.y + ad * da.y + bd * db.y,
    z: at * a.z + bt * b.z + ad * da.z + bd * db.z,
  };
}
const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** Smallest derivative stretch in the first feasible bracket that leaves a regular
 * outer tubular surface. A geometrical non-folding constraint, not a stiffness law. */
function regularTetherScale(a: Vec3, b: Vec3, da: Vec3, db: Vec3, ra: number, rb: number): number {
  const regular = (factor: number) => {
    for (let i = 0; i <= 32; i++) {
      const u = i / 32,
        u2 = u * u;
      const v = { x: 0, y: 0, z: 0 },
        acc = { x: 0, y: 0, z: 0 };
      for (const k of ['x', 'y', 'z'] as const) {
        v[k] =
          (6 * u2 - 6 * u) * (a[k] - b[k]) +
          factor * ((3 * u2 - 4 * u + 1) * da[k] + (3 * u2 - 2 * u) * db[k]);
        acc[k] =
          (12 * u - 6) * (a[k] - b[k]) + factor * ((6 * u - 4) * da[k] + (6 * u - 2) * db[k]);
      }
      const cx = v.y * acc.z - v.z * acc.y,
        cy = v.z * acc.x - v.x * acc.z,
        cz = v.x * acc.y - v.y * acc.x;
      const curvatureRadius = Math.hypot(v.x, v.y, v.z) ** 3 / Math.hypot(cx, cy, cz);
      if (curvatureRadius < ra + (rb - ra) * u2 * (3 - 2 * u) + 0.2 + 0.02) return false;
    }
    return true;
  };
  if (regular(1)) return 1;
  for (let step = 1; step <= 40; step++) {
    let hi = 1 + step / 40;
    if (!regular(hi)) continue;
    let lo = hi - 1 / 40;
    for (let i = 0; i < 8; i++) {
      const mid = (lo + hi) / 2;
      if (regular(mid)) hi = mid;
      else lo = mid;
    }
    return hi;
  }
  throw new Error('No non-folding ascending aortic tether');
}

/** Root-to-arch transition moves with the root; the posterior descending anchor stays with the thorax. */
export function buildAorticArch(
  heart: HeartModel,
  hp: Pick<HeartPose, 'zAnn' | 'swingX' | 'valves' | 'state'>,
  descendingRadiusCm: number,
  A: AnchorsCached,
): AorticArchGeometry {
  const rootAt = (t: number): Vec3 => ({
    x: A.avCenter.x + A.avAxis.x * t + A.avBend.x * rootBend(t) + hp.swingX,
    y: A.avCenter.y + A.avAxis.y * t + A.avBend.y * rootBend(t),
    z: A.avCenter.z + A.avAxis.z * t + A.avBend.z * rootBend(t) + ROOT_EXCURSION * hp.zAnn,
  });
  const start = heartToTorso(heart.frame, rootAt(JOIN_T));
  const previous = heartToTorso(heart.frame, rootAt(JOIN_T - 0.01));
  const startDirection = normalize(sub(start, previous));
  // Keep the arch fixed to the thorax cranially; systolic root descent deforms its proximal transition.
  const restStart = heartToTorso(heart.frame, {
    ...rootAt(JOIN_T),
    x: rootAt(JOIN_T).x - hp.swingX,
    z: rootAt(JOIN_T).z - ROOT_EXCURSION * hp.zAnn,
  });
  const stjRadius = rootRadiusAt(hp.valves.root, ROOT_STJ_T, 0);
  // A gradual turn from the root axis to cranial: the end is the integral of
  // linearly changing tangents. This avoids a radius of curvature smaller than the lumen.
  const ascendingOffset = scale(startDirection, ASCENDING_LENGTH_CM / 2);
  const ascendingEnd = add(
    restStart,
    add(ascendingOffset, { x: 0, y: ASCENDING_LENGTH_CM / 2, z: 0 }),
  );
  const end = { x: DESC_AORTA_X, y: ascendingEnd.y, z: DESC_AORTA_Z + heart.columnShiftCm };
  const horizontal = normalize({ x: end.x - ascendingEnd.x, y: 0, z: end.z - ascendingEnd.z });
  const halfWidth = distance({ ...ascendingEnd, y: 0 }, { ...end, y: 0 }) / 2;
  const points: AorticPathPoint[] = [];
  const restPoints: Vec3[] = [];
  const restAscendingTangent = { x: 0, y: ASCENDING_LENGTH_CM, z: 0 };
  const restStartTangent = scale(startDirection, ASCENDING_LENGTH_CM);
  // Stretch the end derivatives with the tether length as the base descends.
  // Fixed derivatives forced a tight bend near the anchored arch in systole.
  const stretch = distance(start, ascendingEnd) / distance(restStart, ascendingEnd);
  const initialAscending = scale(restAscendingTangent, stretch),
    initialStart = scale(restStartTangent, stretch);
  const regularity = regularTetherScale(
    start,
    ascendingEnd,
    initialStart,
    initialAscending,
    stjRadius,
    hp.valves.root.ascR,
  );
  const ascendingTangent = scale(initialAscending, regularity);
  const startTangent = scale(initialStart, regularity);
  for (let i = 0; i <= STEPS_PER_CURVE; i++) {
    const u = i / STEPS_PER_CURVE,
      smooth = u * u * (3 - 2 * u);
    points.push({
      p: torsoToHeart(heart.frame, hermite(start, ascendingEnd, startTangent, ascendingTangent, u)),
      radiusCm: stjRadius + (hp.valves.root.ascR - stjRadius) * smooth,
    });
    restPoints.push(
      torsoToHeart(
        heart.frame,
        hermite(restStart, ascendingEnd, restStartTangent, restAscendingTangent, u),
      ),
    );
  }
  for (let half = 0; half < 2; half++) {
    for (let i = 1; i <= STEPS_PER_CURVE; i++) {
      const u = i / STEPS_PER_CURVE;
      // Half an ellipse: vertical ascending/descending tangents and a horizontal crest.
      // The old Hermite handles rose too slowly and crossed the pulmonary branches.
      const angle = ((half + u) * Math.PI) / 2;
      const p = add(
        ascendingEnd,
        add(scale(horizontal, halfWidth * (1 - Math.cos(angle))), {
          x: 0,
          y: ARCH_HEIGHT_CM * Math.sin(angle),
          z: 0,
        }),
      );
      const smooth = u * u * (3 - 2 * u);
      const radiusCm =
        half === 0
          ? hp.valves.root.ascR + (ARCH_RADIUS_CM - hp.valves.root.ascR) * smooth
          : ARCH_RADIUS_CM + (descendingRadiusCm - ARCH_RADIUS_CM) * smooth;
      const h = torsoToHeart(heart.frame, p);
      points.push({ p: h, radiusCm });
      restPoints.push(h);
    }
  }
  // Table 7 gives inter-branch distances, but its STJ metric has not been verified as
  // centreline arc length. Centre the three origins on this subject's arch rather than
  // applying that unverified interpretation (which can place the LSA beyond the arch).
  // This is an explicit idealized attachment rule, not measured patient ostia.
  const cumulative = [0];
  for (let i = 1; i < restPoints.length; i++)
    cumulative.push(cumulative[i - 1]! + distance(restPoints[i - 1]!, restPoints[i]!));
  const archStart = cumulative[STEPS_PER_CURVE]!;
  const span = 1.68 + 3.44;
  const first = archStart + (cumulative.at(-1)! - archStart - span) / 2;
  const offsets = [first, first + 1.68, first + span];
  const branchRadii = [1.47 / 2, 0.97 / 2, 1.14 / 2];
  const directions = [
    { x: -0.45, y: 1, z: 0.1 },
    { x: 0, y: 1, z: 0 },
    { x: 0.65, y: 0.8, z: 0 },
  ];
  const branches = offsets.map((offset, index) => {
    let walked = 0;
    let origin: Vec3 | undefined;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!.p,
        b = points[i]!.p,
        len = distance(restPoints[i - 1]!, restPoints[i]!);
      if (walked + len >= offset) {
        origin = add(a, scale(sub(b, a), Math.max(0, (offset - walked) / len)));
        break;
      }
      walked += len;
    }
    if (!origin) throw new Error('Aortic branch spacing exceeds the available rest path');
    const torsoOrigin = heartToTorso(heart.frame, origin);
    const tip = torsoToHeart(
      heart.frame,
      add(torsoOrigin, scale(normalize(directions[index]!), 4)),
    );
    return [
      { p: origin, radiusCm: branchRadii[index]! },
      { p: tip, radiusCm: branchRadii[index]! * 0.85 },
    ];
  });
  return {
    arch: points,
    branches,
    descendingTopTorsoY: end.y,
  };
}
