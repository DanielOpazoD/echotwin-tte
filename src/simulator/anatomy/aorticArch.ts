import { add, normalize, scale, sub, type Vec3 } from '@/core/vec3';
import type { AnchorsCached } from './anchors';
import { ROOT_STJ_T, rootRadiusAt } from './aorticValve';
import { rootBend } from './classify/root';
import { heartToTorso, torsoToHeart, ROOT_EXCURSION } from './heartFrame';
import type { HeartModel, HeartPose } from './heartModel';
import {
  COLUMN_REFERENCE_CHEST_WALL_CM,
  DESC_AORTA_X,
  DESC_AORTA_Z,
  DESC_AORTA_MAX_OUTER_R,
  neckSkinZ,
  NOTCH_V_CM,
  STERNUM_DEPTH_FRACTION,
  STERNUM_THICKNESS_CM,
} from './thoraxModel';
import { CT_MEDIASTINUM } from '@/clinical/reference-values/ctMediastinum';
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

const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** Cubic Bézier between a and b with control points ca and cb. */
function bezier(a: Vec3, ca: Vec3, cb: Vec3, b: Vec3, u: number): Vec3 {
  const v = 1 - u;
  const k0 = v * v * v,
    k1 = 3 * v * v * u,
    k2 = 3 * v * u * u,
    k3 = u * u * u;
  return {
    x: k0 * a.x + k1 * ca.x + k2 * cb.x + k3 * b.x,
    y: k0 * a.y + k1 * ca.y + k2 * cb.y + k3 * b.y,
    z: k0 * a.z + k1 * ca.z + k2 * cb.z + k3 * b.z,
  };
}

/**
 * Smallest radius of curvature of a cubic Bézier sampled as sampleBezier samples it (STEPS_PER_CURVE + 1 points), without
 * building the points: the same circumcircles as minBendRadius on the sampled polyline, a hundred thousand times per heart
 * while the course is searched.
 */
function bezierBendRadius(a: Vec3, ca: Vec3, cb: Vec3, b: Vec3): number {
  let best = Infinity;
  let px = 0,
    py = 0,
    pz = 0,
    qx = 0,
    qy = 0,
    qz = 0;
  for (let i = 0; i <= STEPS_PER_CURVE; i++) {
    const u = i / STEPS_PER_CURVE,
      v = 1 - u;
    const k0 = v * v * v,
      k1 = 3 * v * v * u,
      k2 = 3 * v * u * u,
      k3 = u * u * u;
    const x = k0 * a.x + k1 * ca.x + k2 * cb.x + k3 * b.x,
      y = k0 * a.y + k1 * ca.y + k2 * cb.y + k3 * b.y,
      z = k0 * a.z + k1 * ca.z + k2 * cb.z + k3 * b.z;
    if (i >= 2) {
      const ax = qx - px,
        ay = qy - py,
        az = qz - pz,
        bx = x - qx,
        by = y - qy,
        bz = z - qz,
        cx = x - px,
        cy = y - py,
        cz = z - pz;
      const nx = ay * bz - az * by,
        ny = az * bx - ax * bz,
        nz = ax * by - ay * bx;
      const area2 = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (area2 >= 1e-12)
        best = Math.min(
          best,
          (Math.sqrt(ax * ax + ay * ay + az * az) *
            Math.sqrt(bx * bx + by * by + bz * bz) *
            Math.sqrt(cx * cx + cy * cy + cz * cz)) /
            (2 * area2),
        );
    }
    px = qx;
    py = qy;
    pz = qz;
    qx = x;
    qy = y;
    qz = z;
  }
  return best;
}

/** Smallest radius of curvature (circumcircle of consecutive samples) of a polyline. */
function minBendRadius(ps: Vec3[]): number {
  let best = Infinity;
  for (let i = 1; i < ps.length - 1; i++) {
    const a = sub(ps[i]!, ps[i - 1]!),
      b = sub(ps[i + 1]!, ps[i]!),
      c = sub(ps[i + 1]!, ps[i - 1]!);
    const cx = a.y * b.z - a.z * b.y,
      cy = a.z * b.x - a.x * b.z,
      cz = a.x * b.y - a.y * b.x;
    const area2 = Math.hypot(cx, cy, cz);
    if (area2 < 1e-12) continue;
    best = Math.min(
      best,
      (Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z) * Math.hypot(c.x, c.y, c.z)) /
        (2 * area2),
    );
  }
  return best;
}

/**
 * The ascending aorta and the arch, placed by chest CT (decision 308). The ascending aorta leaves the sinotubular junction
 * along the root and curves forward and up to the arch onset, which lies behind the sternum; the arch then turns back over
 * an apex the CT's median distance behind the suprasternal notch, nearer the ascending side than the descending one, and
 * comes down into the descending aorta. Until decision 308 the ascending aorta rose 2.6 cm along a tether to a vertical
 * tangent and the arch was half an ellipse to the posterior column: the ascending aorta ran 5.4-7.4 cm behind the sternum
 * (CT 1.5-4.4), tilted 10° backward (CT median 8° forward), the arch was 5.8-6.4 cm wide (CT 7.0-10.6) and its apex
 * 11-14 cm behind the notch (CT 6.1-9.7). The apex keeps the height it had: the model's root sits 6.4 cm below it where
 * the CT's sits 9.4-13.2, and in that room the ascending aorta cannot always reach the CT's median gap from the sternum.
 * It takes the median where the room allows and otherwise the smallest gap, up to the CT's 90th percentile, at which no
 * bend of the course is tighter than its lumen; the course is chosen once per heart, for the root at rest and at its
 * systolic descent, so it does not change from frame to frame.
 */
const STERNUM_GAP = CT_MEDIASTINUM.sternumToAscendingAorta;
const APEX_BEHIND_NOTCH_CM = CT_MEDIASTINUM.archApexBehindNotch.median;
/**
 * Share of the root's rightward course the ascending aorta keeps up to the arch onset. The root alone leans 36° to the
 * right; the CT's root and first 4 cm of ascending aorta lean 22° (11-29°): above the junction the vessel runs nearly
 * straight up. Half of the root's course leaned the model's 32-36°, a fifth 27°.
 */
const ASCENDING_RIGHTWARD_SHARE = 0.1;
/** Shares of the rise from the junction to the apex that the ascending aorta may take before the arch turns back. */
const ONSET_SHARES = [0.55, 0.65, 0.45, 0.75, 0.35];
/** Handle lengths tried for each curve, as fractions of its span. */
const HANDLES = Array.from({ length: 15 }, (_, i) => 0.2 + 0.1 * i);
/** Clearance of the tightest bend over the lumen radius (cm): what the tether used (decision 281). */
const BEND_CLEARANCE_CM = 0.22;

interface CourseDesign {
  onset: Vec3;
  onsetDir: Vec3;
  /** handle factors of the ascending aorta (along the root, into the onset) */
  ka: number;
  kb: number;
  /** the arch from the onset to the apex and from the apex to the descending aorta (torso), fixed to the thorax */
  firstHalf: Vec3[];
  secondHalf: Vec3[];
  gapCm: number;
}
const courseCache = new WeakMap<HeartModel, CourseDesign>();
/**
 * The same course for the same inputs, across heart models: the search is a pure function of the root's place at rest
 * and at its systolic descent, the radii, the column shift and the pulmonary trunk, and a case is built again for every
 * position, breath and test (each build used to repeat a 0.7-3 s search).
 */
const courseMemo = new Map<string, CourseDesign>();

const sampleBezier = (a: Vec3, ca: Vec3, cb: Vec3, b: Vec3): Vec3[] =>
  Array.from({ length: STEPS_PER_CURVE + 1 }, (_, i) => bezier(a, ca, cb, b, i / STEPS_PER_CURVE));

/** The tightest bend of the ascending aorta ascendingCurve would sample, without building it. */
function ascendingBend(
  from: Vec3,
  dir: Vec3,
  onset: Vec3,
  onsetDir: Vec3,
  ka: number,
  kb: number,
): number {
  const span = distance(from, onset);
  return bezierBendRadius(
    from,
    add(from, scale(dir, ka * span)),
    sub(onset, scale(onsetDir, kb * span)),
    onset,
  );
}

/** The ascending aorta from `from` along `dir` into the onset along `onsetDir`, with handles ka and kb of its span. */
function ascendingCurve(
  from: Vec3,
  dir: Vec3,
  onset: Vec3,
  onsetDir: Vec3,
  ka: number,
  kb: number,
): Vec3[] {
  const span = distance(from, onset);
  return sampleBezier(
    from,
    add(from, scale(dir, ka * span)),
    sub(onset, scale(onsetDir, kb * span)),
    onset,
  );
}

/**
 * One half of the arch: the handles that leave its tightest bend widest, or null when every choice folds. Neither half
 * may rise above the apex, which is the arch's highest point (in a deep chest the descending half overshot it by 0.1 cm
 * and moved the highest point 5 cm back).
 */
function archHalf(
  a: Vec3,
  ta: Vec3,
  b: Vec3,
  tb: Vec3,
  la: number,
  lb: number,
  r: number,
): Vec3[] | null {
  let best: { ps: Vec3[]; bend: number } | null = null;
  for (const ka of HANDLES)
    for (const kb of HANDLES) {
      const ca = add(a, scale(ta, ka * la)),
        cb = sub(b, scale(tb, kb * lb));
      const bend = bezierBendRadius(a, ca, cb, b);
      if (bend < r + BEND_CLEARANCE_CM || (best && bend <= best.bend)) continue;
      const ps = sampleBezier(a, ca, cb, b);
      const top = Math.max(a.y, b.y);
      if (ps.some((p) => p.y > top + 1e-6)) continue;
      best = { ps, bend };
    }
  return best?.ps ?? null;
}

function designCourse(
  heart: HeartModel,
  rest: Vec3,
  systolic: Vec3,
  dir: Vec3,
  stjRadius: number,
  ascR: number,
  A: AnchorsCached,
): CourseDesign {
  const cached = courseCache.get(heart);
  if (cached) return cached;
  const r3 = (v: Vec3) => `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`;
  const key = [
    r3(rest),
    r3(systolic),
    r3(dir),
    stjRadius.toFixed(4),
    ascR.toFixed(4),
    heart.columnShiftCm.toFixed(4),
    r3(heartToTorso(heart.frame, A.paStj)),
    r3(heartToTorso(heart.frame, A.paEnd)),
    A.paR.toFixed(4),
    A.rpaR.toFixed(4),
  ].join('|');
  const memo = courseMemo.get(key);
  if (memo) {
    courseCache.set(heart, memo);
    return memo;
  }
  // the arch passes over the pulmonary bifurcation: its trunk, from the sinotubular junction to the bifurcation, keeps
  // clear of the arch by its radius, the arch's and the 0.5 cm the right branch is placed with (vascularPlacement)
  const paA = heartToTorso(heart.frame, A.paStj),
    paB = heartToTorso(heart.frame, A.paEnd);
  const clearOfTrunk = (ps: Vec3[], r: number) => {
    const ab = sub(paB, paA);
    const ll = ab.x * ab.x + ab.y * ab.y + ab.z * ab.z;
    return ps.every((p) => {
      const ap = sub(p, paA);
      const u = Math.max(0, Math.min(1, (ap.x * ab.x + ap.y * ab.y + ap.z * ab.z) / ll));
      return distance(p, add(paA, scale(ab, u))) >= r + Math.max(A.paR, A.rpaR) + 0.5;
    });
  };
  // the apex at the height it had (ascending 2.6 cm along the root and up, then 4.06 cm of arch); where no course fits
  // under it — a dilated ascending aorta, which is also an elongated one — it rises toward the notch, no higher than the
  // CT's 10th percentile of its drop below the notch
  const apexAt =
    rest.y + (dir.y * ASCENDING_LENGTH_CM) / 2 + ASCENDING_LENGTH_CM / 2 + ARCH_HEIGHT_CM;
  const apexMax = Math.max(apexAt, NOTCH_V_CM - CT_MEDIASTINUM.archApexBelowNotch.p10);
  const apexStep = Math.max(0.05, (apexMax - apexAt) / 4);
  // the back of the sternum over the midline: the chest wall is the reference wall less the column shift (decision 273)
  const chestWall = COLUMN_REFERENCE_CHEST_WALL_CM - heart.columnShiftCm;
  const descZ = DESC_AORTA_Z + heart.columnShiftCm;
  const up: Vec3 = { x: 0, y: 1, z: 0 };
  const descR = DESC_AORTA_MAX_OUTER_R;
  // the course for an apex height and a gap from the sternum, or null when every onset height and arrival folds
  const tryAt = (apexY: number, gap: number): CourseDesign | null => {
    for (const share of ONSET_SHARES) {
      const onsetY = rest.y + share * (apexY - rest.y);
      const sternumBackZ =
        neckSkinZ(onsetY) - (STERNUM_DEPTH_FRACTION * chestWall + STERNUM_THICKNESS_CM);
      const onset: Vec3 = {
        x: rest.x + (dir.x / Math.max(0.3, dir.y)) * (onsetY - rest.y) * ASCENDING_RIGHTWARD_SHARE,
        y: onsetY,
        z: sternumBackZ - gap - ascR,
      };
      const apex: Vec3 = {
        x: (onset.x + DESC_AORTA_X) / 2,
        y: apexY,
        z: neckSkinZ(NOTCH_V_CM) - APEX_BEHIND_NOTCH_CM,
      };
      // the arch comes down into the descending aorta where it did, at the old top of the descending aorta, and only as
      // much lower as its turn needs: lowered further, its posterior limb closed the way of the right pulmonary artery
      // under it
      const topY = rest.y + (dir.y * ASCENDING_LENGTH_CM) / 2 + ASCENDING_LENGTH_CM / 2;
      const descSpan = Math.hypot(DESC_AORTA_X - apex.x, descZ - apex.z);
      const back = normalize({ x: DESC_AORTA_X - onset.x, y: 0, z: descZ - onset.z });
      let end: Vec3 = { x: DESC_AORTA_X, y: topY, z: descZ };
      let secondHalf: Vec3[] | null = null;
      for (let drop = 0; drop <= 0.8 * descSpan + 1e-9 && !secondHalf; drop += 0.25) {
        end = { x: DESC_AORTA_X, y: Math.min(topY, apexY - descSpan * 0.4) - drop, z: descZ };
        secondHalf = archHalf(
          apex,
          back,
          end,
          scale(up, -1),
          Math.hypot(end.x - apex.x, end.z - apex.z),
          apex.y - end.y,
          Math.max(ARCH_RADIUS_CM, descR),
        );
      }
      if (!secondHalf) continue;
      // the ascending aorta reaches the onset still running forward: the least forward tilt that does not fold, at rest
      // and with the root at its systolic descent
      for (let deg = 0; deg <= 75; deg += 5) {
        const t = (deg * Math.PI) / 180;
        const onsetDir = normalize({ x: 0, y: Math.cos(t), z: Math.sin(t) });
        // an arrival the ascending aorta cannot make on its own (its bends alone, before the joint) is skipped before the
        // arch's first half is searched for it
        const ascendingAlone = HANDLES.some((ka) =>
          HANDLES.some((kb) =>
            [rest, systolic].every(
              (from) =>
                ascendingBend(from, dir, onset, onsetDir, ka, kb) >=
                Math.max(stjRadius, ascR) + BEND_CLEARANCE_CM,
            ),
          ),
        );
        if (!ascendingAlone) continue;
        const firstHalf = archHalf(
          onset,
          onsetDir,
          apex,
          back,
          apexY - onset.y,
          Math.hypot(apex.x - onset.x, apex.z - onset.z),
          Math.max(ascR, ARCH_RADIUS_CM),
        );
        if (!firstHalf) continue;
        if (!clearOfTrunk(firstHalf, ARCH_RADIUS_CM) || !clearOfTrunk(secondHalf, ARCH_RADIUS_CM))
          continue;
        // the ascending handles: no bend tighter than the lumen along the ascending aorta, nor across its joint with the
        // arch (each curve can be smooth on its own and still turn sharply where they meet), at rest and at the root's
        // systolic descent; and none across the arch's apex either
        const joint = (ps: Vec3[]) => minBendRadius([...ps.slice(-3), ...firstHalf.slice(1, 3)]);
        const need = Math.max(stjRadius, ascR, ARCH_RADIUS_CM) + BEND_CLEARANCE_CM;
        if (minBendRadius([...firstHalf.slice(-3), ...secondHalf.slice(1, 3)]) < need) continue;
        let handles: [number, number] | null = null;
        for (const ka of HANDLES) {
          for (const kb of HANDLES) {
            const fits = [rest, systolic].every((from) => {
              const ps = ascendingCurve(from, dir, onset, onsetDir, ka, kb);
              return (
                minBendRadius(ps) >= Math.max(stjRadius, ascR) + BEND_CLEARANCE_CM &&
                joint(ps) >= need
              );
            });
            if (fits) {
              handles = [ka, kb];
              break;
            }
          }
          if (handles) break;
        }
        if (!handles) continue;
        const design = {
          onset,
          onsetDir,
          ka: handles[0],
          kb: handles[1],
          firstHalf,
          secondHalf,
          gapCm: gap,
        };

        return design;
      }
    }
    return null;
  };
  // the smallest gap that fits: feasibility only grows with the gap, so 0.4 cm strides, then 0.1 cm within the last one
  for (let apexY = apexAt; apexY <= apexMax + 1e-9; apexY += apexStep) {
    let fit: CourseDesign | null = null,
      lo = STERNUM_GAP.median - 0.1;
    for (let gap = STERNUM_GAP.median; gap <= STERNUM_GAP.p90 + 0.4 - 1e-9 && !fit; gap += 0.4) {
      fit = tryAt(apexY, Math.min(gap, STERNUM_GAP.p90));
      if (!fit) lo = gap;
    }
    if (!fit) continue;
    for (let gap = lo + 0.1; gap < fit.gapCm - 1e-9; gap += 0.1) {
      const finer = tryAt(apexY, gap);
      if (finer) {
        fit = finer;
        break;
      }
    }
    courseCache.set(heart, fit);
    courseMemo.set(key, fit);
    return fit;
  }
  throw new Error('No course of the ascending aorta and arch that does not fold');
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
  // the arch is fixed to the thorax; the systolic descent of the root deforms only the ascending aorta
  const restH = {
    ...rootAt(JOIN_T),
    x: rootAt(JOIN_T).x - hp.swingX,
    z: rootAt(JOIN_T).z - ROOT_EXCURSION * hp.zAnn,
  };
  const restStart = heartToTorso(heart.frame, restH);
  const systolicStart = heartToTorso(heart.frame, {
    ...restH,
    z: restH.z + ROOT_EXCURSION * heart.physiology.mapseCm,
  });
  const stjRadius = rootRadiusAt(hp.valves.root, ROOT_STJ_T, 0);
  const ascR = hp.valves.root.ascR;
  const course = designCourse(heart, restStart, systolicStart, startDirection, stjRadius, ascR, A);
  const moving = ascendingCurve(
    start,
    startDirection,
    course.onset,
    course.onsetDir,
    course.ka,
    course.kb,
  );
  const rest = ascendingCurve(
    restStart,
    startDirection,
    course.onset,
    course.onsetDir,
    course.ka,
    course.kb,
  );
  const points: AorticPathPoint[] = [];
  const restPoints: Vec3[] = [];
  moving.forEach((p, i) => {
    const u = i / STEPS_PER_CURVE,
      smooth = u * u * (3 - 2 * u);
    points.push({
      p: torsoToHeart(heart.frame, p),
      radiusCm: stjRadius + (ascR - stjRadius) * smooth,
    });
    restPoints.push(torsoToHeart(heart.frame, rest[i]!));
  });
  for (const [half, curve] of [course.firstHalf, course.secondHalf].entries())
    for (let i = 1; i <= STEPS_PER_CURVE; i++) {
      const u = i / STEPS_PER_CURVE,
        smooth = u * u * (3 - 2 * u);
      const radiusCm =
        half === 0
          ? ascR + (ARCH_RADIUS_CM - ascR) * smooth
          : ARCH_RADIUS_CM + (descendingRadiusCm - ARCH_RADIUS_CM) * smooth;
      const h = torsoToHeart(heart.frame, curve[i]!);
      points.push({ p: h, radiusCm });
      restPoints.push(h);
    }
  const end = heartToTorso(heart.frame, points[points.length - 1]!.p);
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
