import { sdEllipsoid, smax } from './sdf';

export const LA_POSTERIOR_RATIO = 0.72;

/** Thickness (cm) of the muscular interatrial septum; the limbus and the fossa modulate it, shared with GLSL. */
export const IAS_MUSCULAR_CM = 0.55;
export function iasThickness(fo: number): number {
  return fo < 1 ? 0.12 : fo < 1.3 ? 0.7 : 0.55;
}
/**
 * The left face of the septum, cm to the left of the septal plane (decision 327): fixed, wherever the septum thins or
 * thickens. The slab was centred on the plane, so on the left the fossa's membrane sat 2.2 mm deeper than the muscular
 * septum and the limbus 0.8 mm prouder, and the left atrial blood stepped 3.4 mm toward the right atrium over the fossa in
 * the four-chamber view. Seen from the left atrium the septum is flat; the fossa ovalis is a depression of the right atrial
 * side, with its limbus around it.
 */
export const IAS_LEFT_FACE_CM = IAS_MUSCULAR_CM / 2;
/**
 * Where the left atrium's body comes within LA_SEPTAL_FLAT_CM of the septal plane its medial wall is the septum, and
 * over the next LA_SEPTAL_TAPER_CM the wall eases back to the body's own shape (decision 327). The ellipsoid met the plane
 * only around its equator, so over the rest of the septal area its own wall, fat and a thicker septum stacked between the
 * atria: 7-11 mm from blood to blood, 2-3.4 cm below the annulus, and a 4.5 mm step of the atrium's septal border where
 * the wall began. Beyond the taper the interatrial groove, with its fat, is anatomy. Published value: none found for the
 * extent of the flat septal face; the two lengths are declared as an assumption.
 */
export const LA_SEPTAL_FLAT_CM = 0.7;
export const LA_SEPTAL_TAPER_CM = 0.5;
/**
 * In the septal corner above the annulus (decision 318) the gap closed is wider, LA_CORNER_FLAT_CM: the ellipsoid tapers
 * toward the annulus and lies 1.2-1.35 cm from the plane where the four-chamber view cuts the crux. The corner used to be
 * a prism of the atrium's whole central section, which reached the plane also in front of the atrium, behind the aortic
 * root, where the right atrium meets the outflow tract across the membranous septum (decision 222); bounded by the
 * ellipsoid's own chord it stops short of the root.
 */
export const LA_CORNER_FLAT_CM = 1.5;
/**
 * In front, the septal corner ends this (cm) past the straight anterior edge of the mitral annulus, the aortomitral
 * curtain, measured along the valve's own anterior axis (decision 327): the atrium's base sits on the annulus and its
 * anterior wall there is the curtain, behind the aortic root, where the right atrium reaches the outflow tract across the
 * membranous septum (decision 222). A corner that ran on to the atrium's whole section reached in front of the curtain
 * and met that right atrium. The edge runs 22° obliquely to the heart's y, and the four-chamber plane cuts the septal
 * corner 2.9-3.5 mm in front of it: bounded along y at 0.1 cm the corner kept that cut but reached 8-11 mm in front of
 * the edge beside the septum, over the membranous septum and the central fibrous body, and stood 3-5 mm proud of the
 * atrium's anterior wall (a tooth a basal short axis would show); the curtain's own filler, drawn in front of the edge,
 * met the four-chamber cut as a bright tooth under the septal hinge. Bounded along the edge's normal, read at the septal
 * face, 0.5 cm keeps the four-chamber corner and stops the reach; in front of it, basal of the hinge, the curtain is drawn.
 */
export const LA_CORNER_ANTERIOR_MARGIN_CM = 0.5;
/**
 * Where a fill leaves the atrium within this (cm) of the septal plane the septum is drawn and the right atrium meets its
 * face (decision 327); farther, over the taper, the groove with its fat is anatomy. The bare ellipsoid keeps the 0.45 cm
 * of decision 222 for the same decision; the fills touch the plane exactly, so a tolerance that wide drew septum in front
 * of the atrium, between the outflow tract and the right atrium at the membranous septum.
 */
export const LA_TOUCH_CM = 0.3;
/**
 * Least tissue (cm) between the right atrial blood and the left atrial blood anywhere (decision 327): where the septum
 * stands the right atrium stops at its face; in front of the left atrium, where the right atrium passes the plane toward
 * the membranous septum (decision 222), it keeps this much, the thin anterosuperior septum behind the aortic root. The
 * release of decision 222 reads the bare ellipsoid, and where a fill brought the left atrium to the plane it let the right
 * atrium through the slab: blood against blood over 0.1-0.34 cm² in five cases and a septum thinned to 0.5-2 mm over
 * 0.4-1.6 cm² in all. Published: the septum is 2-6 mm thick by TEE and thinnest, 1-2 mm, at the fossa; the thickness of
 * its anterosuperior part behind the root was not found, so 0.3 cm is declared as an assumption.
 */
export const RA_LA_MIN_CM = 0.3;
/**
 * Height (cm) above the annulus of the base the atrium keeps down to the hinge (decision 318): in the septal corner it
 * reaches the septum there wherever its own section does at its centre, and all around (decision 328) its wall flares
 * from the annulus up to that section.
 */
export const LA_CORNER_HEIGHT_CM = 1.2;
/**
 * The atrium's base sits on the whole annulus (decision 328): from the hinge up its wall flares LA_BASE_FLARE cm per cm
 * of height until, LA_CORNER_HEIGHT_CM above the hinge, the body's own section takes over. The ellipsoid tapered to a tip
 * above the annulus: inside the ring the orifice column drew the atrium, but 3 mm outside the ring (normal case, 24
 * azimuths) the blood lay more than 2.5 cm above the hinge behind 6-19 mm of fat, and under the anterior hinge of the
 * two-chamber view 10 mm of fat and fibrous filler stood where the atrium is. The atrial walls rise from the annulus
 * (the atrial volume is traced to the annular plane, ASE 2015); no published value for the flare was found, so 0.5
 * (27°, 0.6 cm of widening over the corner's height) is declared as an assumption.
 */
export const LA_BASE_FLARE = 0.5;
/**
 * How far (cm) the flare may stand beyond the body's widest section: the ellipsoid's anterior reach at the lateral end of
 * the straight edge, where the two-chamber view cuts the anterior hinge, is the hinge itself, so bounded by the section
 * exactly the flare left 12 mm of atrial wall along the beam there (a bound tangent to the beam stretches the wall band).
 * The blend with the body rounds the step. Declared as an assumption, like the flare.
 */
export const LA_BASE_SECTION_SLACK_CM = 0.3;
/**
 * Over the lateral arc of the annulus the base is a shelf over the atrioventricular groove (decision 366): nothing up to
 * LA_BASE_SHELF_RISE_CM above the hinge, LA_BASE_SHELF_CM beyond the annulus outline from LA_BASE_SHELF_FULL_CM up, where
 * the lateral wall (`laLateralWallSdf`) rises from it. In the mean CT heart (Rodero et al. 2021) the cavity's lateral edge
 * on the four-chamber plane lies inside the ring 2–4 mm above the hinge and 8–12 mm beyond it at 6–8 mm: the atrial floor
 * reaches out over the top of the ventricular wall. The flare of decision 328 widened 27° from the hinge up to 12 mm and
 * stepped 9–18 mm back to a body 6–13 mm medial of the lateral hinge: a wedge pointing laterally in the four-chamber view.
 * The reach (the lateral wall's stand) is declared as an assumption.
 */
export const LA_BASE_SHELF_CM = 0.5;
export const LA_BASE_SHELF_RISE_CM = 0.3;
export const LA_BASE_SHELF_FULL_CM = 0.6;
/** How far (cm) beyond the annulus outline the shelf reaches `dz` cm above the hinge. Shared with GLSL. */
export function laBaseShelf(dz: number): number {
  return (
    LA_BASE_SHELF_CM *
    Math.min(
      1,
      Math.max(0, (dz - LA_BASE_SHELF_RISE_CM) / (LA_BASE_SHELF_FULL_CM - LA_BASE_SHELF_RISE_CM)),
    )
  );
}
/**
 * How much of the shelf a point of the base takes (0–1), from its direction (dx, dy) from the mitral centre in the hinge
 * plane: all of it within LA_SHELF_COS_FULL of the lateral direction, none beyond LA_SHELF_COS_FROM, the flare of
 * decision 328 elsewhere (around the septal corner and the curtain the base keeps its own rules). Shared with GLSL.
 */
export function laBaseLateralShare(dx: number, dy: number): number {
  const c = dx / Math.max(1e-6, Math.sqrt(dx * dx + dy * dy));
  const t = Math.min(
    1,
    Math.max(0, (c - LA_SHELF_COS_FROM) / (LA_SHELF_COS_FULL - LA_SHELF_COS_FROM)),
  );
  return t * t * (3 - 2 * t);
}
export const LA_SHELF_COS_FULL = 0.85;
export const LA_SHELF_COS_FROM = 0.5;
/**
 * The lateral wall of the left atrium (decision 366): it stands LA_LATERAL_HINGE_CM beyond the lateral mitral hinge, over
 * the lateral arc of the annulus (LA_LATERAL_WALL_HALF_AP_CM in front of and behind the hinge's depth), from the shelf up
 * to the body's equator (LA_LATERAL_WALL_HOLD, a fraction of its half length above the centre), and eases back into the
 * body by LA_LATERAL_WALL_TOP, where in the CT heart the wall curves medially toward the roof (26–30 mm above the hinge).
 * Held to a height above the hinge instead, it reached the narrow roof at end-diastole, when the annulus stands high, and
 * the atrial emptying fraction fell 4–7 points. Its corners in front and behind round with LA_LATERAL_WALL_ROUND_CM. The body,
 * sized to its volume and centred on the septum, stands 6–13 mm medial of the lateral hinge; widening its whole lateral
 * half to the hinge cost the volume fit 12–35 % of the body (a shorter atrium and fat between the atria under its roof).
 */
export const LA_LATERAL_HINGE_CM = 0.5;
export const LA_LATERAL_WALL_HALF_AP_CM = 0.8;
/** The band's centre lies this far (cm) in front of the lateral hinge's depth, where the four-chamber plane crosses the ring. */
export const LA_LATERAL_WALL_AHEAD_CM = 0.2;
export const LA_LATERAL_WALL_HOLD = 0;
export const LA_LATERAL_WALL_TOP = 0.9;
export const LA_LATERAL_WALL_ROUND_CM = 0.5;
/**
 * The blend of the lateral wall's fill with the body and its prism (cm), from nothing at the shelf's rise to whole
 * LA_LATERAL_WALL_BLEND_CM higher: blended down to the floor, the union bulged the dilated atria 1–2.5 mm over the hinge
 * under the shelf (HFrEF at mid-systole: 7.3 mm beyond the hinge 2 mm above it, 4.8 without the wall). Shared with GLSL.
 */
export const LA_LATERAL_WALL_BLEND_CM = 0.4;
export function laLateralWallBlend(h: number): number {
  // (never quite nothing: smin divides by its blend)
  return Math.max(
    LA_LATERAL_WALL_BLEND_MIN_CM,
    LA_LATERAL_WALL_BLEND_CM *
      Math.min(1, Math.max(0, (h - LA_BASE_SHELF_RISE_CM) / LA_LATERAL_WALL_BLEND_CM)),
  );
}
export const LA_LATERAL_WALL_BLEND_MIN_CM = 0.0001;
/**
 * Signed distance to the lateral wall's fill at (x, y), `h` cm above the hinge at this azimuth and `w` (a fraction of the
 * body's half length) above its centre: `xLat` is the wall's stand, `yArc` the depth of the lateral hinge, `laX` the body's
 * centre. Shared with GLSL.
 */
export function laLateralWallSdf(
  x: number,
  y: number,
  h: number,
  w: number,
  laX: number,
  xLat: number,
  yArc: number,
): number {
  const t = Math.min(
    1,
    Math.max(0, (w - LA_LATERAL_WALL_HOLD) / (LA_LATERAL_WALL_TOP - LA_LATERAL_WALL_HOLD)),
  );
  const xWall = xLat + (laX - xLat) * t * t * (3 - 2 * t);
  // the lateral face and the front and back faces, their corners rounded
  const r = LA_LATERAL_WALL_ROUND_CM;
  const qx = x - xWall + r,
    qy = Math.abs(y - yArc) - LA_LATERAL_WALL_HALF_AP_CM + r;
  const dXY =
    Math.sqrt(Math.max(qx, 0) * Math.max(qx, 0) + Math.max(qy, 0) * Math.max(qy, 0)) +
    Math.min(Math.max(qx, qy), 0) -
    r;
  return Math.max(dXY, LA_BASE_SHELF_RISE_CM - h, laX - x);
}
/**
 * The base's signed distance: the septal corner (the medial half of the section at zRef, decisions 318 and 327) united
 * with the flared annulus outline (`outlineSdf` is the D-shaped outline's distance in the hinge plane), a shelf over the
 * lateral arc (`lateralShare`, decision 366). Both lie between
 * the hinge and zRef, behind the curtain (read at the face) and clear of the septal face by the corner's offset; the
 * corner is bounded by the body's section at zRef, the flare by its widest section (`dCrossEq`, at the equator): at zRef
 * the body's rounded posterior edge sits 2-3 mm inside its clip plane, and bounded by that section the flare left
 * 14 mm of atrial wall over the posterior annulus. Shared with GLSL.
 */
export function laBaseSdf(
  x: number,
  laX: number,
  xFace: number,
  cornerOff: number,
  z: number,
  zRef: number,
  zHinge: number,
  dCrossRef: number,
  dCrossEq: number,
  rootClearBase: number,
  outlineSdf: number,
  lateralShare: number,
): number {
  const dz = zHinge - z;
  const shared = Math.max(xFace + cornerOff - x, zRef - z, -dz, rootClearBase);
  // the flare's lateral bound: the widest section with its slack at the hinge, the section at zRef where the body takes
  // over, so no shoulder stands between them
  const t = Math.min(1, Math.max(0, dz / (zHinge - zRef)));
  const bound = (dCrossEq - LA_BASE_SECTION_SLACK_CM) * (1 - t) + dCrossRef * t;
  // over the lateral arc the base is a shelf over the groove that the lateral wall rises from (decision 366)
  const flare = Math.max(LA_BASE_FLARE * dz, laBaseShelf(dz) * lateralShare);
  return Math.min(
    Math.max(shared, dCrossRef, x - laX),
    Math.max(shared, bound, outlineSdf - flare),
  );
}
/**
 * The curtain bound of the base is read this far (cm) medial of the point, and never medial of the septal face: at the
 * face it is the corner's bound of decision 327 (the slab is drawn from it), and away from the face it follows the
 * oblique edge within 0.26 cm (the edge runs 22° to y), where read at the face it stood 1 cm behind the edge at the
 * anterior hinge of the two-chamber view and kept the base from it.
 */
export const LA_BASE_BOUND_READ_CM = 0.7;
/**
 * How far (cm) the atrium's medial face stands off the septal plane where its body's medial chord is `gap` from it: none
 * up to `flat`, the whole gap beyond `flat` + LA_SEPTAL_TAPER_CM.
 */
export function laMedialFaceOffset(gap: number, flatCm: number): number {
  // (`flat` is a reserved word in GLSL, where this function is mirrored)
  const t = Math.min(1, Math.max(0, (gap - flatCm) / LA_SEPTAL_TAPER_CM));
  return gap * t * t * (3 - 2 * t);
}

/**
 * The posterior wall of the left atrium rests on the descending aorta (decision 330). The wall is a plane fixed in the
 * thorax: vertical, perpendicular to the sagittal plane, tangent to the aorta at its systolic maximum plus the
 * pericardium and the atrial wall (`laPostN`, `laPostD` in the anchors). Behind its centre the body is the prism of its
 * own section (the silhouette along the wall's normal) up to that plane, so the wall is flat across the atrium's whole
 * width and down to the floor behind the annulus, and it does not move with the beat or the annulus: the ellipsoid
 * curved away from the aorta toward the atrioventricular groove (in the long axis of the normal case 4-16 mm of
 * mediastinal fat lay between the atrial wall and the aorta, and the wall moved 4-5 mm back from end-diastole to
 * end-systole), while on M-mode the posterior atrial wall is almost immobile and on CT the descending aorta lies
 * against the atrium or its left veins (50 of 65, Cury et al., Heart Rhythm 2005;2:1317). The dilated atria crossed the
 * plane into the aorta (up to 2 mL and 7 mm deep); clipped by it they are flat against the column, and the volume fit
 * gives them their size across, in height and in front. Their centre does not move: in this heart frame the torso's
 * anterior is medial, toward the root and toward the annulus at once, and drawing a dilated atrium forward by what the
 * column takes behind it (1.8 cm in the heart failure case) ran it 1 cm into the septal plane and the aortic root.
 */
/**
 * The posterior prism's floor lies this (cm) under the body's inferoposterior clip (decision 330): the posterior wall
 * runs down to the top of the coronary sinus (the atrial wall and the sinus's, CS_GROOVE_OFFSET_CM less its radius),
 * where the long axis shows the descending aorta behind the groove. The prism keeps the body's full section whatever
 * the radial scale of the moment, so the posterior wall and its footprint do not move with the beat, as on M-mode; the
 * reservoir's radial scale moves the anterior wall, the roof and the sides.
 */
export const LA_POSTERIOR_FLOOR_DROP_CM = 0.35;
/**
 * Radial fraction of the atrial body at end-diastole (decision 330; 0.84 before it, decision 149). With the posterior
 * wall and its footprint fixed in the thorax, the same radial scale emptied the atrium less: the normal case's emptying
 * fraction fell from 39 % to 34 % against 35-65, and every case lost 3-5 points. The scale now moves the anterior wall,
 * the roof and the sides of the body and the footprint's edges by half, with the posterior wall, the groove and the
 * base on the annulus fixed, so it is set deeper, 0.70 (the AP span of the normal atrium then changes 0.9 cm over the
 * beat, as the aortic root's 1 cm on M-mode), which gives the normal case 36 %; a dilated atrium still empties less (up
 * to +0.1 at 120 mL). The published total emptying fraction of a normal atrium is higher than the model's (the
 * guideline range's upper half), so this is not a limit; what the model lacks is a broad floor for the annular piston.
 */
export const LA_RESERVOIR_MIN = 0.7;
/**
 * Beside the aortic root the left atrium keeps its end-systolic size through the beat (decision 341): its anterior wall
 * lies on the root's posterior wall, and in M-mode the two move together. Scaled whole with the reservoir and the kick,
 * the atrium's front left the root by 10 mm at end-diastole in the normal case's long axis (2.4 at end-systole), and fat,
 * the pericardium and lung filled the space. Within LA_ROOT_HOLD_NEAR_CM of the root's outer wall the body keeps its full
 * radial size, easing back to the scale of the moment by LA_ROOT_HOLD_FAR_CM; between the annulus and the sinotubular
 * junction (root coordinate t), faded in over its first LA_ROOT_HOLD_T_FADE_CM and out over its last.
 */
export const LA_ROOT_HOLD_NEAR_CM = 0.3;
export const LA_ROOT_HOLD_FAR_CM = 0.8;
export const LA_ROOT_HOLD_T_MAX_CM = 2.0;
export const LA_ROOT_HOLD_T_FADE_CM = 0.4;
/**
 * The hold starts this far lateral of the septum's left face and is whole twice as far: at the septal edge of the root the
 * right atrium meets it across the membranous septum (decisions 222 and 335), and a held atrium drew the interatrial
 * septum there, 0.5 cm in front of the root.
 */
export const LA_ROOT_HOLD_SEPTAL_CM = 0.5;
/**
 * How much of its full size the atrium keeps at a point (0–1) from the root coordinate t, the root's outer wall and how
 * far lateral of the septum's left face the point lies.
 */
export function laRootHold(rootT: number, rootOuter: number, lateralCm: number): number {
  if (rootT < -LA_ROOT_HOLD_T_FADE_CM || rootT > LA_ROOT_HOLD_T_MAX_CM) return 0;
  const sx = Math.min(1, Math.max(0, lateralCm / LA_ROOT_HOLD_SEPTAL_CM - 1));
  const q = Math.min(
    1,
    Math.max(0, (rootOuter - LA_ROOT_HOLD_NEAR_CM) / (LA_ROOT_HOLD_FAR_CM - LA_ROOT_HOLD_NEAR_CM)),
  );
  const a = Math.min(1, Math.max(0, (rootT + LA_ROOT_HOLD_T_FADE_CM) / LA_ROOT_HOLD_T_FADE_CM));
  const b = Math.min(1, Math.max(0, (LA_ROOT_HOLD_T_MAX_CM - rootT) / LA_ROOT_HOLD_T_FADE_CM));
  return (
    (1 - q * q * (3 - 2 * q)) * a * a * (3 - 2 * a) * b * b * (3 - 2 * b) * sx * sx * (3 - 2 * sx)
  );
}
/**
 * Radial scale of the posterior wall's footprint for a radial scale `bo` of the body (decision 330): half the body's
 * change. The posterior wall itself does not move; its lateral edges, where the sides of the atrium meet it, follow the
 * sides by half (2 mm where the body's sides move 4). Shared with GLSL.
 */
export function laFootprintScale(bo: number): number {
  return 0.5 * (1 + bo);
}
/**
 * Where the left atrium's floor behind the annulus lies (decision 330): LA_FLOOR_Y_CM, the atrioventricular groove in
 * the heart frame, whatever the atrium's size. The posterior prism descends to it; the body's own inferoposterior clip
 * (LA_POSTERIOR_RATIO of the AP radius below the centre) lies LA_POSTERIOR_FLOOR_DROP_CM above it, and the declared AP
 * span runs from the groove to the body's anterior pole, so an atrium with a wider span grows forward, toward the root,
 * as the posterior aortic wall is its anterior one and the posterior wall and the groove are the thorax's. −2.97 cm is
 * the normal case's floor before the change (centre y −1.3, AP radius 1.83, drop 0.35). With the centre fixed instead,
 * the heart failure atrium's floor went 0.5 cm lower, into the column, and the long axis showed the aorta 1 cm behind
 * its groove. The centre's other coordinates keep the rules of decision 291 (the septal overlap sets x, the body's own
 * height z); placing the centre at a fixed depth in front of the wall was tried and discarded, because in this heart
 * frame the torso's anterior is medial, toward the root and toward the annulus at once, and the dilated atria then sat
 * so low that the root took up to 1.4 cm of their AP span, or so far into the septal plane that the fit doubled their
 * width. Where the dilated body crosses the wall plane it is clipped flat against the column and the fit gives the
 * volume back across and in height.
 */
export const LA_FLOOR_Y_CM = -2.97;
/**
 * The atrium's AP span is drawn whole in front of the posterior wall (decision 330): the groove's floor at the centre's
 * own x and height keeps at least this (cm) in front of the wall, so the chord from the groove to the anterior pole,
 * where the AP diameter is measured, is not cut by the column. Where it would come closer the centre moves toward the
 * septum and the root (the torso's anterior without its apical part, which would lower the roof): to the right and
 * forward, where a dilated atrium grows, bulging the septum and lifting the root. The heart failure atrium (98 mL),
 * placed by its size alone, had its centre 0.3 cm in front of the wall once the fit had grown it to the left and up
 * (both toward the column here), and its AP diameter read 3.1 cm for 4.7 declared; drawn 1.4 cm forward it reads 5.0.
 * Declared as an assumption.
 */
export const LA_FLOOR_AHEAD_CM = 0.3;
/** The posterior wall plane in the heart frame: unit normal (the torso's posterior) and offset, `dot(p, n) > d` behind it. */
export interface LaPosteriorWall {
  nx: number;
  ny: number;
  nz: number;
  d: number;
}

/** The actual atrial body, including its posterior and roof flattening. */
export function leftAtrialFreeSdf(
  x: number,
  y: number,
  z: number,
  cx: number,
  cy: number,
  cz: number,
  rx: number,
  ry: number,
  rz: number,
  zTop: number,
): number {
  const d = sdEllipsoid(x, y, z, cx, cy, cz, rx, ry, rz);
  return smax(smax(d, cy - LA_POSTERIOR_RATIO * ry - y, 0.6), zTop + 0.15 * rz - z, 0.5);
}

export const IAS_X = -2.35;
/**
 * Centre of the fossa ovalis on the septal plane (heart frame, cm; decision 319): the middle of the septum both atria
 * reach (y −0.93 to −1.05, z −1.15 to −1.55 in five cases). At (−1.6, −2.3) it sat where only the left atrium reached the
 * septum, under the superior vena cava and fat on the right.
 */
export const FOSSA_Y = -0.95;
export const FOSSA_Z = -1.3;

/**
 * Idealized atrial shape: declared AP span plus a volume-constrained transverse/longitudinal scale. The posterior cut
 * retains LA_POSTERIOR_RATIO of the AP radius behind the centre and the anterior side the whole radius; behind the
 * centre the floor lies LA_POSTERIOR_FLOOR_DROP_CM lower (decision 330), so the declared span is the sum.
 */
export function sizedLeftAtrium(k: number, apDiameterCm: number, wall?: LaPosteriorWall) {
  const rx = 2.5 * k,
    ry = (apDiameterCm - LA_POSTERIOR_FLOOR_DROP_CM) / (1 + LA_POSTERIOR_RATIO),
    rz = 2.65 * k;
  // the declared AP span runs from the groove to the anterior pole (decision 330)
  const center = {
    x: IAS_X - 0.35 + rx,
    y: LA_FLOOR_Y_CM + apDiameterCm - ry,
    z: -rz * 0.85,
  };
  if (wall) {
    // and the groove at the centre's x and height keeps in front of the wall, the centre drawn toward the septum and
    // the root where it would not
    const behind =
      center.x * wall.nx +
      LA_FLOOR_Y_CM * wall.ny +
      center.z * wall.nz -
      (wall.d - LA_FLOOR_AHEAD_CM);
    const h = Math.hypot(wall.nx, wall.ny);
    if (behind > 0 && h > 0) {
      center.x -= (behind * wall.nx) / (h * h);
      center.y -= (behind * wall.ny) / (h * h);
    }
  }
  return { center, radii: { x: rx, y: ry, z: rz * 0.88 } };
}

export const ATRIAL_QUADRATURE_POINTS = 8192;
const POINTS = ATRIAL_QUADRATURE_POINTS;
function radicalInverse(i: number, base: number): number {
  let f = 1,
    result = 0;
  while (i > 0) {
    f /= base;
    result += f * (i % base);
    i = Math.floor(i / base);
  }
  return result;
}
export const atrialQuadrature = Float64Array.from(
  { length: POINTS * 3 },
  (_, i) => 2 * radicalInverse(Math.floor(i / 3) + 1, [2, 3, 5][i % 3]!) - 1,
);

/** Numerical volume of the shared clipped atrial body at full nominal annular excursion.
 * Excludes appendage and pulmonary veins (ASE comprehensive TTE 2019, section 4.C.2).
 * This is geometry normalization, not patient calibration or a flow/pressure solver.
 * The corner and the flared base over the annulus (decisions 318 and 328) are not here: `fitOccupiedAtrium` refits the
 * scale by classification afterwards, with them and with what the neighbours take.
 */
export function maximalAtrialBodyVolume(
  k: number,
  excursionCm: number,
  apDiameterCm: number,
): number {
  const { center, radii } = sizedLeftAtrium(k, apDiameterCm);
  const rx = radii.x,
    ry = radii.y,
    cx = center.x,
    cy = center.y;
  const top = center.z - radii.z,
    bottom = excursionCm + 0.25;
  const cz = (top + bottom) / 2,
    rz = (bottom - top) / 2;
  const xFace = IAS_X + IAS_LEFT_FACE_CM;
  let inside = 0;
  for (let i = 0; i < POINTS; i++) {
    const x = cx + rx * atrialQuadrature[3 * i]!,
      y = cy + ry * atrialQuadrature[3 * i + 1]!,
      z = cz + rz * atrialQuadrature[3 * i + 2]!;
    const free = leftAtrialFreeSdf(x, y, z, cx, cy, cz, rx, ry, rz, top);
    // and the body flattened against the septum where it comes close (decision 327), as the classifier draws it
    const u = (y - cy) / ry,
      w = (z - cz) / rz;
    const gap = cx - rx * Math.sqrt(Math.max(0, 1 - u * u - w * w)) - xFace;
    const cross = leftAtrialFreeSdf(cx, y, z, cx, cy, cz, rx, ry, rz, top);
    const flat = Math.max(xFace + laMedialFaceOffset(gap, LA_SEPTAL_FLAT_CM) - x, x - cx, cross);
    if (Math.min(smax(free, xFace - x, 0.3), flat) < 0) inside++;
  }
  return (8 * rx * ry * rz * inside) / POINTS;
}
const cache = new Map<string, number>();
/** Solve the same shape for the declared maximum volume, rather than assuming a universal MAPSE. */
export function atrialScaleForVolume(
  volumeMl: number,
  excursionCm: number,
  apDiameterCm: number,
): number {
  const key = `${volumeMl}|${excursionCm}|${apDiameterCm}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let lo = 0.2,
    hi = 3;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (maximalAtrialBodyVolume(mid, excursionCm, apDiameterCm) < volumeMl) lo = mid;
    else hi = mid;
  }
  const k = (lo + hi) / 2;
  if (cache.size >= 64) cache.delete(cache.keys().next().value!);
  cache.set(key, k);
  return k;
}
