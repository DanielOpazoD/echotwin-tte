import type { AnatomyConfig, PhysiologyConfig } from '@/cases/schema';
import type { CycleState } from '@/simulator/cardiac-cycle/cycleModel';
import { Structure, Tissue, type TissueSample } from './tissue';
import { sdCapsule, sdEllipsoid, sdRoundCone, sdSegmentChain, sdTorusZ, smax, type ChainHit } from './sdf';
import { allocLvProfileTable, axialWallFactor, buildLvProfile, lvCavityRadius, lvCavitySdf, lvProfileG, lvRadialOffsetFactor, lvSdfNormal, lvShapeFor, lvShellVolume, solveThickening, type LvProfileTable, type LvShape } from './lvShape';
import { fastAtan2, latticeNoise3, noiseLattice } from '@/core/noise';
import type { Vec3 } from '@/core/vec3';
import { cross, normalize, sub, v3, dot, scale, add } from '@/core/vec3';

/**
 * Parametric, kinematic heart model — the conceptual source of truth for anatomy (spec 6).
 *
 * HEART FRAME (cm): origin = centre of the mitral annulus at end diastole.
 *   +z : long axis, base → apex
 *   +x : septal → lateral (medial → lateral)
 *   +y : inferior → anterior (the RV and aortic root are anterior)
 * Standard planes: PLAX contains z and the anteroseptal↔inferolateral direction; A4C contains z
 * and x (inferoseptal↔anterolateral); A2C contains z and y (anterior↔inferior).
 *
 * Geometry is analytic (ellipsoids, tubes, thin patches). Contraction is volume-consistent:
 * cavity radii follow V(φ) from the beat tables, the myocardium is incompressible (wall thickening
 * emerges), the base descends by MAPSE·long(φ) (atria lengthen in systole), valves open with flow.
 */
export interface LvGeometry {
  lengthCm: number; // annulus → endocardial apex at ED
  rMax: number; // maximal lateral cavity radius at ED
  shape: LvShape; // bullet profile (see lvShape.ts)
  wallVolumeMl: number; // myocardial shell volume at ED (conserved through the cycle)
  ivsd: number;
  lvpwd: number;
  apexT: number;
  /** ED profile table (annulus at z = 0), for tools that need the resting geometry. */
  edProfile: LvProfileTable;
}

export function lvGeometryFromVolume(edvMl: number, lengthCm: number, sphericity: number, anatomy: AnatomyConfig['lv']): LvGeometry {
  const shape = lvShapeFor(sphericity);
  // cavity volume between the annulus plane and the apex: π·ratio·R²·L·∫g²
  const rMax = Math.sqrt(edvMl / (Math.PI * shape.ratio * lengthCm * shape.I));
  const edProfile = buildLvProfile(shape, rMax, lengthCm, 0, allocLvProfileTable());
  const tBase = (anatomy.ivsdCm + anatomy.lvpwdCm) / 2;
  const tMean = (zeta: number): number => tBase * axialWallFactor(zeta, anatomy.apexWallThicknessCm / tBase);
  const wallVolumeMl = Math.max(20, lvShellVolume(edProfile, shape.ratio, tMean, 1));
  return { lengthCm, rMax, shape, wallVolumeMl, ivsd: anatomy.ivsdCm, lvpwd: anatomy.lvpwdCm, apexT: anatomy.apexWallThicknessCm, edProfile };
}

export interface HeartFrame {
  origin: Vec3; // torso coords of heart origin
  ex: Vec3;
  ey: Vec3;
  ez: Vec3;
}

/** Aortic root axis in the heart frame: ~33° from the LV long axis toward anterior-septal (adults 25–35°). */
export const AV_AXIS: Vec3 = normalize(v3(-0.15, 0.53, -0.85));

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

/** Wall-motion amplitude per AHA segment (1 normal). */
export type SegmentAmplitudes = Float32Array; // length 18 (index 1..17)

export function segmentAmplitudes(anatomy: AnatomyConfig): SegmentAmplitudes {
  const s = new Float32Array(18).fill(1);
  for (const wm of anatomy.wallMotion) s[wm.segment] = wm.amplitude;
  return s;
}

/** AHA 17-segment id from heart-frame azimuth (rad, 0 = lateral, π/2 = anterior) and level fraction 0 (base) → 1 (apex). */
export function ahaSegment(azimuthRad: number, levelFrac: number): number {
  // model azimuth 0 = A4C lateral wall (anterolateral segment, centred at 30° in the AHA convention)
  const deg = (((azimuthRad * 180) / Math.PI + 28) % 360 + 360) % 360;
  if (levelFrac > 0.93) return 17;
  if (levelFrac > 0.66) {
    // apical 4: lateral 0, anterior 90, septal 180, inferior 270 (each ±45)
    if (deg < 45 || deg >= 315) return 16;
    if (deg < 135) return 13;
    if (deg < 225) return 14;
    return 15;
  }
  const base = levelFrac <= 0.33 ? 0 : 6;
  // 6 segments centred at anterolateral 30, anterior 90, anteroseptal 150, inferoseptal 210, inferior 270, inferolateral 330
  if (deg < 60) return base + 6; // anterolateral (1-6 basal: anterior=1, anteroseptal=2, inferoseptal=3, inferior=4, inferolateral=5, anterolateral=6)
  if (deg < 120) return base + 1;
  if (deg < 180) return base + 2;
  if (deg < 240) return base + 3;
  if (deg < 300) return base + 4;
  return base + 5;
}

export interface HeartModel {
  anatomy: AnatomyConfig;
  physiology: PhysiologyConfig;
  lv: LvGeometry;
  segAmp: SegmentAmplitudes;
  frame: HeartFrame;
  /** Bounding sphere in heart frame for early-out. */
  boundRadius: number;
  boundCenter: Vec3;
  /** Lattice for wall-thickness modulation (seeded). */
  wallNoise: Uint8Array;
  /** Surface-weighted mean of (1 − amplitude) over the 17 segments: the outward cavity shift that akinetic segments add. */
  regionalMeanFrac: number;
}

export function createHeartModel(anatomy: AnatomyConfig, physiology: PhysiologyConfig, offset: Vec3 = v3(), seed = 1): HeartModel {
  const lv = lvGeometryFromVolume(physiology.edvMl, anatomy.lv.lengthEdCm, anatomy.lv.sphericity, anatomy.lv);
  return {
    anatomy,
    physiology,
    lv,
    segAmp: segmentAmplitudes(anatomy),
    frame: buildHeartFrame(anatomy, offset),
    boundRadius: lv.lengthCm * 0.5 + 8.5,
    boundCenter: v3(-1.2, 0.2, lv.lengthCm * 0.5 - 1.5),
    wallNoise: noiseLattice(seed ^ 0x5157),
    regionalMeanFrac: regionalMeanFraction(segmentAmplitudes(anatomy)),
  };
}

/** Surface fractions of the AHA segments (basal/mid 1/18 each, apical 1/16 each, apex 1/12), weighted by hypokinesia. */
function regionalMeanFraction(amp: SegmentAmplitudes): number {
  let sum = 0;
  for (let seg = 1; seg <= 17; seg++) {
    const frac = seg <= 12 ? 1 / 18 : seg <= 16 ? 1 / 16 : 1 / 12;
    sum += (1 - Math.min(1, amp[seg] ?? 1)) * frac;
  }
  return sum;
}

/** Per-frame deformation parameters derived from the cycle state (computed once per frame). */
export interface HeartPose {
  state: CycleState;
  zAnn: number; // annulus displacement toward apex (cm)
  /** Maximal cavity radius now (lateral) and the polar table of the cavity surface (lvShape.ts). */
  rMax: number;
  prof: LvProfileTable;
  /** Systolic wall-thickening factor from wall-volume conservation (1 at end diastole). */
  thickK: number;
  lengthNow: number;
  radialScale: number; // rMax / rMax at ED
  longScale: number; // lengthNow / length at ED
  /** Papillary muscles as round cones [ax,ay,az,bx,by,bz,ra,rb] × 2 (anterolateral, posteromedial), current frame. */
  paps: Float64Array;
  /** RV anterior papillary muscle (round cone, 8 floats), current frame. */
  rvPap: Float64Array;
  mvAngleAnt: number; // anterior leaflet angle (rad) in y–z plane from +z toward −y
  mvAnglePost: number;
  avOpenAngle: number; // rad from perpendicular (closed) toward axis (open)
  tvAngleAnt: number;
  tvAnglePost: number;
  rvScale: number;
  tvZ: number; // tricuspid annulus displacement (TAPSE)
  laBooster: number; // atrial contraction radial scale (1 = none)
  effusion: number;
  /** Tamponade signs this frame: RV free-wall inward collapse (0..1), RA collapse (0..1) and heart swing (cm, x). */
  rvCollapse: number;
  raCollapse: number;
  swingX: number;
  /** Interventricular septal flattening amplitude (cm) toward the LV. */
  septalShiftCm: number;
  /** Precomputed per-frame valve geometry (avoids trig per sample). */
  valves: ValveGeometry;
}

export interface ValveGeometry {
  /** Segment chains for the aortic cusps: [sx,sy,sz,dx,dy,dz] × segments, stored contiguously. */
  segs: Float64Array;
  /**
   * Atrioventricular leaflets as revolution "skirts" hanging from the annulus ring: a 2D profile
   * (ρ, z) polyline per leaflet zone (anterior / posterior) blended by azimuth around the ring, so
   * long-axis views cut two hinged leaflets and short-axis views show the orifice.
   */
  mv: SkirtDesc;
  tv: SkirtDesc;
  mvThickness: number;
  /** Aortic cusps: offset of each cusp chain (2 segments), shared width vectors per cusp [wx,wy,wz]. */
  cuspOffsets: number[];
  cuspWidths: Float64Array;
  cuspCount: number;
  cuspHalf: number;
  cuspSegLen: number;
  cuspThickness: number;
  /** Chordae tendineae as capsules [ax,ay,az,bx,by,bz] × n. */
  chordae: Float64Array;
  chordaeCount: number;
  /** Pulmonary cusps: three 2-segment chains on the trunk axis (same layout as the aortic ones). */
  pvSegs: Float64Array;
  pvWidths: Float64Array;
  pvHalf: number;
  pvSegLen: number;
  pvThickness: number;
  /** Annulus rings (torus, axis z): [cx,cy,cz,R] for mitral and tricuspid. */
  mvRing: [number, number, number, number];
  tvRing: [number, number, number, number];
}

export interface SkirtDesc {
  cx: number;
  cy: number;
  cz: number; // hinge plane z
  R: number; // annulus radius
  /** Profiles as 4 points (ρ, z) relative to the hinge: [ρ0,z0, ρ1,z1, ρ2,z2, ρ3,z3]; ρ0 = R, z0 = 0. */
  profA: Float64Array;
  profP: Float64Array;
  /** Azimuth (rad) of the anterior-zone centre and its half span; blend width at the commissures. */
  phiA: number;
  halfSpan: number;
  blend: number;
  thickness: number;
  /** Saddle height (cm): commissures sit this much more apical than the anterior/posterior high points. */
  saddle: number;
}

/** Apical offset of a saddle-shaped annulus at azimuth `phi` (0 at the high points, `saddle` at the commissures). */
function saddleOffset(phi: number, phiA: number, saddle: number): number {
  const sn = Math.sin(phi - phiA);
  return saddle * sn * sn;
}

/** Build a (ρ, z) profile polyline from per-segment angles (from +z toward inward −ρ) and a segment length. */
function buildProfile(R: number, angles: number[], segLen: number): Float64Array {
  const out = new Float64Array(8);
  let rho = R,
    z = 0;
  out[0] = rho;
  out[1] = z;
  for (let i = 0; i < 3; i++) {
    const a = angles[i]!;
    rho -= Math.sin(a) * segLen;
    z += Math.cos(a) * segLen;
    out[2 + i * 2] = rho;
    out[3 + i * 2] = z;
  }
  return out;
}

const blendAngles = (closed: number[], open: number[], t: number): number[] => closed.map((c, i) => c + ((open[i] ?? c) - c) * t);

const skirtHit: ChainHit = { d: 0, frac: 0 };
const TWO_PI = Math.PI * 2;

/**
 * Distance from a heart-frame point to an AV-valve skirt. Writes distance and along-fraction to
 * `skirtHit`; returns the blended thickness at that point (for the inside test).
 */
function skirtDistance(x: number, y: number, z: number, k: SkirtDesc): number {
  const dx = x - k.cx,
    dy = y - k.cy;
  const rho = Math.sqrt(dx * dx + dy * dy);
  const phi = fastAtan2(dy, dx);
  let dphi = Math.abs(phi - k.phiA);
  if (dphi > Math.PI) dphi = TWO_PI - dphi;
  // anterior-zone weight: 1 inside the span, 0 outside, smooth across the commissures
  const t = (dphi - (k.halfSpan - k.blend)) / (2 * k.blend);
  const w = t <= 0 ? 1 : t >= 1 ? 0 : 1 - t * t * (3 - 2 * t);
  const zr = z - k.cz - saddleOffset(phi, k.phiA, k.saddle);
  let best = Infinity;
  let bestFrac = 0;
  for (let i = 0; i < 3; i++) {
    const ax = w * k.profA[i * 2]! + (1 - w) * k.profP[i * 2]!;
    const az = w * k.profA[i * 2 + 1]! + (1 - w) * k.profP[i * 2 + 1]!;
    const bx = w * k.profA[i * 2 + 2]! + (1 - w) * k.profP[i * 2 + 2]!;
    const bz = w * k.profA[i * 2 + 3]! + (1 - w) * k.profP[i * 2 + 3]!;
    const ex = bx - ax,
      ez = bz - az;
    const l2 = ex * ex + ez * ez;
    let u = l2 > 0 ? ((rho - ax) * ex + (zr - az) * ez) / l2 : 0;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    const qx = ax + ex * u - rho,
      qz = az + ez * u - zr;
    const d = Math.sqrt(qx * qx + qz * qz);
    if (d < best) {
      best = d;
      bestFrac = (i + u) / 3;
    }
  }
  skirtHit.d = best;
  skirtHit.frac = bestFrac;
  return k.thickness * (1 - 0.45 * bestFrac) * 0.5 + 0.035;
}

/** Early-diastolic RV free-wall collapse window (tamponade): after AV closure, before the mitral E peak. */
function rvCollapseWindow(state: CycleState): number {
  const p = state.phase;
  // window centred just after ejection end (≈ 0.42–0.6 of the cycle for typical timings)
  const c = 0.5;
  const w = 0.1;
  return Math.exp(-((p - c) * (p - c)) / (2 * w * w));
}
/** Late-diastolic / early-systolic RA collapse window (tamponade). */
function raCollapseWindow(state: CycleState): number {
  const p = state.phase;
  const d = Math.min(Math.abs(p - 0.02), Math.abs(p - 1.02));
  return Math.exp(-(d * d) / (2 * 0.06 * 0.06));
}

/**
 * Semilunar cusps as 2-segment chains in the (inward, axis) plane: closed = shallow cup with the free edges
 * meeting near the axis, open = lying along the wall; the two segment angles are solved (bisection) so the
 * free edge reaches the orifice radius for the given openness. Fills `segs` (count × 12) and `widths` (count × 3).
 */
function buildCuspChains(cx: number, cy: number, cz: number, ax: Vec3, e1: Vec3, e2: Vec3, R: number, openness: number, count: number, segs: Float64Array, widths: Float64Array, phi0: number): number {
  const segLen = (R * 1.5) / 2;
  const targetReach = R - R * (0.05 + 0.85 * Math.max(0, Math.min(1, openness)));
  let lo = 0,
    hi = 1;
  for (let it = 0; it < 14; it++) {
    const mid = (lo + hi) / 2;
    const reach = segLen * (Math.cos(0.45 + 1.0 * mid) + Math.cos(0.95 + 0.5 * mid));
    if (reach > targetReach) lo = mid;
    else hi = mid;
  }
  const fr = (lo + hi) / 2;
  const angles = [0.45 + 1.0 * fr, 0.95 + 0.5 * fr];
  for (let i = 0; i < count; i++) {
    const phi = (i * 2 * Math.PI) / count + phi0;
    const rx = e1.x * Math.cos(phi) + e2.x * Math.sin(phi);
    const ry = e1.y * Math.cos(phi) + e2.y * Math.sin(phi);
    const rz = e1.z * Math.cos(phi) + e2.z * Math.sin(phi);
    let sx = cx + rx * R,
      sy = cy + ry * R,
      sz = cz + rz * R;
    for (let k = 0; k < 2; k++) {
      const a = angles[k]!;
      const dx = -rx * Math.cos(a) + ax.x * Math.sin(a);
      const dy = -ry * Math.cos(a) + ax.y * Math.sin(a);
      const dz = -rz * Math.cos(a) + ax.z * Math.sin(a);
      const o = i * 12 + k * 6;
      segs[o] = sx;
      segs[o + 1] = sy;
      segs[o + 2] = sz;
      segs[o + 3] = dx;
      segs[o + 4] = dy;
      segs[o + 5] = dz;
      sx += dx * segLen;
      sy += dy * segLen;
      sz += dz * segLen;
    }
    widths[i * 3] = ax.y * rz - ax.z * ry;
    widths[i * 3 + 1] = ax.z * rx - ax.x * rz;
    widths[i * 3 + 2] = ax.x * ry - ax.y * rx;
  }
  return segLen;
}

export function computeHeartPose(m: HeartModel, state: CycleState): HeartPose {
  const { lv } = m;
  const sh = lv.shape;
  const tamp = m.anatomy.pericardium.tamponade;
  const long = state.longitudinal;
  const zAnn = m.physiology.mapseCm * long;
  const lengthNow = lv.lengthCm - zAnn; // apex fixed at z = L
  const volNow = state.lvVolumeMl;
  // cavity radius from the volume tables: V = π·ratio·R²·L·∫g² over the bullet profile
  const rMax0 = Math.sqrt(Math.max(volNow, 5) / (Math.PI * sh.ratio * Math.max(lengthNow, 1) * sh.I));
  // regional wall-motion abnormalities keep their segments at the end-diastolic radius; the remaining
  // segments contract more (compensatory hyperkinesia) so that the surface-averaged radius — and the
  // cavity volume — still follow the tables: R²·(1 − F) + F·R_ED² = R0²
  const F = Math.min(0.6, m.regionalMeanFrac);
  const rMax = rMax0 < lv.rMax && F > 0 ? Math.max(0.5, Math.sqrt(Math.max(0.25, (rMax0 * rMax0 - F * lv.rMax * lv.rMax) / (1 - F)))) : rMax0;
  const prof = buildLvProfile(sh, rMax, lengthNow, zAnn, allocLvProfileTable());
  // incompressible myocardium: the thickening factor keeps the shell volume of the end-diastolic wall
  const tBase = (lv.ivsd + lv.lvpwd) / 2;
  const tMean = (zeta: number): number => tBase * axialWallFactor(zeta, lv.apexT / tBase);
  // The traced end-diastolic cavity (the volume tables follow the ASE tracing convention) includes the
  // blood among the trabeculae; in systole that trabecular layer compacts against the wall, so the
  // apparent wall gains ~12 % of the shell volume on top of mass conservation of the compact wall.
  const thickK = solveThickening(prof, sh.ratio, tMean, lv.wallVolumeMl * (1 + 0.12 * state.contraction));
  const radialScale = rMax / lv.rMax;
  const longScale = lengthNow / lv.lengthCm;
  const open = state.mvOpen;
  const maxOpen = (m.anatomy.mitral.maxOpeningDeg * Math.PI) / 180;
  const sam = m.anatomy.mitral.samSeverity;
  const openScale = maxOpen / 1.22;
  // Mitral leaflets as 3-segment chains. Closed: bodies bow toward the LA, tips point apically to the
  // coaptation. Open: the anterior leaflet whips toward the septum, the posterior toward the wall.
  const samShift = sam * 0.9 * state.contraction; // SAM: anterior leaflet drifts outward (toward the LVOT/septum) in systole
  // angles from +z (apical) toward inward (−ρ); positive = pointing to the orifice centre
  const antClosed = [1.2 - samShift, 1.1 - samShift, 0.8 - samShift];
  const antOpen = [-0.61 * openScale, -0.7 * openScale, -0.79 * openScale];
  const prol = m.anatomy.mitral.prolapse;
  // prolapse: the closed leaflet body billows beyond the annular plane into the LA (angles beyond π/2 point basally)
  const postClosed = [0.95 + 1.1 * prol, 0.7 + 1.5 * prol, 0.45 + 1.7 * prol];
  const postOpen = [-0.61 * openScale, -0.79 * openScale, -0.96 * openScale];
  const mvAngleAnt = antClosed[1]! + (antOpen[1]! - antClosed[1]!) * open;
  const mvAnglePost = postClosed[1]! + (postOpen[1]! - postClosed[1]!) * open;
  const avOpenAngle = 0.15 + (1.35 * m.anatomy.aorticValve.maxOpeningFraction - 0.15) * state.avOpen;
  const tvAngleAnt = -1.0 + (0.6 + 1.0) * state.tvOpen;
  const tvAnglePost = 0.8 + (-0.7 - 0.8) * state.tvOpen;
  const A = anchorsCached(m);
  const cusps = m.anatomy.aorticValve.bicuspid ? 2 : 3;
  const tvZ = m.physiology.tapseCm * long;
  const septalShiftCm = m.anatomy.rv.septalFlattening * 0.9;
  const rvCollapse = tamp * rvCollapseWindow(state);
  // Mitral skirt: anterior zone centred at +y (φ = π/2), spanning ±70°; closed profiles bow toward the
  // LA with tips meeting apically; open profiles swing outward (anterior toward the septum).
  const antLen = m.anatomy.mitral.anteriorLeafletLengthCm / 3;
  const postLen = m.anatomy.mitral.posteriorLeafletLengthCm / 3;
  const mv: SkirtDesc = {
    cx: A.mvCenter.x,
    cy: A.mvCenter.y,
    cz: zAnn,
    R: A.mvR,
    profA: buildProfile(A.mvR, blendAngles(antClosed, antOpen, open), antLen),
    profP: buildProfile(A.mvR, blendAngles(postClosed, postOpen, open), postLen),
    phiA: Math.PI / 2,
    halfSpan: 1.22,
    blend: 0.3,
    thickness: m.anatomy.mitral.thickeningCm,
    saddle: 0.35,
  };
  const tvOpen = state.tvOpen;
  const tv: SkirtDesc = {
    cx: A.tvCenter.x,
    cy: A.tvCenter.y,
    cz: A.tvCenter.z + tvZ,
    R: A.tvR,
    profA: buildProfile(A.tvR, blendAngles([1.15, 1.0, 0.75], [-0.5, -0.6, -0.7], tvOpen), (A.tvR * 1.05) / 3),
    profP: buildProfile(A.tvR, blendAngles([1.05, 0.8, 0.5], [-0.5, -0.65, -0.8], tvOpen), (A.tvR * 0.75) / 3),
    phiA: Math.PI / 2,
    halfSpan: 1.1,
    blend: 0.3,
    thickness: 0.09,
    saddle: 0.15,
  };
  // aortic cusps: sheets ~1.5·R long from the annular nadir to the free edge as 2-segment chains whose reach
  // follows the orifice (0.05·R closed → 0.9·R open, scaled by the case's maxOpeningFraction)
  const segs = new Float64Array(cusps * 12);
  const cuspWidths = new Float64Array(cusps * 3);
  const cuspSegLen = buildCuspChains(A.avCenter.x, A.avCenter.y, A.avCenter.z + zAnn * 0.5, A.avAxis, A.avE1, A.avE2, A.avR, Math.max(0, Math.min(1, state.avOpen)) * m.anatomy.aorticValve.maxOpeningFraction, cusps, segs, cuspWidths, 0.5);
  const cuspOffsets = Array.from({ length: cusps }, (_, i) => i * 12);
  // pulmonary valve: three cusps hinged at the outflow–trunk junction on the trunk axis, opening with RV ejection
  const pvSegs = new Float64Array(36);
  const pvWidths = new Float64Array(9);
  const pvSegLen = buildCuspChains(A.rvotB.x, A.rvotB.y, A.rvotB.z, A.paDir, A.pvE1, A.pvE2, A.pvR, Math.max(0, Math.min(1, state.pvOpen)), 3, pvSegs, pvWidths, 0.2);
  // papillary muscles: round cones rooted inside the wall (level ζb) leaning into the cavity toward the
  // annulus (tip at level ζt, about halfway to the axis); they move with the wall and thicken in systole
  const paps = new Float64Array(16);
  const papAz = [A.papAzAL, A.papAzPM];
  for (let i = 0; i < 2; i++) {
    const paz = papAz[i]!;
    const zb = zAnn + A.papZetaBase * lengthNow;
    const zt = zAnn + A.papZetaTip * lengthNow;
    const rb = lvCavityRadius(sh, prof, paz, zb) + 0.25;
    const rt = lvCavityRadius(sh, prof, paz, zt) * A.papTipFrac;
    const grow = 0.9 + 0.3 * state.contraction;
    paps.set([rb * Math.cos(paz), rb * Math.sin(paz), zb, rt * Math.cos(paz), rt * Math.sin(paz), zt, A.papR * grow, A.papR * 0.65 * grow], i * 8);
  }
  // RV anterior papillary muscle: cone from the free wall at the moderator-band insertion toward the tricuspid
  const rvPap = new Float64Array(8);
  {
    const zb = zAnn + A.rvPapZetaBase * lengthNow;
    const zt = zAnn + A.rvPapZetaTip * lengthNow;
    rvRadii(m, A, prof, thickK, zAnn, lengthNow, tvZ, state.contraction, septalShiftCm, rvCollapse, A.rvPapAz, zb, rvRad);
    const rb = rvRad[2]! + 0.15;
    rvRadii(m, A, prof, thickK, zAnn, lengthNow, tvZ, state.contraction, septalShiftCm, rvCollapse, A.rvPapAz + 0.1, zt, rvRad);
    const rt = rvRad[0]! + 0.5 * (rvRad[2]! - rvRad[0]!);
    const grow = 0.9 + 0.3 * state.contraction;
    rvPap.set([rb * Math.cos(A.rvPapAz), rb * Math.sin(A.rvPapAz), zb, rt * Math.cos(A.rvPapAz + 0.1), rt * Math.sin(A.rvPapAz + 0.1), zt, 0.42 * grow, 0.28 * grow]);
  }
  // chordae: from the mitral leaflet free edges (anterior at φ = 45°/135°, posterior at −45°/−135°) to the papillary tips
  const pa: [number, number, number] = [paps[3]!, paps[4]!, paps[5]!],
    pm: [number, number, number] = [paps[11]!, paps[12]!, paps[13]!];
  const chordae = new Float64Array(4 * 6);
  const tipOf = (prof: Float64Array, phi: number): [number, number, number] => [mv.cx + prof[6]! * Math.cos(phi), mv.cy + prof[6]! * Math.sin(phi), mv.cz + prof[7]!];
  const chordDefs: [Float64Array, number, [number, number, number]][] = [
    [mv.profA, Math.PI * 0.25, pa],
    [mv.profA, Math.PI * 0.75, pm],
    [mv.profP, -Math.PI * 0.25, pa],
    [mv.profP, -Math.PI * 0.75, pm],
  ];
  for (let i = 0; i < 4; i++) {
    const [prof, phi, e] = chordDefs[i]!;
    const t = tipOf(prof, phi);
    chordae.set([t[0], t[1], t[2], e[0], e[1], e[2]], i * 6);
  }
  const valves: ValveGeometry = {
    segs,
    mv,
    tv,
    mvThickness: m.anatomy.mitral.thickeningCm,
    cuspOffsets,
    cuspWidths,
    cuspCount: cusps,
    cuspHalf: A.avR * Math.sin(Math.PI / cusps) * 0.95,
    cuspSegLen,
    cuspThickness: m.anatomy.aorticValve.cuspThicknessCm,
    chordae,
    chordaeCount: 4,
    pvSegs,
    pvWidths,
    pvHalf: A.pvR * Math.sin(Math.PI / 3) * 0.95,
    pvSegLen,
    pvThickness: 0.06,
    mvRing: [A.mvCenter.x, A.mvCenter.y, zAnn, A.mvR * 0.98],
    tvRing: [A.tvCenter.x, A.tvCenter.y, A.tvCenter.z + tvZ, A.tvR * 0.98],
  };
  return {
    state,
    zAnn,
    rMax,
    prof,
    thickK,
    lengthNow,
    radialScale,
    longScale,
    paps,
    rvPap,
    mvAngleAnt,
    mvAnglePost,
    avOpenAngle,
    tvAngleAnt,
    tvAnglePost,
    rvScale: 1 - 0.3 * state.contraction,
    tvZ: m.physiology.tapseCm * long,
    laBooster: 1 - 0.06 * state.atrialContraction,
    effusion: m.anatomy.pericardium.effusionCm,
    rvCollapse,
    raCollapse: tamp * raCollapseWindow(state),
    swingX: tamp * 0.45 * Math.sin(TWO_PI * state.phase),
    septalShiftCm,
    valves,
  };
}

// ---- Fixed anatomical anchor points (heart frame, ED), scaled by LV size where sensible ----
interface Anchors {
  mvCenter: Vec3;
  mvR: number;
  avCenter: Vec3;
  avAxis: Vec3;
  avR: number;
  sinusR: number;
  ascR: number;
  laCenter: Vec3;
  laR: Vec3;
  raCenter: Vec3;
  raR: Vec3;
  rvCenter: Vec3;
  rvR: Vec3;
  /** RV crescent: maximal thickness (A4C basal diameter), azimuth span (rad, through π) and apex level (fraction of L). */
  rvT: number;
  rvAzA: number;
  rvAzP: number;
  rvApexFrac: number;
  tvCenter: Vec3;
  tvR: number;
  rvotA: Vec3; // infundibulum entry (RV anterior base)
  rvotM: Vec3; // outflow mid point (bowed anteriorly over the aortic root)
  rvotB: Vec3; // pulmonary valve plane
  rvotRa: number; // proximal (infundibular) radius
  rvotRm: number;
  rvotR: number; // distal radius at the valve
  paDir: Vec3;
  paEnd: Vec3; // bifurcation of the trunk
  paR: number;
  rpaEnd: Vec3; // right pulmonary artery (runs to the patient's right, behind the ascending aorta)
  rpaR: number;
  lpaEnd: Vec3;
  lpaR: number;
  pvR: number; // pulmonary annulus radius
  /** RV anterior papillary muscle (moderator-band insertion): azimuth and level fractions of root and tip. */
  rvPapAz: number;
  rvPapZetaBase: number;
  rvPapZetaTip: number;
  /** Papillary muscles: azimuth of each, level fractions of the wall root and of the tip, tip radius fraction, radius. */
  papAzAL: number;
  papAzPM: number;
  papZetaBase: number;
  papZetaTip: number;
  papTipFrac: number;
  papR: number;
}

function anchors(m: HeartModel): Anchors {
  const a = m.anatomy;
  const L = m.lv.lengthCm;
  // Atria: ellipsoids scaled from the case volume (maximal volume, end-systole) with the proportions of a
  // normal LA (AP < transverse < long) and RA; the long axis follows the annulus (reservoir stretch).
  const laK = Math.cbrt(a.la.volumeMl / 48);
  const laRx = 2.4 * laK,
    laRy = 1.8 * laK,
    laRz = 2.55 * laK;
  const raK = Math.cbrt(a.ra.volumeMl / 44);
  const raR = 2.2 * raK;
  const rvR = a.rv.basalDiameterCm / 2;
  // LV hypertrophy must not crush the right heart: the RV/RVOT anchors move with the septal thickness
  const dWall = (a.lv.ivsdCm - 0.9) * 1.5;
  const paDir = normalize(v3(0.6, 0.35, -0.72));
  const paEnd = v3(-0.6 + paDir.x * 3.6, 5.7 + dWall + paDir.y * 3.6, -2.6 + paDir.z * 3.6);
  // torso directions in the heart frame: the pulmonary branches run horizontally in the patient
  const f = m.frame;
  const dirH = (d: Vec3): Vec3 => v3(dot(d, f.ex), dot(d, f.ey), dot(d, f.ez));
  const tRight = dirH(v3(-1, 0, 0)),
    tLeft = dirH(v3(1, 0, 0)),
    tPost = dirH(v3(0, 0, -1)),
    tSup = dirH(v3(0, 1, 0));
  return {
    mvCenter: v3(0.2, -0.9, 0),
    mvR: a.mitral.annulusDiameterCm / 2,
    avCenter: v3(-0.7, 1.35, -0.25),
    avAxis: AV_AXIS,
    avR: a.aorta.annulusCm / 2,
    sinusR: a.aorta.sinusCm / 2,
    ascR: a.aorta.ascendingCm / 2,
    // both atria hang from the interatrial plane (x ≈ −2.3) so that enlarging one never swallows the septum
    laCenter: v3(-2.15 + laRx * 0.94, -1.3, -laRz * 0.85),
    laR: v3(laRx, laRy, laRz * 0.88),
    raCenter: v3(-2.5 - raR * 0.95 * 0.94, -0.5 - raR * 0.1, -raR * 0.6 + 0.05),
    raR: v3(raR * 0.95, raR * 0.85, raR * 0.82),
    // RV modelled as a large ellipsoid carved by the LV epicardium → crescent wrapping the septum;
    // it reaches medially (RV/LV basal ratio ≈ 0.6 in A4C) and its apex sits ~0.85 of the LV length
    // RV as a crescent wrapped around the septum between the interventricular grooves (see rvCrescent);
    // rvCenter/rvR only bound it (ghost overlay, coarse tools)
    rvCenter: v3(-(m.lv.rMax + a.lv.ivsdCm + 1.1 * rvR), -0.1, L * 0.4),
    rvR: v3(1.1 * rvR + 0.4, 1.1 * rvR + 1.6, L * 0.46),
    rvT: a.rv.basalDiameterCm,
    rvAzA: 1.6, // anterior interventricular groove (92°: junction of the anterior and anteroseptal segments)
    rvAzP: 3.7, // inferior (posterior) interventricular groove (212°: junction of the inferoseptal and inferior segments)
    rvApexFrac: Math.min(0.9, Math.max(0.7, (a.rv.lengthCm + 0.8) / L)),
    // tricuspid annulus: its medial edge sits on the RV side of the septum, whatever the LV size or wall thickness
    // the tricuspid annulus is ~0.7 cm more apical than the mitral (normal apical offset 0.5–1 cm)
    tvCenter: v3(-(m.lv.rMax * lvProfileG(m.lv.shape, 0.12) + a.lv.ivsdCm + 0.25 + a.tricuspid.annulusDiameterCm / 2), -0.2, 0.7),
    tvR: a.tricuspid.annulusDiameterCm / 2,
    rvotA: v3(-2.8, 3.6 + dWall, 0.3),
    rvotM: v3(-1.95, 5.0 + dWall, -1.1),
    rvotB: v3(-0.6, 5.7 + dWall, -2.6),
    rvotRa: 1.3,
    rvotRm: 1.2,
    rvotR: 1.1,
    paDir,
    paEnd,
    paR: 1.15,
    rpaEnd: add(paEnd, scale(normalize(add(tRight, scale(tPost, 0.45))), 4.4)),
    rpaR: 0.8,
    lpaEnd: add(paEnd, scale(normalize(add(add(tLeft, scale(tPost, 0.6)), scale(tSup, 0.2))), 3.0)),
    lpaR: 0.75,
    pvR: 1.05,
    rvPapAz: 2.35,
    rvPapZetaBase: 0.68,
    rvPapZetaTip: 0.46,
    // papillary azimuths (model frame = AHA − 28°): anterolateral at the lateral wall (AHA ≈ 0°, 3 o'clock in
    // PSAX), posteromedial at the inferior / inferoseptal junction (AHA ≈ 250°, 7–8 o'clock)
    papAzAL: -0.5,
    papAzPM: -2.4,
    papZetaBase: 0.72,
    papZetaTip: 0.42,
    papTipFrac: 0.5,
    papR: 0.55,
  };
}

/** Landmark used by the view-recognition engine (heart frame at ED). */
export interface Landmark {
  id: string;
  label: string;
  p: Vec3; // heart frame
  radius: number; // tolerance radius for "in plane" tests (cm)
}

export function heartLandmarks(m: HeartModel): Landmark[] {
  const A = anchors(m);
  const L = m.lv.lengthCm;
  const a = m.lv.rMax * lvProfileG(m.lv.shape, 0.45) + 0.45, // mid-wall radius at the mid level
    b = a * m.lv.shape.ratio;
  const rvc = A.rvCenter;
  const papAt = (az: number): Vec3 => {
    const z = L * 0.57;
    const r = lvCavityRadius(m.lv.shape, m.lv.edProfile, az, z) * 0.78;
    return v3(r * Math.cos(az), r * Math.sin(az), z);
  };
  return [
    { id: 'lv-apex', label: 'Ápex VI', p: v3(0, 0, L - 0.3), radius: 0.8 },
    { id: 'lv-apical-cavity', label: 'Cavidad apical VI', p: v3(0, 0, L * 0.8), radius: 0.9 },
    { id: 'lv-mid', label: 'Cavidad VI (mitad)', p: v3(0, 0, L * 0.5), radius: 1.2 },
    { id: 'mv', label: 'Válvula mitral', p: v3(0.2, -0.9, 0.7), radius: 1.2 },
    { id: 'av', label: 'Válvula aórtica', p: A.avCenter, radius: 1.0 },
    { id: 'lvot', label: 'TSVI', p: add(A.avCenter, scale(A.avAxis, -0.55)), radius: 0.9 },
    { id: 'aortic-root', label: 'Raíz aórtica', p: add(A.avCenter, scale(A.avAxis, 2.2)), radius: 1.1 },
    { id: 'la', label: 'Aurícula izquierda', p: A.laCenter, radius: 1.5 },
    { id: 'ra', label: 'Aurícula derecha', p: A.raCenter, radius: 1.4 },
    { id: 'rv', label: 'Ventrículo derecho (entrada)', p: v3(rvc.x, -0.35, L * 0.35), radius: 1.3 },
    { id: 'pa', label: 'Tronco pulmonar', p: add(A.rvotB, scale(A.paDir, 1.5)), radius: 1.0 },
    { id: 'pa-bifurcation', label: 'Bifurcación pulmonar', p: A.paEnd, radius: 1.0 },
    { id: 'rv-anterior', label: 'Ventrículo derecho (anterior)', p: v3((a + 0.6) * Math.cos(2.1), (b + 0.6) * Math.sin(2.1) + 0.5, L * 0.35), radius: 0.9 },
    { id: 'rvot', label: 'TSVD', p: v3(-1.7, 4.7, -1.2), radius: 1.0 },
    { id: 'tv', label: 'Válvula tricúspide', p: v3(A.tvCenter.x, A.tvCenter.y, A.tvCenter.z + 0.7), radius: 1.2 },
    { id: 'ivs-anteroseptal', label: 'Septum anteroseptal', p: v3(-a * 0.5, b * 0.87, L * 0.45), radius: 0.9 },
    { id: 'ivs-inferoseptal', label: 'Septum inferoseptal', p: v3(-a * 1.0, -b * 0.1, L * 0.45), radius: 0.9 },
    { id: 'wall-inferolateral', label: 'Pared inferolateral', p: v3(a * 0.5, -b * 0.87, L * 0.45), radius: 0.9 },
    { id: 'wall-anterolateral', label: 'Pared anterolateral', p: v3(a * 1.0, b * 0.1, L * 0.45), radius: 0.9 },
    // A2C walls lie 60° from the A4C plane (AHA: anterior at 90°, anterolateral at 30°; here A4C is at 2°)
    { id: 'wall-anterior', label: 'Pared anterior', p: v3(a * 0.469, b * 0.883, L * 0.45), radius: 0.9 },
    { id: 'wall-inferior', label: 'Pared inferior', p: v3(-a * 0.469, -b * 0.883, L * 0.45), radius: 0.9 },
    { id: 'pap-al', label: 'Papilar anterolateral', p: papAt(A.papAzAL), radius: 0.7 },
    { id: 'desc-aorta', label: 'Aorta descendente', p: v3(1.5, -6.2, -2.5), radius: 1.0 },
    { id: 'pap-pm', label: 'Papilar posteromedial', p: papAt(A.papAzPM), radius: 0.7 },
    { id: 'ias', label: 'Septum interauricular', p: v3(-2.5, -1.6, -2.2), radius: 1.0 },
  ];
}

/**
 * Local LV wall thickness (cm) at azimuth/level: end-diastolic thickness interpolated between the
 * septal and free-wall values, systolic thickening from wall incompressibility scaled by the segment's
 * motion (akinetic segments barely thicken), and a low-frequency modulation around the wall.
 */
function wallThicknessAt(m: HeartModel, thickK: number, az: number, levelFrac: number, amp: number): number {
  const lv = m.lv;
  const septalness = 0.5 - 0.5 * Math.cos(az);
  const tBase = lv.lvpwd + (lv.ivsd - lv.lvpwd) * septalness;
  // end-diastolic thickness: septal / free-wall value over the basal half, tapering to the apical thickness
  const tED = tBase * axialWallFactor(levelFrac, lv.apexT / tBase);
  // low-frequency thickness modulation (±14 % at the base, fading to none at the apical cap)
  const wallMod = 1 + 0.28 * (latticeNoise3(Math.cos(az) * 1.6 + 7.3, Math.sin(az) * 1.6 + 2.1, levelFrac * 2.4, m.wallNoise) - 0.5) * (1 - levelFrac * levelFrac);
  return tED * Math.max(0.6, 1 + (thickK - 1) * (0.35 + 0.65 * amp)) * wallMod;
}

/** Septal shift toward the LV (cm) at azimuth/level: maximal at the mid septum, zero at the free wall, base and apex. */
function septalShiftAt(shiftCm: number, az: number, levelFrac: number): number {
  if (shiftCm <= 0) return 0;
  const c = -Math.cos(az); // 1 at the septum (az = π)
  if (c <= 0) return 0;
  const zw = 1 - Math.pow((levelFrac - 0.45) / 0.45, 2);
  if (zw <= 0) return 0;
  return shiftCm * c * c * zw;
}

const rvTmp = new Float64Array(3);
const rvRad = new Float64Array(4);

/** RV crescent azimuthal profile over u ∈ (0, 1) between the grooves: rounded tips, plateau, fullest at the inflow (A4C direction). */
function rvAzProfile(A: AnchorsCached, u: number): number {
  const sn = Math.sin(Math.PI * u);
  const uIn = (Math.PI + 0.04 - A.rvAzA) / (A.rvAzP - A.rvAzA);
  const inflow = Math.exp(-((u - uIn) * (u - uIn)) / (2 * 0.18 * 0.18));
  return Math.pow(Math.min(1, Math.max(0, sn) / 0.75), 0.7) * (0.85 + 0.15 * inflow);
}

/** Triangular axial taper of the RV from the tricuspid plane (1) to a rounded apex (0 at zApex); 0.85 in the infundibulum above the plane. */
function rvAxialTaper(tvPlane: number, zApex: number, z: number): number {
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
function rvRadii(m: HeartModel, A: AnchorsCached, prof: LvProfileTable, thickK: number, zAnn: number, lengthNow: number, tvZ: number, contraction: number, septalShiftCm: number, rvCollapse: number, az: number, z: number, res: Float64Array): void {
  const L = m.lv.lengthCm;
  const sh = m.lv.shape;
  const azN = az < 0 ? az + TWO_PI : az;
  const u = (azN - A.rvAzA) / (A.rvAzP - A.rvAzA);
  const rCav = lvCavityRadius(sh, prof, az, z);
  const levelFrac = Math.min(1, Math.max(0, (z - zAnn) / Math.max(lengthNow, 1)));
  const amp = m.segAmp[ahaSegment(az, levelFrac)] ?? 1;
  const rEpi = rCav + wallThicknessAt(m, thickK, az, levelFrac, amp) * lvRadialOffsetFactor(sh, prof, az, z);
  const rIn = rEpi - septalShiftAt(septalShiftCm, az, levelFrac) + 0.05;
  res[0] = rIn;
  res[1] = u;
  if (u <= 0 || u >= 1) {
    res[2] = rIn;
    res[3] = 0;
    return;
  }
  const tvPlane = A.tvCenter.z + tvZ;
  let t = A.rvT * rvAzProfile(A, u) * rvAxialTaper(tvPlane, A.rvApexFrac * L, z) * (1 - 0.35 * contraction);
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
function rvCrescent(m: HeartModel, hp: HeartPose, A: AnchorsCached, x: number, y: number, z: number, az: number, res: Float64Array): void {
  rvRadii(m, A, hp.prof, hp.thickK, hp.zAnn, hp.lengthNow, hp.tvZ, hp.state.contraction, hp.septalShiftCm, hp.rvCollapse, az, z, rvRad);
  const rIn = rvRad[0]!,
    u = rvRad[1]!;
  if (u <= 0 || u >= 1) {
    res[0] = 1e3;
    res[1] = rIn;
    res[2] = rIn;
    return;
  }
  const L = m.lv.lengthCm;
  const tvPlane = A.tvCenter.z + hp.tvZ;
  const zApex = A.rvApexFrac * L;
  // basal boundary: tricuspid plane for the inflow, rising smoothly into the infundibulum for the anterior third
  const uInf = 0.35;
  const zBase = u >= uInf ? tvPlane : tvPlane - 2.6 * (1 - u / uInf);
  let t = rvRad[3]!;
  // trabeculae: longitudinal ridges that coarsen toward the apex, where the mesh narrows the cavity
  if (z > 0.25 * L) {
    const w = Math.min(1, (z - 0.25 * L) / (0.35 * L));
    const rs = 1 - 0.3 * hp.state.contraction;
    const n = latticeNoise3((x / rs) * 1.4 + 3.1, (y / rs) * 1.4 + 9.7, z * 0.9 + 5.3, m.wallNoise) - 0.5;
    t += (0.25 + 0.25 * w) * n - 0.12 * w * w;
  }
  const rOut = rIn + Math.max(0, t);
  const r = Math.hypot(x, y);
  res[0] = Math.max(rIn - r, r - rOut, zBase - z, z - zApex);
  res[1] = rIn;
  res[2] = rOut;
}

/**
 * Classify a heart-frame point. Writes into `out` and returns true when the point belongs to a
 * cardiac structure (including pericardium/effusion); false when outside the heart.
 */
export function classifyHeart(m: HeartModel, hp: HeartPose, x0: number, y: number, z: number, out: TissueSample): boolean {
  // swinging heart (tamponade): rigid translation of the whole heart inside the pericardial sac
  const x = x0 - hp.swingX;
  const bc = m.boundCenter;
  const bdx = x - bc.x,
    bdy = y - bc.y,
    bdz = z - bc.z;
  if (bdx * bdx + bdy * bdy + bdz * bdz > m.boundRadius * m.boundRadius) return false;

  const A = anchorsCached(m);
  const lv = m.lv;
  const zAnn = hp.zAnn;

  // ---------- Aortic root coordinates (tube along avAxis; also carves the LV base) ----------
  let rootT = -99,
    rootRr = 0,
    rootR = 0,
    rootQx = 0,
    rootQy = 0,
    rootQz = 0;
  {
    const c = A.avCenter;
    const ax = A.avAxis;
    const czz = c.z + zAnn * 0.5;
    const dx = x - c.x,
      dy = y - c.y,
      dz = z - czz;
    const t = dx * ax.x + dy * ax.y + dz * ax.z; // along axis, 0 at annulus, negative toward LV
    if (t > -1.6 && t < 6.5) {
      // the ascending aorta curves toward the patient's right/anterior beyond the sinotubular junction
      // (it leaves the long-axis plane after ~3 cm instead of running straight for 7 cm)
      const bend = t > 3 ? 0.16 * (t - 3) * (t - 3) : 0;
      rootQx = dx - ax.x * t - A.avBend.x * bend;
      rootQy = dy - ax.y * t - A.avBend.y * bend;
      rootQz = dz - ax.z * t - A.avBend.z * bend;
      rootRr = Math.sqrt(rootQx * rootQx + rootQy * rootQy + rootQz * rootQz);
      rootT = t;
      // radius profile: LVOT (t<0) → annulus → sinuses (t≈1) → STJ → ascending
      if (t < 0) rootR = A.avR * 0.95 + (m.anatomy.aorta.lvotDiameterCm / 2 - A.avR * 0.95) * Math.min(1, -t / 1.2);
      else if (t < 2.2) rootR = A.avR + (A.sinusR - A.avR) * Math.sin((Math.PI * t) / 2.2);
      else if (t < 3.2) rootR = Math.min(A.ascR, A.sinusR * 0.88); // sinotubular junction
      else rootR = A.ascR;
    }
  }
  // the aortic lumen from the annulus upward is never LV wall or fibrous skeleton
  const inRootLumen = rootT >= -0.05 && rootRr < rootR;

  // ---------- Valves, annuli and chordae (thin, highest priority) ----------
  const V = hp.valves;
  const hit = chainHit;
  // mitral skirt (two leaflet zones blended around the annulus)
  {
    const t = skirtDistance(x, y, z, V.mv);
    if (skirtHit.d < t) {
      const dxm = x - V.mv.cx,
        dym = y - V.mv.cy;
      const rr = Math.hypot(dxm, dym) || 1;
      const anterior = dym > 0;
      // normal ≈ radial in-plane blended with z (leaflet mostly hangs apically when open, lies flatter when closed)
      setSample(out, Tissue.Valve, skirtHit.d - t, dxm / rr, dym / rr, 0.8, x, y, z, m.anatomy.mitral.calcification, anterior ? Structure.MitralAnterior : Structure.MitralPosterior);
      return true;
    }
  }
  // aortic cusps
  for (let i = 0; i < V.cuspCount; i++) {
    const wx = V.cuspWidths[i * 3]!,
      wy = V.cuspWidths[i * 3 + 1]!,
      wz = V.cuspWidths[i * 3 + 2]!;
    sdSegmentChain(x, y, z, V.segs, V.cuspOffsets[i]!, 2, V.cuspSegLen, wx, wy, wz, V.cuspHalf, hit, 0.75);
    const t = V.cuspThickness * (1 - 0.3 * hit.frac) * 0.5 + 0.03;
    if (hit.d < t && rootRr < rootR + 0.02) {
      const o = V.cuspOffsets[i]! + Math.min(1, Math.floor(hit.frac * 2)) * 6;
      const dx = V.segs[o + 3]!,
        dy = V.segs[o + 4]!,
        dz = V.segs[o + 5]!;
      setSample(out, Tissue.Valve, hit.d - t, dy * wz - dz * wy, dz * wx - dx * wz, dx * wy - dy * wx, x, y, z, m.anatomy.aorticValve.calcification, Structure.AorticValve);
      return true;
    }
  }
  // aortic coaptation zones: when the valve is closed the three cusps meet along radial lines (Y sign in
  // PSAX-AV, thin closure line in PLAX/A5C); modelled as three radial fins between belly and free edge
  if (hp.state.avOpen < 0.2 && rootT > 0 && rootRr < rootR * 0.97) {
    const finLo = A.avR * 0.45,
      finHi = A.avR * 1.05;
    if (rootT > finLo && rootT < finHi) {
      const e1 = A.avE1,
        e2 = A.avE2;
      const u1 = rootQx * e1.x + rootQy * e1.y + rootQz * e1.z;
      const u2 = rootQx * e2.x + rootQy * e2.y + rootQz * e2.z;
      const phi = fastAtan2(u2, u1);
      const n = V.cuspCount;
      let dphi = ((phi - Math.PI / n) % (TWO_PI / n) + TWO_PI / n) % (TWO_PI / n);
      if (dphi > Math.PI / n) dphi = TWO_PI / n - dphi;
      const dist = rootRr * Math.sin(dphi);
      const fade = 1 - (1 - hp.state.avOpen / 0.2) * 0; // fins exist only while nearly closed
      if (dist < 0.04 * fade) {
        setSample(out, Tissue.Valve, dist - 0.04, e1.x, e1.y, e1.z, x, y, z, m.anatomy.aorticValve.calcification, Structure.AorticValve);
        return true;
      }
    }
  }
  // pulmonary cusps (three, hinged at the outflow–trunk junction; clipped to the trunk lumen)
  if (sdCapsule(x, y, z, A.rvotM.x, A.rvotM.y, A.rvotM.z, A.paEnd.x, A.paEnd.y, A.paEnd.z, A.paR + 0.02) < 0) {
    for (let i = 0; i < 3; i++) {
      const wx = V.pvWidths[i * 3]!,
        wy = V.pvWidths[i * 3 + 1]!,
        wz = V.pvWidths[i * 3 + 2]!;
      sdSegmentChain(x, y, z, V.pvSegs, i * 12, 2, V.pvSegLen, wx, wy, wz, V.pvHalf, hit, 0.75);
      const t = V.pvThickness * (1 - 0.3 * hit.frac) * 0.5 + 0.03;
      if (hit.d < t) {
        const o = i * 12 + Math.min(1, Math.floor(hit.frac * 2)) * 6;
        const dx = V.pvSegs[o + 3]!,
          dy = V.pvSegs[o + 4]!,
          dz = V.pvSegs[o + 5]!;
        setSample(out, Tissue.Valve, hit.d - t, dy * wz - dz * wy, dz * wx - dx * wz, dx * wy - dy * wx, x, y, z, 0, Structure.PulmonaryValve);
        return true;
      }
    }
  }
  // tricuspid skirt
  {
    const t = skirtDistance(x, y, z, V.tv);
    if (skirtHit.d < t) {
      const dxt = x - V.tv.cx,
        dyt = y - V.tv.cy;
      const rr = Math.hypot(dxt, dyt) || 1;
      setSample(out, Tissue.Valve, skirtHit.d - t, dxt / rr, dyt / rr, 0.8, x, y, z, 0, Structure.TricuspidValve);
      return true;
    }
  }
  // fibrous annuli (bright hinge points in long-axis views)
  {
    const r = V.mvRing;
    const dR = sdTorusZ(x, y, z - saddleOffset(fastAtan2(y - r[1], x - r[0]), V.mv.phiA, V.mv.saddle), r[0], r[1], r[2], r[3], 0.11);
    if (dR < 0) {
      setSample(out, Tissue.Fibrous, dR, x - r[0], y - r[1], 0, x, y, z, 0.15 * m.anatomy.mitral.calcification, Structure.MitralAnnulus);
      return true;
    }
    const q = V.tvRing;
    const dT = sdTorusZ(x, y, z - saddleOffset(fastAtan2(y - q[1], x - q[0]), V.tv.phiA, V.tv.saddle), q[0], q[1], q[2], q[3], 0.09);
    if (dT < 0) {
      setSample(out, Tissue.Fibrous, dT, x - q[0], y - q[1], 0, x, y, z, 0, Structure.TricuspidAnnulus);
      return true;
    }
  }
  // chordae tendineae (thin, only visible when in plane)
  for (let i = 0; i < V.chordaeCount; i++) {
    const o = i * 6;
    const c = V.chordae;
    const d = sdCapsule(x, y, z, c[o]!, c[o + 1]!, c[o + 2]!, c[o + 3]!, c[o + 4]!, c[o + 5]!, 0.045);
    if (d < 0) {
      setSample(out, Tissue.Chordae, d, 0, 0, 1, x, y, z, 0, Structure.Chordae);
      return true;
    }
  }

  // ---------- LV cavity & wall ----------
  // local wall thickness by azimuth (septal thicker if IVS > PW) & level, regional motion by segment
  const az = fastAtan2(y, x);
  const levelFrac = Math.min(1, Math.max(0, (z - zAnn) / Math.max(hp.lengthNow, 1)));
  // septal flattening (D-shape): the septum is pushed toward the LV centre by the RV; the LV ellipsoids are
  // evaluated at x − shift so that both endocardium and epicardium move (the RV crescent uses the same shift)
  const septalShift = septalShiftAt(hp.septalShiftCm, az, levelFrac);
  const xs = x - septalShift;
  const sh = lv.shape;
  const dProf = lvCavitySdf(hp.prof, sh.ratio, xs, y, z);
  const nx0 = lvSdfNormal[0]!,
    ny0 = lvSdfNormal[1]!,
    nz0 = lvSdfNormal[2]!;
  // clip at annulus plane (z ≥ zAnn) with a smooth max
  const dCav = smax(dProf, zAnn - z, 0.6);
  const seg = ahaSegment(az, levelFrac);
  const amp = m.segAmp[seg] ?? 1;
  // Regional wall motion: an akinetic segment keeps its end-diastolic radius → local cavity SDF shifted outward
  const regional = amp < 1 ? (1 - amp) * (lv.rMax - hp.rMax) * lvProfileG(sh, levelFrac) : 0;
  const rsc = hp.radialScale;
  const lsc = hp.longScale;
  // trabeculation: rough endocardium with longitudinal ridges (material coordinates, so it moves with the
  // wall), growing from the mid cavity to the apex
  const trab = levelFrac > 0.45 ? 0.2 * Math.min(1, (levelFrac - 0.45) / 0.35) * (latticeNoise3((x / rsc) * 2.6 + 11.3, (y / rsc) * 2.6 + 2.9, ((z - lv.lengthCm) / lsc) * 1.1 + 6.1, m.wallNoise) - 0.5) : 0;
  const dCavR = dCav - regional + trab;
  // wall thickness: interpolate septal (az≈π, i.e. x<0) vs free wall
  const septalness = 0.5 - 0.5 * Math.cos(az); // 1 at septum (az=π), 0 at lateral
  const tNow = wallThicknessAt(m, hp.thickK, az, levelFrac, amp);

  // Papillary muscles inside the cavity (round cones rooted in the wall, see computeHeartPose)
  if (dCavR < 0) {
    const P = hp.paps;
    const dPa = sdRoundCone(x, y, z, P[0]!, P[1]!, P[2]!, P[3]!, P[4]!, P[5]!, P[6]!, P[7]!);
    const dPm = sdRoundCone(x, y, z, P[8]!, P[9]!, P[10]!, P[11]!, P[12]!, P[13]!, P[14]!, P[15]!);
    const dPap = Math.min(dPa, dPm);
    if (dPap < 0) {
      setSample(out, Tissue.Myocardium, dPap, x, y, 0, x / rsc, y / rsc, z / lsc, 0, Structure.PapillaryMuscle);
      return true;
    }
    // LV blood
    setSample(out, Tissue.Blood, dCavR, nx0, ny0, nz0, x / rsc, y / rsc, (z - lv.lengthCm) / lsc, 0, Structure.LvCavity);
    return true;
  }
  const wallT = tNow;
  // Ventricular wall: shell of local thickness around the *unclipped* profile, apical to (slightly above)
  // the annulus. The annular plane itself is not a wall: it holds the mitral orifice, the LVOT and fibrous tissue.
  const dEllR = dProf - regional;
  // the trabeculated inner surface belongs to the wall: from the rough endocardium to the smooth epicardium
  if (dEllR + trab >= 0 && dEllR < wallT && z >= zAnn - 0.25 && !inRootLumen) {
    let structure = Structure.LvWallLateral;
    if (z > lv.lengthCm - 0.6) structure = Structure.LvApex;
    else if (septalness > 0.7) structure = Structure.LvWallSeptal;
    else if (Math.sin(az) > 0.5) structure = Structure.LvWallAnterior;
    else if (Math.sin(az) < -0.5) structure = Structure.LvWallInferior;
    const dIn = -Math.min(dEllR, wallT - dEllR);
    const nearEpi = wallT - dEllR < dEllR;
    const sign = nearEpi ? 1 : -1;
    setSample(out, Tissue.Myocardium, dIn, sign * nx0, sign * ny0, sign * nz0, x / rsc, y / rsc, (z - lv.lengthCm) / lsc, 0, structure);
    return true;
  }
  // Annular plane region (inside the ellipsoid but basal to the annulus): mitral orifice is blood
  // continuous with the LA; the LVOT is handled by the aortic tube below; the rest is fibrous tissue.
  const inAnnularRegion = dEllR < 0 && z < zAnn && !inRootLumen;
  if (inAnnularRegion) {
    const mdx = x - A.mvCenter.x,
      mdy = y - A.mvCenter.y;
    // the mitral orifice column basal to the annular plane is atrial blood (the LV ends at the annulus)
    if (Math.hypot(mdx, mdy) < A.mvR * 0.98) {
      setSample(out, Tissue.Blood, -0.3, 0, 0, 1, x, y, z, 0, Structure.LaCavity);
      return true;
    }
  }

  // ---------- Aortic root / LVOT (tube along avAxis) ----------
  if (rootT > -1.6) {
    const t = rootT,
      rr = rootRr,
      R = rootR;
    const wall = 0.2;
    if (rr < R) {
      setSample(out, Tissue.Blood, rr - R, rootQx / rr, rootQy / rr, rootQz / rr, x, y, z - zAnn * 0.5, 0, t < 0 ? Structure.Lvot : Structure.AorticRoot);
      return true;
    }
    if (rr < R + wall) {
      const dIn = -Math.min(rr - R, R + wall - rr);
      setSample(out, Tissue.VesselWall, dIn, rootQx / rr, rootQy / rr, rootQz / rr, x, y, z, 0, Structure.AorticRoot);
      return true;
    }
  }

  if (inAnnularRegion && z > zAnn - 1.2) {
    // aorto-mitral curtain / fibrous skeleton
    setSample(out, Tissue.Fibrous, -0.15, 0, 0, 1, x, y, z, 0, Structure.LvWallSeptal);
    return true;
  }

  // ---------- Atria (lengthen in systole as the annulus descends) ----------
  {
    const la = A.laCenter,
      lr = A.laR;
    const zTop = la.z - lr.z; // fixed superior boundary
    const zBottom = zAnn + 0.25;
    const czL = (zTop + zBottom) / 2,
      rzL = (zBottom - zTop) / 2;
    // reservoir/conduit/booster: radial size follows LV contraction (max at end-systole) and the atrial kick
    const bo = hp.laBooster * (0.84 + 0.16 * hp.state.contraction);
    const d = sdEllipsoid(x, y, z, la.x, la.y, czL, lr.x * bo, lr.y * bo, rzL);
    if (d < 0) {
      setSample(out, Tissue.Blood, d, (x - la.x) / lr.x, (y - la.y) / lr.y, (z - czL) / rzL, x, y, z, 0, Structure.LaCavity);
      return true;
    }
    if (d < 0.25) {
      setSample(out, Tissue.Myocardium, -Math.min(d, 0.25 - d), (x - la.x) / lr.x, (y - la.y) / lr.y, (z - czL) / rzL, x, y, z, 0, Structure.LaWall);
      return true;
    }
    const ra = A.raCenter,
      rr = A.raR;
    const zTopR = ra.z - rr.z;
    const zBotR = A.tvCenter.z + hp.tvZ * 0.7 + 0.25; // the caval junction moves a little with TAPSE
    const czR = (zTopR + zBotR) / 2,
      rzR = (zBotR - zTopR) / 2;
    const raC = 1 - 0.35 * hp.raCollapse; // tamponade: late-diastolic RA collapse
    const dR = sdEllipsoid(x, y, z, ra.x, ra.y, czR, rr.x * bo * raC, rr.y * bo * raC, rzR);
    if (dR < 0) {
      setSample(out, Tissue.Blood, dR, (x - ra.x) / rr.x, (y - ra.y) / rr.y, (z - czR) / rzR, x, y, z, 0, Structure.RaCavity);
      return true;
    }
    if (dR < 0.22) {
      setSample(out, Tissue.Myocardium, -Math.min(dR, 0.22 - dR), (x - ra.x) / rr.x, (y - ra.y) / rr.y, (z - czR) / rzR, x, y, z, 0, Structure.RaWall);
      return true;
    }
    // interatrial septum: tissue bridging the two atria (≈0.4–0.7 cm), continued as a thin plane between
    // the expanded atria so that it is present behind the aortic root (PSAX-AV) as well as in A4C
    if (d < 0.75 && dR < 0.75 && z < zAnn + 0.4) {
      setSample(out, Tissue.Myocardium, -Math.min(0.75 - d, 0.75 - dR), 1, 0, 0, x, y, z, 0, Structure.InteratrialSeptum);
      return true;
    }
    const xIas = (la.x - lr.x + ra.x + rr.x) / 2;
    if (Math.abs(x - xIas) < 0.3 && z < zAnn + 0.4 && sdEllipsoid(x, y, z, la.x, la.y, czL, lr.x + 1.3, lr.y + 0.9, rzL + 0.6) < 0 && sdEllipsoid(x, y, z, ra.x, ra.y, czR, rr.x + 1.3, rr.y + 0.9, rzR + 0.6) < 0) {
      setSample(out, Tissue.Myocardium, -(0.3 - Math.abs(x - xIas)), 1, 0, 0, x, y, z, 0, Structure.InteratrialSeptum);
      return true;
    }
    // left atrial appendage: lobulated pouch on the anterolateral LA, pointing anteriorly (A2C/PSAX-AV)
    {
      const ax0 = la.x + lr.x * 0.55,
        ay0 = la.y + lr.y * 0.55,
        az0 = czL + 0.4;
      const ax1 = la.x + lr.x * 0.95,
        ay1 = ay0 + 2.0,
        az1 = czL + 0.9;
      const lob = 0.12 * (latticeNoise3(x * 2.3 + 1.7, y * 2.3 + 4.2, z * 2.3 + 8.8, m.wallNoise) - 0.5);
      const dApp = sdCapsule(x, y, z, ax0, ay0, az0, ax1, ay1, az1, 0.55 * bo + lob);
      if (dApp < 0) {
        setSample(out, Tissue.Blood, dApp, 0, 1, 0, x, y, z, 0, Structure.LaAppendage);
        return true;
      }
      if (dApp < 0.18) {
        setSample(out, Tissue.Myocardium, -Math.min(dApp, 0.18 - dApp), 0, 1, 0, x, y, z, 0, Structure.LaWall);
        return true;
      }
    }
    // pulmonary veins: four ostia on the posterior LA (two superior, two inferior)
    for (let i = 0; i < 4; i++) {
      const px = la.x + (i % 2 === 0 ? -1 : 1) * lr.x * 0.6;
      const pz = czL + (i < 2 ? -0.7 : 0.6);
      const py0 = la.y - lr.y * 0.8;
      const dPv = sdCapsule(x, y, z, px, py0, pz, px + (i % 2 === 0 ? -0.9 : 0.9), py0 - 1.6, pz + (i < 2 ? -0.5 : 0.4), 0.42);
      if (dPv < 0) {
        setSample(out, Tissue.Blood, dPv, 0, -1, 0, x, y, z, 0, Structure.PulmonaryVein);
        return true;
      }
      if (dPv < 0.12) {
        setSample(out, Tissue.VesselWall, -Math.min(dPv, 0.12 - dPv), 0, -1, 0, x, y, z, 0, Structure.PulmonaryVein);
        return true;
      }
    }
    // coronary sinus: runs in the posterior atrioventricular groove toward the RA (A4C posterior, A2C inferior)
    {
      const gy = -(lvCavityRadius(sh, hp.prof, -Math.PI / 2, zAnn + 0.6) + lv.lvpwd * hp.thickK + 0.4);
      const dCs = sdCapsule(x, y, z, 2.2, gy * 0.85, zAnn + 0.35, ra.x + rr.x * 0.4, gy * 0.7, zAnn + 0.1, 0.33);
      if (dCs < 0) {
        setSample(out, Tissue.Blood, dCs, 0, -1, 0, x, y, z, 0, Structure.CoronarySinus);
        return true;
      }
      if (dCs < 0.1) {
        setSample(out, Tissue.VesselWall, -Math.min(dCs, 0.1 - dCs), 0, -1, 0, x, y, z, 0, Structure.CoronarySinus);
        return true;
      }
    }
  }

  // ---------- RV: crescent around the septum, infundibulum, outflow, pulmonary trunk and branches ----------
  {
    const s = hp.state.contraction;
    rvCrescent(m, hp, A, x, y, z, az, rvTmp);
    const dRv = rvTmp[0]!;
    const fw = m.anatomy.rv.freeWallThicknessCm * (1 + 0.35 * s);
    const k = 0.85 + 0.15 * (1 - s);
    // outflow: infundibulum → subpulmonary region as two tapering segments bowed anteriorly over the aortic root
    const dRvot = Math.min(
      sdRoundCone(x, y, z, A.rvotA.x, A.rvotA.y, A.rvotA.z, A.rvotM.x, A.rvotM.y, A.rvotM.z, A.rvotRa * k, A.rvotRm * k),
      sdRoundCone(x, y, z, A.rvotM.x, A.rvotM.y, A.rvotM.z, A.rvotB.x, A.rvotB.y, A.rvotB.z, A.rvotRm * k, A.rvotR * k),
    );
    // pulmonary trunk from the valve to the bifurcation; right branch behind the ascending aorta, left branch
    const dPa = sdCapsule(x, y, z, A.rvotB.x, A.rvotB.y, A.rvotB.z, A.paEnd.x, A.paEnd.y, A.paEnd.z, A.paR);
    const dRpa = sdCapsule(x, y, z, A.paEnd.x, A.paEnd.y, A.paEnd.z, A.rpaEnd.x, A.rpaEnd.y, A.rpaEnd.z, A.rpaR);
    const dLpa = sdCapsule(x, y, z, A.paEnd.x, A.paEnd.y, A.paEnd.z, A.lpaEnd.x, A.lpaEnd.y, A.lpaEnd.z, A.lpaR);
    const dTrunk = Math.min(dPa, dRpa, dLpa);
    const vx = x - A.rvotB.x,
      vy = y - A.rvotB.y,
      vz = z - A.rvotB.z;
    if (dTrunk < 0) {
      setSample(out, Tissue.Blood, dTrunk, vx, vy, vz, x, y, z, 0, Structure.PulmonaryArtery);
      return true;
    }
    if (dTrunk < 0.18 && dRvot > 0) {
      setSample(out, Tissue.VesselWall, -Math.min(dTrunk, 0.18 - dTrunk), vx, vy, vz, x, y, z, 0, Structure.PulmonaryArtery);
      return true;
    }
    const dCavRv = Math.min(dRv, dRvot);
    if (dCavRv < 0) {
      if (dRv < 0) {
        // moderator band: from the lower septum to the anterior free wall at the base of the anterior papillary muscle
        const L = m.lv.lengthCm;
        const rIn = rvTmp[1]!;
        const rOut = rvTmp[2]!;
        const bx0 = -(rIn + 0.12),
          by0 = -0.2,
          bz0 = L * 0.6;
        const rB = rOut - fw * 1.2;
        const bx1 = rB * Math.cos(A.rvPapAz),
          by1 = rB * Math.sin(A.rvPapAz),
          bz1 = L * 0.68;
        const dBand = sdCapsule(x, y, z, bx0, by0, bz0, bx1, by1, bz1, 0.28);
        if (dBand < 0) {
          setSample(out, Tissue.Myocardium, dBand, 0, 0, 1, x, y, z, 0, Structure.ModeratorBand);
          return true;
        }
        const P = hp.rvPap;
        const dRp = sdRoundCone(x, y, z, P[0]!, P[1]!, P[2]!, P[3]!, P[4]!, P[5]!, P[6]!, P[7]!);
        if (dRp < 0) {
          setSample(out, Tissue.Myocardium, dRp, x, y, 0, x, y, z, 0, Structure.RvPapillary);
          return true;
        }
      }
      const rr = Math.hypot(x, y) || 1;
      setSample(out, Tissue.Blood, dCavRv, x / rr, y / rr, 0, x / (1 - 0.3 * s), y / (1 - 0.3 * s), z, 0, dRvot < dRv ? Structure.Rvot : Structure.RvCavity);
      return true;
    }
    if (dCavRv < fw) {
      const rr = Math.hypot(x, y) || 1;
      setSample(out, Tissue.Myocardium, -Math.min(dCavRv, fw - dCavRv), x / rr, y / rr, 0, x / (1 - 0.3 * s), y / (1 - 0.3 * s), z, 0, Structure.RvWall);
      return true;
    }
  }

  // ---------- Pericardium & effusion (outer envelope of all epicardial surfaces) ----------
  {
    const dLvEpi = dEllR - wallT; // the epicardium is the outer face of the wall shell
    const fw = m.anatomy.rv.freeWallThicknessCm;
    const dRvEpi = rvTmp[0]! - fw; // crescent computed just above (this point is outside the RV)
    const la = A.laCenter,
      lr = A.laR;
    const dLaEpi = sdEllipsoid(x, y, z, la.x, la.y, la.z, lr.x + 0.25, lr.y + 0.25, lr.z + 0.25);
    const ra = A.raCenter,
      rar = A.raR;
    const dRaEpi = sdEllipsoid(x, y, z, ra.x, ra.y, ra.z, rar.x + 0.22, rar.y + 0.22, rar.z + 0.22);
    const dRvotEpi = sdCapsule(x, y, z, A.rvotA.x, A.rvotA.y, A.rvotA.z, A.rvotB.x, A.rvotB.y, A.rvotB.z, A.rvotRa + fw);
    const dPaEpi = sdCapsule(x, y, z, A.rvotB.x, A.rvotB.y, A.rvotB.z, A.paEnd.x, A.paEnd.y, A.paEnd.z, A.paR + 0.2);
    const dEpi = Math.min(dLvEpi, dRvEpi, dLaEpi, dRaEpi, dRvotEpi, dPaEpi);
    const eff = hp.effusion;
    if (dEpi < 0.12) {
      setSample(out, Tissue.Pericardium, -Math.min(Math.max(dEpi, 0), 0.12 - Math.max(dEpi, 0)), nx0, ny0, nz0, x, y, z, 0, Structure.Pericardium);
      return true;
    }
    if (eff > 0 && dEpi < 0.12 + eff) {
      setSample(out, Tissue.Fluid, dEpi - 0.12 - eff, nx0, ny0, nz0, x, y, z, 0, Structure.PericardialEffusion);
      return true;
    }
    if (eff > 0 && dEpi < 0.12 + eff + 0.12) {
      setSample(out, Tissue.Pericardium, 0, nx0, ny0, nz0, x, y, z, 0, Structure.Pericardium);
      return true;
    }
  }
  return false;
}

interface AnchorsCached extends Anchors {
  avE1: Vec3;
  avE2: Vec3;
  /** unit direction (⊥ root axis) of the ascending aorta's curvature */
  avBend: Vec3;
  /** basis ⊥ the pulmonary trunk axis (pulmonary cusps) */
  pvE1: Vec3;
  pvE2: Vec3;
}
const chainHit: ChainHit = { d: 0, frac: 0 };

function anchorsCached(m: HeartModel): AnchorsCached {
  let a = (m as HeartModel & { _anchors?: AnchorsCached })._anchors;
  if (!a) {
    const base = anchors(m);
    const ax = base.avAxis;
    const helper = Math.abs(ax.y) < 0.9 ? v3(0, 1, 0) : v3(1, 0, 0);
    const e1 = normalize(cross(helper, ax));
    const e2 = cross(ax, e1);
    const bendRaw = v3(-0.866, -0.5, 0.35);
    const avBend = normalize(sub(bendRaw, scale(ax, dot(bendRaw, ax))));
    const helperP = Math.abs(base.paDir.y) < 0.9 ? v3(0, 1, 0) : v3(1, 0, 0);
    const pvE1 = normalize(cross(helperP, base.paDir));
    const pvE2 = cross(base.paDir, pvE1);
    a = { ...base, avE1: e1, avE2: e2, avBend, pvE1, pvE2 };
    (m as HeartModel & { _anchors?: AnchorsCached })._anchors = a;
  }
  return a;
}

/** Anchor points of the model (heart frame at ED) for measurement and debugging tools. */
export function heartAnchors(m: HeartModel): Readonly<AnchorsCached> {
  return anchorsCached(m);
}
export type HeartAnchors = Readonly<AnchorsCached>;

function setSample(
  out: TissueSample,
  tissue: Tissue,
  sdf: number,
  nx: number,
  ny: number,
  nz: number,
  mx: number,
  my: number,
  mz: number,
  extra: number,
  structure: Structure,
): void {
  const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
  out.tissue = tissue;
  out.sdf = sdf;
  out.nx = nx / l;
  out.ny = ny / l;
  out.nz = nz / l;
  out.mx = mx;
  out.my = my;
  out.mz = mz;
  out.extraReflect = extra;
  out.structure = structure;
}

/** Utility for tests/devtools: Monte-Carlo cavity volume (mL) of a structure. */
export function estimateStructureVolume(
  m: HeartModel,
  hp: HeartPose,
  structures: Structure[],
  samples: number,
  seedRng: () => number,
  box?: { min: Vec3; max: Vec3 },
): number {
  const out: TissueSample = { tissue: Tissue.None, sdf: 0, nx: 0, ny: 0, nz: 0, mx: 0, my: 0, mz: 0, extraReflect: 0, structure: Structure.None };
  const R = m.boundRadius;
  const c = m.boundCenter;
  const min = box?.min ?? v3(c.x - R, c.y - R, c.z - R);
  const max = box?.max ?? v3(c.x + R, c.y + R, c.z + R);
  const vol = (max.x - min.x) * (max.y - min.y) * (max.z - min.z);
  let hits = 0;
  for (let i = 0; i < samples; i++) {
    const x = min.x + seedRng() * (max.x - min.x);
    const y = min.y + seedRng() * (max.y - min.y);
    const z = min.z + seedRng() * (max.z - min.z);
    if (classifyHeart(m, hp, x, y, z, out) && structures.includes(out.structure)) hits++;
  }
  return (hits / samples) * vol;
}

/** Aortic root axis (heart frame, unit) — the reference axis for the AV short-axis view. */
export function heartRootAxis(m: HeartModel): Vec3 {
  return anchorsCached(m).avAxis;
}

/** Simple translucent primitives (heart frame) for the 3D torso ghost; derived from the same anchors as the SDF model. */
export interface GhostPrimitive {
  kind: 'ellipsoid' | 'tube';
  center: Vec3;
  radii: Vec3;
  /** tube only: end point */
  end?: Vec3;
  color: number;
  opacity: number;
}
export function heartGhostPrimitives(m: HeartModel): GhostPrimitive[] {
  const A = anchorsCached(m);
  const lv = m.lv;
  const t = (lv.ivsd + lv.lvpwd) / 2;
  const rootEnd = add(A.avCenter, scale(A.avAxis, 4.5));
  return [
    { kind: 'ellipsoid', center: v3(0, 0, lv.lengthCm * 0.48), radii: v3(lv.rMax + t, lv.rMax * lv.shape.ratio + t, lv.lengthCm * 0.55), color: 0xc0413f, opacity: 0.35 },
    { kind: 'ellipsoid', center: A.rvCenter, radii: v3(A.rvR.x * 0.75, A.rvR.y * 0.62, A.rvR.z * 0.9), color: 0x8a3a6a, opacity: 0.28 },
    { kind: 'ellipsoid', center: A.laCenter, radii: A.laR, color: 0xb05050, opacity: 0.25 },
    { kind: 'ellipsoid', center: A.raCenter, radii: A.raR, color: 0x7a4a7a, opacity: 0.25 },
    { kind: 'tube', center: A.avCenter, end: rootEnd, radii: v3(A.sinusR, A.sinusR, A.sinusR), color: 0xd86a6a, opacity: 0.3 },
  ];
}

/** LV cavity radius (cm, from the long axis) at azimuth `az` and height `z` for a pose (measurement tools). */
export function lvCavityRadiusAt(m: HeartModel, hp: HeartPose, az: number, z: number): number {
  return lvCavityRadius(m.lv.shape, hp.prof, az, z);
}

/** LV epicardial radius at azimuth `az` and height `z`: cavity radius plus the local wall thickness (radial). */
export function lvEpicardialRadiusAt(m: HeartModel, hp: HeartPose, az: number, z: number): number {
  const levelFrac = Math.min(1, Math.max(0, (z - hp.zAnn) / Math.max(hp.lengthNow, 1)));
  const amp = m.segAmp[ahaSegment(az, levelFrac)] ?? 1;
  return lvCavityRadius(m.lv.shape, hp.prof, az, z) + wallThicknessAt(m, hp.thickK, az, levelFrac, amp) * lvRadialOffsetFactor(m.lv.shape, hp.prof, az, z);
}
