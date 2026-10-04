import type { HeartModel } from './heartModel';
import type { ChamberPose } from './heartPose';
import type { AnchorsCached } from './anchors';
import { buildAorticArch } from './aorticArch';
import { heartToTorso, torsoToHeart } from './heartFrame';
import { sdCapsule } from './sdf';
import { svcDistance } from './classify/atria';

/** Place the neighbours jointly, before acquiring any pose. The right pulmonary artery passes
 * behind the ascending aorta; the cava remains on its right. Fixed inferior caval and pulmonary
 * trunk attachments preserve their connections. The clearance is numerical, not a normal range.
 */
export function placeVascularNeighbours(
  m: HeartModel,
  A: AnchorsCached,
  poses: ChamberPose[],
): void {
  const courses = poses.map((hp) => ({ hp, points: buildAorticArch(m, hp, 1, A).arch }));
  const cava = heartToTorso(m.frame, A.svcB),
    rightPa = heartToTorso(m.frame, A.rpaEnd);
  const clearance = (kind: 'cava' | 'pulmonary', offset: number, angle = 0) => {
    if (kind === 'cava') A.svcB = torsoToHeart(m.frame, { ...cava, x: cava.x - offset });
    else
      A.rpaEnd = torsoToHeart(m.frame, {
        ...rightPa,
        y: rightPa.y - offset * Math.sin(angle),
        z: rightPa.z - offset * Math.cos(angle),
      });
    let least = Infinity;
    for (const { hp, points } of courses)
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1]!,
          b = points[i]!;
        for (const u of [0, 0.25, 0.5, 0.75, 1]) {
          const x = a.p.x + (b.p.x - a.p.x) * u - hp.swingX,
            y = a.p.y + (b.p.y - a.p.y) * u,
            z = a.p.z + (b.p.z - a.p.z) * u;
          const r = a.radiusCm + (b.radiusCm - a.radiusCm) * u;
          const distance =
            kind === 'cava'
              ? svcDistance(A, x, y, z) - 0.12
              : sdCapsule(
                  x,
                  y,
                  z,
                  A.paEnd.x,
                  A.paEnd.y,
                  A.paEnd.z,
                  A.rpaEnd.x,
                  A.rpaEnd.y,
                  A.rpaEnd.z,
                  A.rpaR,
                ) - 0.18;
          least = Math.min(least, distance - r - 0.2 - 0.1);
        }
      }
    return least;
  };
  for (const kind of ['cava', 'pulmonary'] as const) {
    if (clearance(kind, 0) >= 0) continue;
    let best = Infinity,
      bestAngle = 0;
    // The RPA crosses behind the ascending limb and under the arch. Search that
    // posterior/caudal quadrant, without moving the pulmonary bifurcation itself.
    // 6 cm bounds the free endpoint search; it is not a clinical reference dimension.
    // Across the 216 supported case/posture/breathing combinations the largest move is 4.27 cm.
    for (let angle = 0; angle <= (kind === 'cava' ? 0 : Math.PI / 2); angle += Math.PI / 12) {
      let lo = 0;
      for (let length = 0.1; length <= Math.min(6, best + 0.1); length += 0.1) {
        if (clearance(kind, length, angle) >= 0) {
          let hi = length;
          for (let i = 0; i < 18; i++) {
            const mid = (lo + hi) / 2;
            if (clearance(kind, mid, angle) < 0) lo = mid;
            else hi = mid;
          }
          if (hi < best) {
            best = hi;
            bestAngle = angle;
          }
          break;
        }
        lo = length;
      }
    }
    if (!Number.isFinite(best)) throw new Error(`Cannot place ${kind} beside the thoracic aorta`);
    clearance(kind, best, bestAngle);
  }
}
