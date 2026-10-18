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
/**
 * Height of the two pairs on the atrium (fraction of its half length; negative towards the roof). The inferior pair
 * rose from 0.35 to 0.25 in decision 330: with the atrium's posterior wall on the column the volume fit draws the body
 * shorter, and at 0.35 the left inferior vein's lumen lay 3-6 mm above the posterolateral mitral hinge at end-diastole
 * in four cases, crossing the base's column of `leftAtrialBase.test.ts`. No published distance from the inferior
 * ostia to the mitral annulus was found; the fraction is declared as an assumption.
 */
export const PV_SUP_Z = -0.55;
export const PV_INF_Z = 0.25;
/**
 * Course of each vein from its ostium to its distal end (cm, heart frame: x lateral, y anterior, z towards the apex), in
 * the order of `pulmonaryVeinSegment`: right superior, left superior, right inferior, left inferior. The right veins run
 * medially and backwards, the superior one towards the roof; the left inferior one laterally and a little backwards.
 * The left superior vein runs to the hilum laterally, slightly upwards and slightly forwards in the chest (torso
 * (2.3, 0.4, 0.5) cm in the normal case), passing in front of the descending aorta (decision 213). It used to share the
 * course of the inferior one with a rise towards the roof, and in the chest that went 2.0 cm backwards to the depth of
 * the front of the vertebral body, through the place of the aorta: the heart frame's lateral and basal directions both
 * point backwards in the torso.
 * The right veins follow the four-chamber atlas (decision 322): the direction of each vessel where it was cut, the normal
 * of its border ring, averaged over twenty healthy hearts in the frame of the mitral centre, the LV apex and the tricuspid
 * centre (Rodero et al., PLoS Comput Biol 2021). The right superior vein ran 58° and the right inferior 61° from it,
 * beyond every atlas heart (spread at the 90th percentile 25° and 30°): the superior went backwards instead of forwards
 * behind the superior vena cava, the inferior level instead of towards the base. The left ones are within the atlas
 * (33° and 23°, at its 85th and 45th percentiles). Lengths unchanged.
 */
export const PV_COURSE: readonly number[] = [
  -1.49, 1.09, -1.45, 1.63, 0.81, 0.35, -1.0, -0.92, -1.8, 2.2, -0.5, 0.25,
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
  wall?: { nx: number; ny: number; nz: number; d: number },
): void {
  const sx = i % 2 === 0 ? -1 : 1;
  const sup = i < 2;
  const dzN = sup ? PV_SUP_Z : PV_INF_Z;
  const kz = Math.sqrt(1 - dzN * dzN); // radius of the atrial section at that height
  const t = sx > 0 ? (sup ? PV_LEFT_SUP_T : PV_LEFT_INF_T) : PV_RIGHT_T;
  const a = lr.x * bo * kz,
    b = lr.y * bo * kz;
  const oz = czL + dzN * rzL;
  let tt = t;
  if (wall && sx > 0) {
    // the left veins enter the posterior wall, which stands on the column (decision 330): an ostium the wall plane
    // would leave behind it turns forward along the atrial section, to PV_OSTIUM_AHEAD_CM in front of the plane
    // (decision 337; slid straight forward, it left the atrial surface and its mouth closed in the dilated atria)
    const C = wall.d - PV_OSTIUM_AHEAD_CM - wall.nx * la.x - wall.ny * la.y - wall.nz * oz;
    const P = wall.nx * a,
      Q = -wall.ny * b;
    if (P * Math.cos(t) + Q * Math.sin(t) > C) {
      const R = Math.hypot(P, Q);
      if (R > Math.abs(C)) tt = Math.atan2(Q, P) - Math.acos(C / R);
    }
  }
  const ox = la.x + sx * a * Math.cos(tt);
  const oy = la.y - b * Math.sin(tt);
  out[0] = ox;
  out[1] = oy;
  out[2] = oz;
  out[3] = ox + PV_COURSE[3 * i]!;
  out[4] = oy + PV_COURSE[3 * i + 1]!;
  out[5] = oz + PV_COURSE[3 * i + 2]!;
}
/**
 * How far (cm) in front of the posterior wall plane a left pulmonary vein's ostium lies at least (decision 330): the
 * vein's lumen radius, so the mouth opens in the cavity where the body is clipped against the column; moved farther
 * forward, the left inferior vein lay on the posterolateral hinge. The ostium reaches it by turning along the atrial
 * section (decision 337), not by sliding forward off the surface.
 */
export const PV_OSTIUM_AHEAD_CM = PV_RADIUS;
