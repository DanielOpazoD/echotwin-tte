import type { AnatomyConfig } from '@/cases/schema';
import type { Vec3 } from '@/core/vec3';
import { cross, normalize, sub, v3, dot, scale, add } from '@/core/vec3';

/**
 * HEART FRAME (cm): origin = centre of the mitral annulus at end diastole.
 *   +z : long axis, base → apex
 *   +x : septal → lateral (medial → lateral)
 *   +y : inferior → anterior (the RV and aortic root are anterior)
 * Standard planes: PLAX contains z and the anteroseptal↔inferolateral direction; A4C contains z
 * and x (inferoseptal↔anterolateral); A2C contains z and y (anterior↔inferior).
 */
export interface HeartFrame {
  origin: Vec3; // torso coords of heart origin
  ex: Vec3;
  ey: Vec3;
  ez: Vec3;
}

/** Aortic root axis in the heart frame: ~33° from the LV long axis toward anterior-septal (adults 25–35°). */
export const AV_AXIS: Vec3 = normalize(v3(-0.15, 0.53, -0.85));
/**
 * Level of the mitral short axis, in cm from the end-diastolic annulus toward the apex (decision 164): the leaflets open
 * across it in diastole, and it cuts the basal segments of the ventricle. The `psax-mv` view aims there and its basal
 * landmarks sit there. It lives here, with the other frame constants the view definitions read, so that importing it
 * does not pull the anatomy into the main bundle.
 */
export const MITRAL_SHORT_AXIS_CM = 1.4;
/** Centre of the mitral annulus (heart frame, cm): 0.9 cm behind the LV long axis and 0.2 cm lateral to it. */
export const MITRAL_CENTRE_X = 0.2;
export const MITRAL_CENTRE_Y = -0.9;
/**
 * Share of the ventricular base's systolic descent that the aortic root follows. The fibrous skeleton moves as one:
 * the aortic annular plane systolic excursion of healthy adults is 1.16 ± 0.30 cm by 3D speckle tracking (MAGYAR-
 * Healthy, n = 111) and 14 ± 3 mm by cardiac magnetic resonance, against a mitral annular excursion of ~1.4-1.6 cm.
 * Until 2026-09-13 the root followed half of it, which opened a gap between the aortic root and the anterior mitral
 * annulus in every systolic long-axis frame.
 */
export const ROOT_EXCURSION = 0.85;
/**
 * Share of the ventricular base's systolic descent that the outflow tract and the pulmonary root follow, along the heart
 * axis. The pulmonary root moves 8.0 mm (median) in systole, predominantly caudally, ventrally and to the left, by
 * ECG-gated CT in 100 adults with normal function (Lis et al., J Interv Card Electrophysiol 2026;69:99-107): the heart
 * axis points that way (+x, −y, +z in the torso). 0.8 cm over the 1.4 cm mitral annular excursion of the normal case
 * gives 0.57, a declared ratio. The trunk bifurcation stays where it is. Until decision 111 the outflow tract and the
 * pulmonary root did not move, and in systole the aortic root, which does, took up to a third of their lumen.
 */
export const PV_ROOT_EXCURSION = 0.57;
export { ROOT_ASC_T, ROOT_SINUS_T, ROOT_STJ_T, AV_COAPT_HALF } from './aorticValve';

export function buildHeartFrame(anatomy: AnatomyConfig, offset: Vec3 = v3()): HeartFrame {
  const ez = normalize(anatomy.heartPosition.longAxis);
  let ey = normalize(anatomy.heartPosition.anterior);
  ey = normalize(sub(ey, scale(ez, dot(ey, ez))));
  const ex = cross(ey, ez); // right-handed: ex × ey = ez
  return { origin: add(anatomy.heartPosition.baseCm, offset), ex, ey, ez };
}

export function torsoToHeart(f: HeartFrame, p: Vec3): Vec3 {
  const d = sub(p, f.origin);
  return v3(dot(d, f.ex), dot(d, f.ey), dot(d, f.ez));
}
export function heartToTorso(f: HeartFrame, p: Vec3): Vec3 {
  return v3(
    f.origin.x + f.ex.x * p.x + f.ey.x * p.y + f.ez.x * p.z,
    f.origin.y + f.ex.y * p.x + f.ey.y * p.y + f.ez.y * p.z,
    f.origin.z + f.ex.z * p.x + f.ey.z * p.y + f.ez.z * p.z,
  );
}
export function heartDirToTorso(f: HeartFrame, d: Vec3): Vec3 {
  return v3(
    f.ex.x * d.x + f.ey.x * d.y + f.ez.x * d.z,
    f.ex.y * d.x + f.ey.y * d.y + f.ez.y * d.z,
    f.ex.z * d.x + f.ey.z * d.y + f.ez.z * d.z,
  );
}
