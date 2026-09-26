import { lvCavityRadius, lvRadialOffsetFactor, type LvProfileTable } from './lvShape';
import { latticeNoise3 } from '@/core/noise';
import { ahaSegment } from './lvGeometry';
import { septalCrestFactor, septalShiftAt, wallThicknessAt } from './lvWall';
import { TWO_PI, skirtOffsetAt } from './valveSkirt';
import type { AnchorsCached } from './anchors';
import type { HeartModel } from './heartModel';
import type { HeartPose } from './heartPose';

/** Scratch buffers shared by the RV helpers (single-threaded classifier). */
/** Scratch of `rvCrescent` for the radii of `rvRadii` (single-threaded, never leaves this module). */
const rvRad = new Float64Array(4);

/** RV crescent azimuthal profile over u ∈ (0, 1) between the grooves: rounded tips, plateau, fullest at the inflow (A4C direction). */
export function rvAzProfile(rvAzA: number, rvAzP: number, u: number): number {
  const sn = Math.sin(Math.PI * u);
  const uIn = (Math.PI + 0.04 - rvAzA) / (rvAzP - rvAzA);
  const inflow = Math.exp(-((u - uIn) * (u - uIn)) / (2 * 0.18 * 0.18));
  return Math.pow(Math.min(1, Math.max(0, sn) / 0.75), 0.7) * (0.85 + 0.15 * inflow);
}

/**
 * Basal boundary of the RV crescent (z, heart frame) at groove fraction u: the tricuspid plane for the inflow and the
 * body, rising 2.6 cm into the infundibulum over the anterior third. The inflow descends with the annulus (tvZ); the
 * infundibulum with the pulmonary root (pvZ, decision 111). Until decision 133 the whole floor followed the annulus, so
 * the base of the outflow dropped 2 cm with TAPSE and the short axis of the great vessels lost the tract in systole.
 * `off` is the annulus offset above the point (saddle and tilt, decision 138): the floor follows the annulus.
 */
export function rvFloorZ(tvCz: number, tvZ: number, pvZ: number, u: number, off: number): number {
  const uInf = 0.35;
  if (u >= uInf) return tvCz + tvZ + off;
  const w = u / uInf;
  return tvCz + pvZ + (tvZ + off - pvZ) * w - 2.6 * (1 - w);
}

/**
 * Fraction of the RV crescent's cavity thickness lost at full contraction by a normal right ventricle, at groove
 * fraction u: RV_BODY_RADIAL_CONTRACTION over the inflow and the body, falling smoothly toward the anterior groove to the
 * radial shortening of the outflow cones (0.15, `rvOutflowScale`), which run from u 0.38 to the pulmonary valve at u 0.03
 * (decision 214). The infundibulum contracts less than the sinus (fractional area change 28 ± 9 % against 42 ± 14 %; Geva
 * et al., Circulation 1998;98:339-345) and there is no clear boundary between the outlet and the rest of the ventricle
 * (Ho and Nihoyannopoulos, Heart 2006;92 Suppl 1:i2-13). `rvRadialScale` scales it by the case's systolic function.
 */
export const RV_BODY_RADIAL_CONTRACTION = 0.75;
/**
 * The body value: 0.42 until decision 220, when the tricuspid annulus descended by TAPSE all round. Once its septal hinge
 * descends with the mitral one, as the septal points of the atrioventricular plane do in healthy hearts (right-sided
 * displacement 22 ± 3 mm averaged over septal, outflow and lateral points against 16 ± 2 mm on the left, which shares the
 * septal ones; Lindholm et al., Int J Cardiovasc Imaging 2022;38:2235-2248), the normal case ejected 57 mL against the
 * left ventricle's 75. With 0.75 the right ventricle ejects what the left one does (74 mL, ejection fraction 57.8 %, normal
 * 3D 58 ± 6.5 %), its four-chamber fractional area change is 44 % (49 ± 7 %, Lang et al., JASE 2015) and its cavity in the
 * mid short axis shrinks 37 % in systole where it shrank 5 %. The value is a fraction of the crescent's thickness along
 * the LV radius, thin at its tips: what an image shows of it are those areas.
 */
export function rvRadialContraction(u: number): number {
  const s = Math.min(1, Math.max(0, (u - 0.15) / 0.35));
  return 0.15 + (RV_BODY_RADIAL_CONTRACTION - 0.15) * s * s * (3 - 2 * s);
}

/** TAPSE of the reference normal heart (cm), against which a case's right ventricular systolic function is scaled. */
export const RV_REFERENCE_TAPSE_CM = 2.2;
/**
 * Radial contraction of a case's right ventricle relative to a normal one, from its TAPSE: (TAPSE / 2.2)^1.5 (decision
 * 220). The cases declare their right ventricular systolic function only through TAPSE and S′, and the free wall that
 * shortens is the one that moves inward. The exponent makes the geometric ejection fraction cross 45 % near a TAPSE of
 * 1.7 cm, the two thresholds of right ventricular dysfunction in the guidelines (Rudski et al., JASE 2010): 47.8 % at
 * 1.8 cm, 41.3 % at 1.6 and 39.0 % at 1.3; with the TAPSE ratio itself the 1.6 cm case read 45.7 %.
 */
export function rvRadialScale(tapseCm: number): number {
  return Math.min(1.2, Math.pow(tapseCm / RV_REFERENCE_TAPSE_CM, 1.5));
}

/**
 * Triangular axial taper of the RV from the tricuspid plane (1) to a rounded apex (0 at zApex); above the plane the
 * infundibulum narrows to 0.85 over 1.5 cm. The narrowing used to be a step at the plane, which descends 2 cm with the
 * annulus in systole: it swept the anterior free wall of the long axis and thinned the crescent there by 0.37 cm at once,
 * the edge where the contraction seemed to end (decision 214).
 */
export function rvAxialTaper(tvPlane: number, zApex: number, z: number): number {
  if (z <= tvPlane) {
    const a = Math.min(1, (tvPlane - z) / 1.5);
    return 1 - 0.15 * a * a * (3 - 2 * a);
  }
  const q = Math.min(1, (z - tvPlane) / Math.max(0.5, zApex - tvPlane));
  // full width through the basal quarter, then a straight taper that rounds off at the apex
  const s = Math.max(0, (q - 0.25) / 0.75);
  return (1 - 0.55 * s) * Math.sqrt(Math.max(0, 1 - s * s * s * s * s));
}

/**
 * RV radii at azimuth/height without trabecular noise: writes [rIn, u, rOut, t] — the inner boundary
 * (LV epicardium + gap, minus septal flattening), the groove fraction u, the outer free-wall endocardium
 * and the cavity thickness t (0 outside the crescent span).
 */
export function rvRadii(
  m: HeartModel,
  A: AnchorsCached,
  prof: LvProfileTable,
  thickK: number,
  zAnn: number,
  lengthNow: number,
  tvZ: number,
  contraction: number,
  septalShiftCm: number,
  rvCollapse: number,
  az: number,
  z: number,
  res: Float64Array,
): void {
  const L = m.lv.lengthCm;
  const sh = m.lv.shape;
  const azN = az < 0 ? az + TWO_PI : az;
  const u = (azN - A.rvAzA) / (A.rvAzP - A.rvAzA);
  const rCav = lvCavityRadius(sh, prof, az, z);
  const levelFrac = Math.min(1, Math.max(0, (z - zAnn) / Math.max(lengthNow, 1)));
  const amp = m.segAmp[ahaSegment(az, levelFrac)] ?? 1;
  // the septal crest gives its thickness to the ventricle, whose free wall stays (decision 223)
  const wFull =
    wallThicknessAt(m, thickK, az, levelFrac, amp) * lvRadialOffsetFactor(sh, prof, az, z);
  // below the tricuspid plane only: above it the space beside the crest is the atrium's (a smooth 0.3 cm step)
  const below = Math.min(1, Math.max(0, (z - (A.tvCenter.z + tvZ - 0.6)) / 0.3));
  const crestLoss = wFull * (1 - septalCrestFactor(az, z - zAnn)) * below * below * (3 - 2 * below);
  const rEpi = rCav + wFull - crestLoss;
  const rIn = rEpi - septalShiftAt(septalShiftCm, az, levelFrac) + 0.05;
  res[0] = rIn;
  res[1] = u;
  if (u <= 0 || u >= 1) {
    res[2] = rIn;
    res[3] = 0;
    return;
  }
  const tvPlane = A.tvCenter.z + tvZ;
  let t =
    A.rvT *
    rvAzProfile(A.rvAzA, A.rvAzP, u) *
    rvAxialTaper(tvPlane, A.rvApexFrac * L, z) *
    (1 - rvRadialContraction(u) * contraction * A.rvRadialScale);
  // tamponade: early-diastolic inward collapse of the anterior/outflow free wall
  if (rvCollapse > 0 && u < 0.55) t *= 1 - 0.65 * rvCollapse * (1 - u / 0.55);
  res[2] = rIn + t + crestLoss;
  res[3] = t + crestLoss;
}

/**
 * RV crescent: the cavity lies between the LV epicardium (+ a small gap) and the free-wall endocardium at
 * radial distance rIn + t(az, z): triangular in long axis (widest at the tricuspid plane, rounded apex at
 * rvApexFrac·L), a crescent in short axis whose tips close smoothly at the interventricular grooves, the
 * infundibulum rising above the tricuspid plane in the anterior third, and a coarse trabecular mesh
 * (material coordinates) that fills in the apical third. Writes [signedDistance, rIn, rOut] into `res`.
 */
export function rvCrescent(
  m: HeartModel,
  hp: HeartPose,
  A: AnchorsCached,
  x: number,
  y: number,
  z: number,
  az: number,
  res: Float64Array,
): void {
  rvRadii(
    m,
    A,
    hp.prof,
    hp.thickK,
    hp.zAnn,
    hp.lengthNow,
    hp.tvZ,
    hp.state.contraction,
    hp.septalShiftCm,
    hp.rvCollapse,
    az,
    z,
    rvRad,
  );
  const rIn = rvRad[0]!,
    u = rvRad[1]!;
  if (u <= 0 || u >= 1) {
    res[0] = 1e3;
    res[1] = rIn;
    res[2] = rIn;
    return;
  }
  const L = m.lv.lengthCm;
  const zApex = A.rvApexFrac * L;
  const zBase = rvFloorZ(A.tvCenter.z, hp.tvZ, hp.pvZ, u, skirtOffsetAt(hp.valves.tv, x, y));
  let t = rvRad[3]!;
  // trabeculae: longitudinal ridges that coarsen toward the apex, where the mesh narrows the cavity
  if (z > 0.25 * L) {
    const w = Math.min(1, (z - 0.25 * L) / (0.35 * L));
    const rs = 1 - 0.3 * hp.state.contraction;
    const n =
      latticeNoise3((x / rs) * 1.4 + 3.1, (y / rs) * 1.4 + 9.7, z * 0.9 + 5.3, m.wallNoise) - 0.5;
    t += (0.25 + 0.25 * w) * n - 0.12 * w * w;
  }
  const rOut = rIn + Math.max(0, t);
  const r = Math.hypot(x, y);
  res[0] = Math.max(rIn - r, r - rOut, zBase - z, z - zApex);
  res[1] = rIn;
  res[2] = rOut;
}
