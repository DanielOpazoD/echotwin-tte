/**
 * Pulmonary veins (decision 143): two on each side of the left atrium, running towards the hila — laterally and a
 * little posteriorly, the superior pair also towards the roof — and not backwards. The left ostia sit on the lateral
 * wall behind the appendage (superior) and just posterior of it (inferior), the right ones at the posteromedial corner
 * behind the septum; the ostia ride on the atrial surface as it breathes. Veins that left the flat posterior wall
 * straight backwards lay in every long-axis plane (PLAX, A2C, A3C) and in none of the four-chamber ones, the
 * opposite of an examination. The classifier (`classify/atria.ts`), its GLSL mirror (`glslHeart.ts`) and the venous
 * flow sampler (`flowField.ts`) share this geometry.
 */

/** Angle of each ostium on the atrial section, from the lateral (left) or medial (right) axis towards the posterior wall (rad). */
export const PV_LEFT_SUP_T = 0.0;
export const PV_LEFT_INF_T = 0.2;
export const PV_RIGHT_T = 0.5;
/** Height of the two pairs on the atrium (fraction of its half length; negative towards the roof). */
export const PV_SUP_Z = -0.55;
export const PV_INF_Z = 0.35;
/**
 * Course of each vein from its ostium to its distal end (cm, heart frame: x lateral, y anterior, z towards the apex), in
 * the order of `pulmonaryVeinSegment`: right superior, left superior, right inferior, left inferior. The right veins run
 * medially and backwards, the superior one towards the roof; the left inferior one laterally and a little backwards.
 * The left superior vein runs to the hilum laterally, slightly upwards and slightly forwards in the chest (torso
 * (2.3, 0.4, 0.5) cm in the normal case), passing in front of the descending aorta (decision 213). It used to share the
 * course of the inferior one with a rise towards the roof, and in the chest that went 2.0 cm backwards to the depth of
 * the front of the vertebral body, through the place of the aorta: the heart frame's lateral and basal directions both
 * point backwards in the torso.
 */
export const PV_COURSE: readonly number[] = [
  -2.0, -1.0, -0.7, 1.63, 0.81, 1.55, -2.0, -1.0, 0.25, 2.2, -0.5, 0.25,
];
/** Farthest a vein reaches from its ostium (cm): the flow sampler's quick reject. */
export const PV_REACH = Math.max(
  ...[0, 1, 2, 3].map((i) =>
    Math.hypot(PV_COURSE[3 * i]!, PV_COURSE[3 * i + 1]!, PV_COURSE[3 * i + 2]!),
  ),
);
/** Lumen radius (cm); the wall adds 0.12 in the classifier. */
export const PV_RADIUS = 0.45;

/**
 * Ostium (o) and distal end (e) of vein `i` (0 right superior, 1 left superior, 2 right inferior, 3 left inferior),
 * written into `out` as [ox, oy, oz, ex, ey, ez] — no allocation, the classifier calls this per sample.
 * `bo` is the atrial radial scale of the moment, `czL`/`rzL` the centre and half length of the atrium along z.
 */
export function pulmonaryVeinSegment(
  i: number,
  la: { x: number; y: number; z: number },
  lr: { x: number; y: number; z: number },
  bo: number,
  czL: number,
  rzL: number,
  out: Float64Array,
): void {
  const sx = i % 2 === 0 ? -1 : 1;
  const sup = i < 2;
  const dzN = sup ? PV_SUP_Z : PV_INF_Z;
  const kz = Math.sqrt(1 - dzN * dzN); // radius of the atrial section at that height
  const t = sx > 0 ? (sup ? PV_LEFT_SUP_T : PV_LEFT_INF_T) : PV_RIGHT_T;
  const ox = la.x + sx * lr.x * bo * kz * Math.cos(t);
  const oy = la.y - lr.y * bo * kz * Math.sin(t);
  const oz = czL + dzN * rzL;
  out[0] = ox;
  out[1] = oy;
  out[2] = oz;
  out[3] = ox + PV_COURSE[3 * i]!;
  out[4] = oy + PV_COURSE[3 * i + 1]!;
  out[5] = oz + PV_COURSE[3 * i + 2]!;
}
