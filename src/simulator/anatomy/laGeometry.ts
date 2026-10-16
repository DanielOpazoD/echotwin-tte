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
 * The base's signed distance: the septal corner (the medial half of the section at zRef, decisions 318 and 327) united
 * with the flared annulus outline (`outlineSdf` is the D-shaped outline's distance in the hinge plane). Both lie between
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
): number {
  const shared = Math.max(xFace + cornerOff - x, zRef - z, z - zHinge, rootClearBase);
  // the flare's lateral bound: the widest section with its slack at the hinge, the section at zRef where the body takes
  // over, so no shoulder stands between them
  const t = Math.min(1, Math.max(0, (zHinge - z) / (zHinge - zRef)));
  const bound = (dCrossEq - LA_BASE_SECTION_SLACK_CM) * (1 - t) + dCrossRef * t;
  return Math.min(
    Math.max(shared, dCrossRef, x - laX),
    Math.max(shared, bound, outlineSdf - LA_BASE_FLARE * (zHinge - z)),
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

/** Idealized atrial shape: declared AP span plus a volume-constrained transverse/longitudinal scale. */
export function sizedLeftAtrium(k: number, apDiameterCm: number) {
  const rx = 2.5 * k,
    // The posterior cut retains 0.72 ry and the anterior side ry.
    // Set their total span from the declared AP dimension; volume sets the other axes.
    ry = apDiameterCm / (1 + LA_POSTERIOR_RATIO),
    rz = 2.65 * k;
  return {
    center: { x: IAS_X - 0.35 + rx, y: -1.3, z: -rz * 0.85 },
    radii: { x: rx, y: ry, z: rz * 0.88 },
  };
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
