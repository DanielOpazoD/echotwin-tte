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
/** Course of each vein from its ostium towards the hilum (cm): sideways and backwards. */
export const PV_LEFT_DX = 2.2;
export const PV_LEFT_DY = 0.5;
export const PV_RIGHT_DX = 2.0;
export const PV_RIGHT_DY = 1.0;
/** Rise of the superior veins towards the roof and drop of the inferior ones (cm, heart z). */
export const PV_SUP_DZ = -0.7;
export const PV_INF_DZ = 0.25;
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
  out[3] = ox + sx * (sx > 0 ? PV_LEFT_DX : PV_RIGHT_DX);
  out[4] = oy - (sx > 0 ? PV_LEFT_DY : PV_RIGHT_DY);
  out[5] = oz + (sup ? PV_SUP_DZ : PV_INF_DZ);
}
