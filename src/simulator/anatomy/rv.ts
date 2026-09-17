import { lvCavityRadius, lvRadialOffsetFactor, type LvProfileTable } from './lvShape';
import { latticeNoise3 } from '@/core/noise';
import { ahaSegment } from './lvGeometry';
import { septalShiftAt, wallThicknessAt } from './lvWall';
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

/** Triangular axial taper of the RV from the tricuspid plane (1) to a rounded apex (0 at zApex); 0.85 in the infundibulum above the plane. */
export function rvAxialTaper(tvPlane: number, zApex: number, z: number): number {
  if (z <= tvPlane) return 0.85;
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
  const rEpi =
    rCav + wallThicknessAt(m, thickK, az, levelFrac, amp) * lvRadialOffsetFactor(sh, prof, az, z);
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
    (1 - 0.35 * contraction);
  // tamponade: early-diastolic inward collapse of the anterior/outflow free wall
  if (rvCollapse > 0 && u < 0.55) t *= 1 - 0.65 * rvCollapse * (1 - u / 0.55);
  res[2] = rIn + t;
  res[3] = t;
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
