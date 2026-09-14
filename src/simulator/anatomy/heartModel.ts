import type { AnatomyConfig, PhysiologyConfig } from '@/cases/schema';
import type { CycleState } from '@/simulator/cardiac-cycle/cycleModel';
import { Structure, Tissue, type TissueSample } from './tissue';
import { sdCapsule, sdEllipsoid, sdRoundCone, sdSegmentChain, sdTorusZ, smax, smin, type ChainHit } from './sdf';
import { allocLvProfileTable, axialWallFactor, buildLvProfile, lvCavityRadius, lvCavitySdf, lvProfileG, lvRadialOffsetFactor, lvSdfNormal, lvShapeFor, lvShellVolume, solveThickening, type LvProfileTable, type LvShape } from './lvShape';
import { fastAtan2, latticeNoise3, noiseLattice } from '@/core/noise';
import { aorticCoaptationBand, aorticCuspDistance, aorticHit, buildAorticValve, rootRadiusAt, AV_COAPT_HALF, type AorticValve, type RootProfile } from './aorticValve';
import { buildMitralValve, fitOpenLeaflets, inflowTaper, insideMitralOutline, mitralAnnulusDistance, mitralDistance, mitralFreeEdge, mitralHingeZ, mitralHit, mitralInflowSdf, papillaryTether, type MitralValve } from './mitralValve';
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
/**
 * Systolic shortening of the tricuspid annular dimensions. In healthy adults the annulus is largest in late diastole
 * and smallest in mid-to-late systole, with fractional area change 35 ± 10 % and perimeter and diameters shortening by
 * 20 % or more (3D echocardiography, n = 209); the septal edge is anchored to the fibrous septum and the free-wall side
 * moves.
 */
export const TV_SYSTOLIC_SHORTENING = 0.2;
/** Closed tricuspid leaflets: depth of the central coaptation below the hinges (cm) and the profile's vertex fractions. */
const TV_TENTING_CM = 0.3;
const TV_CLOSED_REACH = [0.36, 0.71, 1];
const TV_CLOSED_DEPTH = [0.3, 0.62, 1];

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
  /** Inferior vena cava diameter reduction 0..1 for the current respiratory state (sniff / inspiration). */
  ivcCollapse: number;
}

export function createHeartModel(anatomy: AnatomyConfig, physiology: PhysiologyConfig, offset: Vec3 = v3(), seed = 1, ivcCollapse = 0): HeartModel {
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
    ivcCollapse: Math.min(0.95, Math.max(0, ivcCollapse)),
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
  pvZ: number; // outflow tract and pulmonary root displacement along the heart axis (decision 111)
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
  /** Mitral apparatus: D-shaped annulus on the aortomitral curtain, a fan of fibres per leaflet (decision 76). */
  mitral: MitralValve;
  /**
   * Tricuspid leaflets as revolution "skirts" hanging from the annulus ring: a 2D profile (ρ, z) polyline per leaflet
   * zone blended by azimuth around the ring, so long-axis views cut hinged leaflets and short-axis views the orifice.
   */
  tv: SkirtDesc;
  /** Aortic cusps as pockets on the sinus wall (decision 79), and the root profile they hang from. */
  aortic: AorticValve;
  root: RootProfile;
  cuspCount: number;
  /** Chordae tendineae as capsules [ax,ay,az,bx,by,bz] × n. */
  chordae: Float64Array;
  chordaeCount: number;
  /** Pulmonary cusps: three 2-segment chains on the trunk axis (same layout as the aortic ones). */
  pvSegs: Float64Array;
  pvWidths: Float64Array;
  pvHalf: number;
  pvSegLen: number;
  pvThickness: number;
  /** Tricuspid annulus ring (torus, axis z): [cx,cy,cz,R]. */
  tvRing: [number, number, number, number];
}

export interface SkirtZone {
  /** Zone centre azimuth (rad; for parallel zones the direction of the attachment arc) and half span (radial zones). */
  phi: number;
  halfSpan: number;
  /** Profile as 4 points (ρ, z) relative to the hinge: [ρ0,z0, ρ1,z1, ρ2,z2, ρ3,z3]; ρ0 = R, z0 = 0. */
  prof: Float64Array;
  /** 0 = radial fibres toward the annulus centre; 1 = parallel fibres hanging from the annulus arc along −phi. */
  kind: number;
  /** Scallop amplitude of the free edge along the lateral coordinate (closed state; 0 = none). */
  lobes: number;
  /** Closed-state reach shaping: parallel zones s(t) = √(1 − t²)·(1 + c·t²) (t = lateral fraction); radial zones s = 1 − c·(Δφ/halfSpan)². */
  c: number;
  structure: Structure;
}

export interface SkirtDesc {
  cx: number;
  cy: number;
  cz: number; // hinge plane z
  R: number; // annulus radius
  blend: number; // azimuthal blend width at the commissures of radial zones (rad)
  thickness: number;
  /** Saddle height (cm): commissures sit this much more apical than the anterior/posterior high points. */
  saddle: number;
  /** 1 when closed (coaptation-line shaping and scallops fully applied), 0 when open. */
  closed: number;
  zones: SkirtZone[];
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


/** Result of the last skirt query: distance, along-fraction (0 hinge → 1 free edge), zone index and zone weight. */
const skirtHit = { d: 0, frac: 0, zone: 0, w: 0 };
const TWO_PI = Math.PI * 2;

/**
 * Distance from a heart-frame point to an AV-valve skirt (minimum over its leaflet zones). Radial zones
 * are revolution surfaces of their profile; parallel zones hang the profile from the annulus arc along
 * the zone direction (the anterior mitral leaflet crosses the orifice centre to reach its coaptation
 * line), with the reach scaled per fibre so the closed free edges meet on a curved line and scalloped
 * zones show their lobes. Writes `skirtHit`; returns the local thickness (for the inside test).
 */
function skirtDistance(x: number, y: number, z: number, k: SkirtDesc): number {
  const dx = x - k.cx,
    dy = y - k.cy;
  const zr0 = z - k.cz;
  const rho = Math.sqrt(dx * dx + dy * dy);
  if (zr0 > 3.5 || zr0 < -2.5 || rho > k.R + 1.5) {
    skirtHit.d = 1e3;
    return 0;
  }
  const phi = fastAtan2(dy, dx);
  const zr = zr0 - saddleOffset(phi, k.zones[0]!.phi, k.saddle);
  let best = Infinity,
    bestFrac = 0,
    bestW = 0,
    bestZone = 0;
  for (let zi = 0; zi < k.zones.length; zi++) {
    const zn = k.zones[zi]!;
    let w: number, rhoS: number, s: number;
    if (zn.kind === 1) {
      const ca = Math.cos(zn.phi),
        sa = Math.sin(zn.phi);
      const v = dx * ca + dy * sa;
      const u = -dx * sa + dy * ca;
      const t = Math.abs(u) / k.R;
      if (t >= 0.98) continue;
      const vAtt = Math.sqrt(k.R * k.R - u * u);
      rhoS = k.R - (vAtt - v);
      const tw = (t - 0.8) / 0.18;
      w = tw <= 0 ? 1 : 1 - tw * tw * (3 - 2 * tw);
      let sc = Math.sqrt(1 - t * t) * (1 + zn.c * t * t);
      if (zn.lobes > 0) sc *= 1 + zn.lobes * Math.cos((TWO_PI * t) / 0.8);
      s = 1 + (sc - 1) * k.closed;
    } else {
      let dphi = Math.abs(phi - zn.phi);
      if (dphi > Math.PI) dphi = TWO_PI - dphi;
      const tw = (dphi - (zn.halfSpan - k.blend)) / (2 * k.blend);
      w = tw <= 0 ? 1 : tw >= 1 ? 0 : 1 - tw * tw * (3 - 2 * tw);
      if (w <= 0) continue;
      rhoS = rho;
      const q = dphi / zn.halfSpan;
      s = 1 - zn.c * q * q * k.closed;
    }
    const P = zn.prof;
    for (let i = 0; i < 3; i++) {
      const ax = k.R + (P[i * 2]! - k.R) * s,
        az = P[i * 2 + 1]! * s,
        bx = k.R + (P[i * 2 + 2]! - k.R) * s,
        bz = P[i * 2 + 3]! * s;
      const ex = bx - ax,
        ez = bz - az;
      const l2 = ex * ex + ez * ez;
      let u = l2 > 0 ? ((rhoS - ax) * ex + (zr - az) * ez) / l2 : 0;
      u = u < 0 ? 0 : u > 1 ? 1 : u;
      const qx = ax + ex * u - rhoS,
        qz = az + ez * u - zr;
      const d = Math.sqrt(qx * qx + qz * qz);
      if (d < best) {
        best = d;
        bestFrac = (i + u) / 3;
        bestW = w;
        bestZone = zi;
      }
    }
  }
  skirtHit.d = best;
  skirtHit.frac = bestFrac;
  skirtHit.zone = bestZone;
  skirtHit.w = bestW;
  // leaflets are thickest at the free edge (rough zone) and thin out toward the commissures
  return (k.thickness * (0.6 + 0.4 * bestFrac) * 0.5 + 0.035) * (0.4 + 0.6 * bestW);
}

/** Free-edge point of a skirt zone at lateral fraction t (parallel zones) or azimuth offset Δφ (radial zones). */
function skirtTip(k: SkirtDesc, zn: SkirtZone, param: number, out: number[]): void {
  const P = zn.prof;
  const phiA = k.zones[0]!.phi;
  if (zn.kind === 1) {
    const t = param;
    const u = t * k.R;
    const vAtt = Math.sqrt(Math.max(0, k.R * k.R - u * u));
    let sc = Math.sqrt(Math.max(0, 1 - t * t)) * (1 + zn.c * t * t);
    if (zn.lobes > 0) sc *= 1 + zn.lobes * Math.cos((TWO_PI * Math.abs(t)) / 0.8);
    const s = 1 + (sc - 1) * k.closed;
    const vTip = vAtt + (P[6]! - k.R) * s;
    const ca = Math.cos(zn.phi),
      sa = Math.sin(zn.phi);
    out[0] = k.cx + ca * vTip - sa * u;
    out[1] = k.cy + sa * vTip + ca * u;
    out[2] = k.cz + P[7]! * s + saddleOffset(Math.atan2(out[1] - k.cy, out[0] - k.cx), phiA, k.saddle);
  } else {
    const dphi = param;
    const q = dphi / zn.halfSpan;
    const s = 1 - zn.c * q * q * k.closed;
    const rTip = k.R + (P[6]! - k.R) * s;
    const ang = zn.phi + dphi;
    out[0] = k.cx + rTip * Math.cos(ang);
    out[1] = k.cy + rTip * Math.sin(ang);
    out[2] = k.cz + P[7]! * s + saddleOffset(ang, phiA, k.saddle);
  }
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
  const postClosed = [1.05 + 1.1 * prol, 0.85 + 1.5 * prol, 0.6 + 1.7 * prol];
  const postOpen = [-0.61 * openScale, -0.79 * openScale, -0.96 * openScale];
  const mvAngleAnt = antClosed[1]! + (antOpen[1]! - antClosed[1]!) * open;
  const mvAnglePost = postClosed[1]! + (postOpen[1]! - postClosed[1]!) * open;
  const avOpenAngle = 0.15 + (1.35 * m.anatomy.aorticValve.maxOpeningFraction - 0.15) * state.avOpen;
  const tvAngleAnt = -1.0 + (0.6 + 1.0) * state.tvOpen;
  const tvAnglePost = 0.8 + (-0.7 - 0.8) * state.tvOpen;
  const A = anchorsCached(m);
  const cusps = m.anatomy.aorticValve.bicuspid ? 2 : 3;
  const tvZ = m.physiology.tapseCm * state.rvLongitudinal;
  const septalShiftCm = m.anatomy.rv.septalFlattening * 0.9;
  const rvCollapse = tamp * rvCollapseWindow(state);
  // papillary tips (the apices of the cones built below): about halfway to the axis at 40% of the ventricle's length
  const papTip = (paz: number): [number, number, number] => {
    const zt = zAnn + A.papZetaTip * lengthNow;
    const rt = lvCavityRadius(sh, prof, paz, zt) * A.papTipFrac;
    return [rt * Math.cos(paz), rt * Math.sin(paz), zt];
  };
  const tipAL = papTip(A.papAzAL),
    tipPM = papTip(A.papAzPM);
  // the curtain (anterior annulus) is fibrous continuity with the aortic root, which descends a little less than the
  // ventricular base: the anterior hinge follows it so the anterior leaflet stays attached to the root through the cycle.
  // Each papillary muscle whose tip lies beyond the reach of its chordae pulls the coaptation apically.
  const mitral = buildMitralValve(
    A.mvCenter.x,
    A.mvCenter.y,
    zAnn,
    A.mvR,
    A.avCenter.x - A.mvCenter.x,
    A.avCenter.y - A.mvCenter.y,
    m.anatomy.mitral,
    open,
    state.contraction,
    -(1 - ROOT_EXCURSION) * zAnn,
    papillaryTether(tipAL[0], tipAL[1], tipAL[2], A.mvCenter.x, A.mvCenter.y, zAnn, m.anatomy.mitral),
    papillaryTether(tipPM[0], tipPM[1], tipPM[2], A.mvCenter.x, A.mvCenter.y, zAnn, m.anatomy.mitral),
  );
  {
    // inflow below the annulus: from the outline where it lies farthest outside the cavity profile, straight to just
    // inside the profile at its widest level
    const hMax = sh.zetaMax * lengthNow;
    let worst = 0,
      worstAz = -Math.PI / 2;
    for (let i = 0; i <= 36; i++) {
      const az = -Math.PI + (i / 36) * Math.PI;
      const c = Math.cos(az),
        sn = Math.sin(az);
      // exit radius of the ray from the long axis through the annular outline
      const ox = -mitral.cx,
        oy = -mitral.cy;
      const b = ox * c + oy * sn;
      const r = -b + Math.sqrt(Math.max(0, b * b - (ox * ox + oy * oy) + mitral.R * mitral.R));
      const gap = r - lvCavityRadius(sh, prof, az, zAnn);
      if (gap > worst) {
        worst = gap;
        worstAz = az;
      }
    }
    const c = Math.cos(worstAz),
      sn = Math.sin(worstAz);
    const b = -mitral.cx * c - mitral.cy * sn;
    const rOut = -b + Math.sqrt(Math.max(0, b * b - (mitral.cx * mitral.cx + mitral.cy * mitral.cy) + mitral.R * mitral.R));
    mitral.inflowDepth = hMax;
    mitral.inflowSlope = Math.max(0, (rOut - lvCavityRadius(sh, prof, worstAz, zAnn + hMax) + 0.15) / hMax);
    // the open leaflets swing apically into the ventricle, so the annular plane that clips the profile is not a wall here;
    // the septum is where the classifier puts it, flattened toward the LV by a pressure-loaded RV
    fitOpenLeaflets(mitral, (px, py, pz) => {
      const xs = px - septalShiftAt(septalShiftCm, Math.atan2(py, px), Math.min(1, Math.max(0, (pz - zAnn) / Math.max(lengthNow, 1))));
      return smin(lvCavitySdf(prof, sh.ratio, xs, py, pz), mitralInflowSdf(px, py, pz, mitral), 0.3);
    });
  }
  // Tricuspid valve: three radial leaflets — anterior (largest), septal (hanging along the septum, the +x side
  // of the RV inflow) and posterior (inferior) — whose closed tips converge toward the orifice centre. The annulus
  // shortens in systole with its septal edge fixed (TV_SYSTOLIC_SHORTENING); leaflet lengths do not change.
  const tvOpen = state.tvOpen;
  const tvRNow = A.tvR * (1 - TV_SYSTOLIC_SHORTENING * state.contraction);
  const tv: SkirtDesc = {
    cx: A.tvCenter.x + (A.tvR - tvRNow),
    cy: A.tvCenter.y,
    cz: A.tvCenter.z + tvZ,
    R: tvRNow,
    blend: 0.25,
    thickness: 0.09,
    saddle: 0.15,
    closed: 1 - tvOpen,
    zones: [],
  };
  {
    // Each leaflet opens by the same angles turned inward just enough to stay 2.5 mm off the ventricular wall: with
    // shared angles the septal leaflet opened into the septum and the anterior one through the free wall.
    // [centre azimuth, half span, leaflet length / annular radius, open angles]: anterior 2.2 cm, septal and posterior
    // 1.6 cm long (they were 1.7, 1.2 and 1.4 cm)
    const zoneDefs: [number, number, number, number[]][] = [
      [Math.PI / 2, 1.45, 1.35, [-0.5, -0.6, -0.7]],
      [0, 0.85, 1.0, [-0.45, -0.55, -0.65]],
      [-2.0, 1.05, 1.0, [-0.5, -0.65, -0.8]],
    ];
    // Closed, every leaflet reaches the centre, where the three meet: a shallow dome whose free edges lie 3 mm apical of
    // the hinges. Each leaflet used to close by its own angles and length, shorter toward its commissures, so the
    // four-chamber plane, which crosses the annulus close to a commissure, showed a 0.3-1.3 cm coaptation gap in
    // all twelve cases: tricuspid regurgitation in normal hearts.
    const closedProf = new Float64Array(8);
    closedProf[0] = tvRNow;
    for (let i = 0; i < 3; i++) {
      closedProf[2 + i * 2] = tvRNow * (1 - 0.97 * TV_CLOSED_REACH[i]!);
      closedProf[3 + i * 2] = TV_TENTING_CM * TV_CLOSED_DEPTH[i]!;
    }
    const blendProfiles = (open: Float64Array): Float64Array => open.map((v, i) => closedProf[i]! + (v - closedProf[i]!) * tvOpen);
    const rvCavity = (px: number, py: number, pz: number): number => {
      rvRadii(m, A, prof, thickK, zAnn, lengthNow, tvZ, state.contraction, septalShiftCm, rvCollapse, Math.atan2(py, px), pz, rvRad);
      let d = 1e3;
      const u = rvRad[1]!;
      if (u > 0 && u < 1) {
        const tvPlane = A.tvCenter.z + tvZ;
        const zBase = u >= 0.35 ? tvPlane : tvPlane - 2.6 * (1 - u / 0.35);
        const r = Math.hypot(px, py);
        d = Math.max(rvRad[0]! - r, r - rvRad[2]!, zBase - pz, pz - A.rvApexFrac * m.lv.lengthCm);
      }
      return smin(d, tvInflowSdf(px, py, pz, tv, tvZ), 0.3);
    };
    // zones first (the saddle and the inflow column refer to zone 0), then each open profile fitted
    for (const [phi, halfSpan, lenFrac, opened] of zoneDefs) tv.zones.push({ phi, halfSpan, prof: blendProfiles(buildProfile(tvRNow, opened, (A.tvR * lenFrac) / 3)), kind: 0, lobes: 0, c: 0, structure: Structure.TricuspidValve });
    const rots: number[] = [];
    for (let zi = 0; zi < zoneDefs.length; zi++) {
      const [phi, halfSpan, lenFrac, opened] = zoneDefs[zi]!;
      const segLen = (A.tvR * lenFrac) / 3;
      let rot = 0;
      if (tvOpen > 0) {
        const clear = (r: number): boolean => {
          const pr = buildProfile(tvRNow, opened.map((a) => a + r), segLen);
          for (const off of [-0.6, 0, 0.6]) {
            const ang = phi + off * halfSpan;
            const ca = Math.cos(ang),
              sa = Math.sin(ang);
            for (let i = 1; i <= 6; i++) {
              // vertices (even i) and segment midpoints (odd i) of the three segments
              const j = i >> 1,
                t = i % 2 ? 0.5 : 0;
              const rho = i % 2 ? pr[j * 2]! + (pr[j * 2 + 2]! - pr[j * 2]!) * t : pr[j * 2]!;
              const zz = i % 2 ? pr[j * 2 + 1]! + (pr[j * 2 + 3]! - pr[j * 2 + 1]!) * t : pr[j * 2 + 1]!;
              const need = Math.min(0.25, 0.4 * (Math.hypot(tvRNow - rho, zz) - 0.15));
              if (need <= 0) continue;
              if (rvCavity(tv.cx + rho * ca, tv.cy + rho * sa, tv.cz + zz + saddleOffset(ang, zoneDefs[0]![0], tv.saddle)) > -need) return false;
            }
          }
          return true;
        };
        while (rot < 1.5 && !clear(rot)) rot += 0.1;
        if (rot > 0 && rot < 1.5) {
          let lo = rot - 0.1,
            hi = rot;
          for (let i = 0; i < 4; i++) {
            const mid = (lo + hi) / 2;
            if (clear(mid)) hi = mid;
            else lo = mid;
          }
          rot = hi;
        }
        rot = Math.min(rot, 1.5);
      }
      rots.push(rot);
    }
    // adjacent leaflets meet at their commissures: a plane crossing near one showed the neighbour's differently turned
    // sheet as a separate fragment, so no leaflet turns more than 0.2 rad less than its neighbours
    const maxRot = Math.max(...rots);
    for (let zi = 0; zi < zoneDefs.length; zi++) {
      const [, , lenFrac, opened] = zoneDefs[zi]!;
      const rot = Math.max(rots[zi]!, maxRot - 0.2);
      tv.zones[zi]!.prof = blendProfiles(buildProfile(tvRNow, opened.map((a) => a + rot), (A.tvR * lenFrac) / 3));
    }
  }
  // aortic cusps: pockets on the sinus wall opening by the cycle's opening times the case's maximum (decision 79)
  const aortic = buildAorticValve(cusps, Math.max(0, Math.min(1, state.avOpen)) * m.anatomy.aorticValve.maxOpeningFraction, m.anatomy.aorticValve.cuspThicknessCm);
  const root: RootProfile = { avR: A.avR, sinusR: A.sinusR, ascR: A.ascR, lvotR: m.anatomy.aorta.lvotDiameterCm / 2, count: cusps };
  // pulmonary valve: three cusps hinged at the outflow–trunk junction on the trunk axis, opening with RV ejection
  const pvSegs = new Float64Array(36);
  const pvWidths = new Float64Array(9);
  const pvZ = PV_ROOT_EXCURSION * zAnn;
  const pvSegLen = buildCuspChains(A.rvotB.x, A.rvotB.y, A.rvotB.z + pvZ, A.paDir, A.pvE1, A.pvE2, A.pvR, Math.max(0, Math.min(1, state.pvOpen)), 3, pvSegs, pvWidths, 0.2);
  // papillary muscles: round cones rooted inside the wall (level ζb) leaning into the cavity toward the
  // annulus (tip at level ζt, about halfway to the axis); they move with the wall and thicken in systole
  const paps = new Float64Array(16);
  const papAz = [A.papAzAL, A.papAzPM];
  for (let i = 0; i < 2; i++) {
    const paz = papAz[i]!;
    const zb = zAnn + A.papZetaBase * lengthNow;
    const rb = lvCavityRadius(sh, prof, paz, zb) + 0.25;
    const tip = i === 0 ? tipAL : tipPM;
    const grow = 0.9 + 0.3 * state.contraction;
    paps.set([rb * Math.cos(paz), rb * Math.sin(paz), zb, tip[0], tip[1], tip[2], A.papR * grow, A.papR * 0.65 * grow], i * 8);
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
  // chordae tendineae: two primary chordae per mitral leaflet half from the free edge to each papillary tip
  // (anterolateral papillary ← lateral half, posteromedial ← medial half), plus two from the anterior
  // tricuspid leaflet to the RV anterior papillary muscle
  const pa = [paps[3]!, paps[4]!, paps[5]!],
    pm = [paps[11]!, paps[12]!, paps[13]!],
    rvp = [rvPap[3]!, rvPap[4]!, rvPap[5]!];
  const chordae = new Float64Array(10 * 6);
  const tipBuf = [0, 0, 0];
  const chordDefs: ['mitral' | SkirtDesc, number, number, number[]][] = [
    ['mitral', 0, -0.5, pa],
    ['mitral', 0, -0.2, pa],
    ['mitral', 0, 0.2, pm],
    ['mitral', 0, 0.5, pm],
    ['mitral', 1, 0.3, pa],
    ['mitral', 1, 0.7, pa],
    ['mitral', 1, -0.3, pm],
    ['mitral', 1, -0.7, pm],
    [tv, 0, -0.5, rvp],
    [tv, 0, 0.4, rvp],
  ];
  for (let i = 0; i < 10; i++) {
    const [k, zi, prm, e] = chordDefs[i]!;
    // mitral chordae start at the free edges of the fans: −q is the anterolateral side
    if (k === 'mitral') mitralFreeEdge(mitral, zi as 0 | 1, zi === 0 ? prm : -prm, tipBuf);
    else skirtTip(k, k.zones[zi]!, prm, tipBuf);
    chordae.set([tipBuf[0]!, tipBuf[1]!, tipBuf[2]!, e[0]!, e[1]!, e[2]!], i * 6);
  }
  const valves: ValveGeometry = {
    mitral,
    tv,
    aortic,
    root,
    cuspCount: cusps,
    chordae,
    chordaeCount: 10,
    pvSegs,
    pvWidths,
    pvHalf: A.pvR * Math.sin(Math.PI / 3) * 0.95,
    pvSegLen,
    pvThickness: 0.06,
    tvRing: [tv.cx, tv.cy, tv.cz, tv.R * 0.98],
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
    // the displacement the leaflets hang from (RV longitudinal table, decision 106): returning the LV curve here left the
    // classifier's tricuspid plane up to 3.8 mm from the leaflets in mid-systole (decision 110)
    tvZ,
    pvZ,
    laBooster: 1 - 0.06 * Math.max(state.atrialContraction, state.atrialHold),
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
  paStj: Vec3; // sinotubular junction: the trunk widens from the root radius at the valve to its own radius here
  paRootR: number;
  rpaEnd: Vec3; // right pulmonary artery (runs to the patient's right, behind the ascending aorta)
  rpaR: number;
  lpaEnd: Vec3;
  lpaR: number;
  pvR: number; // pulmonary annulus radius
  /** RV anterior papillary muscle (moderator-band insertion): azimuth and level fractions of root and tip. */
  rvPapAz: number;
  rvPapZetaBase: number;
  rvPapZetaTip: number;
  /** Minimal radial fraction of the atria (end-diastole): a dilated, remodelled atrium empties less. */
  laReservoir: number;
  /** Interatrial septal plane (x) and fossa ovalis centre (y, z). */
  iasX: number;
  fossaY: number;
  fossaZ: number;
  /** Venae cavae and a hepatic vein as capsules (heart frame; directions follow the patient's torso). */
  svcA: Vec3;
  svcB: Vec3;
  svcR: number;
  ivcA: Vec3;
  ivcB: Vec3;
  ivcR: number;
  hvA: Vec3;
  hvB: Vec3;
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
  const laRx = 2.5 * laK,
    laRy = 2.08 * laK,
    laRz = 2.65 * laK;
  const raK = Math.cbrt(a.ra.volumeMl / 44);
  const raRx = 2.15 * raK,
    raRy = 1.93 * raK,
    raRz = 1.86 * raK;
  const rvR = a.rv.basalDiameterCm / 2;
  // both atria overlap the interatrial plane by 0.35 cm and are clipped flat against it (classifyHeart)
  const iasX = -2.35;
  const laCenter = v3(iasX - 0.35 + laRx, -1.3, -laRz * 0.85);
  const raCenter = v3(iasX + 0.35 - raRx, -0.5 - raRx * 0.1, -raRz * 0.72 + 0.05);
  // LV hypertrophy must not crush the right heart: the RV/RVOT anchors move with the septal thickness
  const dWall = (a.lv.ivsdCm - 0.9) * 1.5;
  // The subpulmonary infundibulum winds across the FRONT of the aortic root and the pulmonary annulus sits
  // about 1.5 cm above the aortic one, pointing posteriorly, superiorly and to the left. Both semilunar
  // valves therefore fall close to one oblique plane, which is what makes the parasternal short axis of the
  // great vessels possible at all. Until 2026-09-12 the pulmonary valve sat 4.65 cm anterior and 2.35 cm
  // superior to the aortic one (centres 5.3 cm apart, against 2.5-3 cm in the adult): the PSAX-AV plane then
  // missed it by 3.73 cm, the trunk by 6.25 cm and the infundibular mid point by 2.31 cm, so that view showed
  // the aorta floating with no outflow tract, no pulmonary valve and no trunk. The root reaches y ~ 2.85,
  // so the infundibulum still passes in front of it.
  // Septal hypertrophy pushes the right heart forward, but not uniformly: the infundibular inlet sits on the
  // septum and takes the whole displacement, while the pulmonary annulus is tethered to the fibrous skeleton
  // and the trunk and barely moves. Applying dWall whole along the outflow tract separated the semilunar
  // valves by 4.51 cm in the HOCM case and 3.54 in severe aortic stenosis (2.88 in the normal heart, adult
  // reference 2.5-3.0) — caught by the new av-pv-distance measure, not by eye.
  // Placed from TORSO coordinates, not from the heart frame: the pulmonary valve sits ~1.5 cm cranial,
  // ~1.5 cm anterior and ~1.0 cm to the patient's left of the aortic one (it points at the left shoulder).
  // The first attempt at this put those 1.5 cm along the heart's base-apex axis, which is tilted with
  // respect to the body, and left the valve 2.78 cm cranial, 0.53 cm to the RIGHT and barely anterior —
  // the plane through the three valve centres then sat 64° from the aortic root axis instead of under 30°,
  // which is why no probe angle could show a round aorta ringed by the other valves.
  const rvotB = v3(-0.48, 3.57 + dWall * 0.2, 0.47);
  // torso directions in the heart frame: the pulmonary branches run horizontally in the patient
  const f = m.frame;
  const dirH = (d: Vec3): Vec3 => v3(dot(d, f.ex), dot(d, f.ey), dot(d, f.ez));
  // The trunk leaves the pulmonary valve backward, upward and to the left, around the left side of the ascending aorta
  // to its bifurcation behind it, so the great arteries cross. Given along the heart's axes it ran straight up and back in
  // the torso (−0.01, 0.83, −0.56), with no leftward course, 46° from the root axis (decision 86): the great-vessel short
  // axis cut it obliquely and never the pulmonary valve. The only measured crossing angle found is fetal (78 ± 10°,
  // 59–97°, smaller with gestational age); no adult value was found, so the 79° this direction gives is an assumption.
  const paDir = normalize(dirH(v3(0.4, 0.5, -0.77)));
  const paEnd = add(rvotB, scale(paDir, 3.6));
  const tRight = dirH(v3(-1, 0, 0)),
    tLeft = dirH(v3(1, 0, 0)),
    tPost = dirH(v3(0, 0, -1)),
    tSup = dirH(v3(0, 1, 0)),
    tInf = dirH(v3(0, -1, 0));
  // venae cavae: SVC from the posterior RA roof upward, IVC from the posterior RA floor downward and back
  const tvZ0 = 0.7;
  const svcA = v3(raCenter.x + 0.1, raCenter.y - 0.35 * raRy, raCenter.z - raRz + 0.6);
  const ivcA = v3(raCenter.x + 0.3, raCenter.y - 0.45 * raRy, tvZ0 + 0.25 - 0.4);
  const ivcDir = normalize(add(tInf, scale(tPost, 0.25)));
  const hvA = add(ivcA, scale(ivcDir, 2.4));
  return {
    mvCenter: v3(0.2, -0.9, 0),
    mvR: a.mitral.annulusDiameterCm / 2,
    avCenter: v3(-0.7, 1.35, -0.25),
    avAxis: AV_AXIS,
    avR: a.aorta.annulusCm / 2,
    sinusR: a.aorta.sinusCm / 2,
    ascR: a.aorta.ascendingCm / 2,
    // both atria hang from the interatrial plane (x ≈ −2.3) so that enlarging one never swallows the septum
    laCenter,
    laR: v3(laRx, laRy, laRz * 0.88),
    raCenter,
    raR: v3(raRx, raRy, raRz),
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
    // the inlet sits deep in the anterior RV: pulling the whole tract up to the repositioned pulmonary valve
    // shortened it from 4.3 to 2.6 cm and cost the right ventricle 13% of its volume (162 -> 141 mL in the
    // pulmonary hypertension case), because the outflow tract is part of the chamber
    rvotA: v3(-3.25, 3.05 + dWall, 1.25),
    rvotM: v3(-1.7, 3.95 + dWall * 0.55, 0.4),
    rvotB,
    rvotRa: 1.3,
    rvotRm: 1.2,
    rvotR: 1.1,
    paDir,
    paEnd,
    // the trunk of the case, and branches that dilate with it (decision 109): it was 2.3 cm in every case. It leaves the
    // valve with the radius of the root (the cusps hinge 1 mm inside it) and reaches its own at the sinotubular junction,
    // at the height of the commissures: 19.4 ± 2.0 mm by CT in 50 adults (Jelenc et al., ICVTS 2024;39:ivae206), sinus
    // heights of 15-19 mm in 182 autopsied hearts (Lis et al., Clin Anat 2023;36:234-41). Starting at the valve with its
    // full radius, the trunk of 3.2 cm left the cusps 5.5 mm from its wall and its rounded end widened the outflow tract
    // 8 mm below the valve from a radius of 0.83 to 1.39 cm.
    paR: a.pulmonaryArtery.trunkDiameterCm / 2,
    paStj: add(rvotB, scale(paDir, 1.9)),
    paRootR: 1.15,
    rpaEnd: add(paEnd, scale(normalize(add(tRight, scale(tPost, 0.45))), 4.4)),
    rpaR: 0.8 * (a.pulmonaryArtery.trunkDiameterCm / 2.3),
    lpaEnd: add(paEnd, scale(normalize(add(add(tLeft, scale(tPost, 0.6)), scale(tSup, 0.2))), 3.0)),
    lpaR: 0.75 * (a.pulmonaryArtery.trunkDiameterCm / 2.3),
    pvR: 1.05,
    rvPapAz: 2.35,
    rvPapZetaBase: 0.68,
    rvPapZetaTip: 0.46,
    laReservoir: 0.84 + 0.1 * Math.min(1, Math.max(0, (a.la.volumeMl - 60) / 60)),
    iasX,
    fossaY: -1.6,
    fossaZ: -2.3,
    svcA,
    svcB: add(svcA, scale(tSup, 4.2)),
    svcR: 0.9,
    ivcA,
    ivcB: add(ivcA, scale(ivcDir, 5.0)),
    ivcR: a.ivc.diameterCm / 2,
    hvA,
    hvB: add(hvA, scale(normalize(add(add(scale(tPost, 0.6), scale(tRight, 0.5)), scale(tInf, 0.3))), 2.5)),
    // papillary azimuths (model frame = AHA − 28°): anterolateral at the lateral wall (AHA ≈ 0°, 3 o'clock in
    // PSAX), posteromedial at the inferior / inferoseptal junction (AHA ≈ 250°, 7–8 o'clock)
    papAzAL: -0.5,
    papAzPM: -2.4,
    papZetaBase: 0.68,
    papZetaTip: 0.4,
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
    // derived from the infundibular anchor instead of fixed coordinates: pinned at (-1.7, 4.7, -1.2) it was
    // left behind in the pericardium the moment the outflow tract moved (decision 62)
    { id: 'rvot', label: 'TSVD', p: A.rvotM, radius: 1.0 },
    // RV inflow near the inferior (diaphragmatic) wall: what the subcostal window cuts first
    { id: 'rv-inferior', label: 'Ventrículo derecho (inferior)', p: v3(-(a + 1.8) * 0.94, -(a + 1.8) * 0.35 - 0.2, L * 0.3), radius: 1.2 },
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
    { id: 'ias', label: 'Septum interauricular', p: v3(A.iasX, -1.6, -2.2), radius: 1.0 },
    { id: 'svc', label: 'Vena cava superior', p: add(A.svcA, scale(sub(A.svcB, A.svcA), 0.4)), radius: 0.9 },
    { id: 'ivc', label: 'Vena cava inferior', p: add(A.ivcA, scale(sub(A.ivcB, A.ivcA), 0.4)), radius: 0.9 },
    { id: 'hepatic-vein', label: 'Vena hepática', p: add(A.hvA, scale(sub(A.hvB, A.hvA), 0.5)), radius: 0.7 },
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

/**
 * Signed distance to the tricuspid inflow column: the annular circle, narrowing below the hinges into the RV
 * crescent and closing on the atrial side where the atrium ends (0.3·TAPSE basal to the annulus in systole).
 */
function tvInflowSdf(x: number, y: number, z: number, tv: SkirtDesc, tvZ: number): number {
  const dx = x - tv.cx,
    dy = y - tv.cy;
  const r2 = dx * dx + dy * dy;
  const rho = Math.sqrt(r2);
  // the same saddle as the leaflets and ring (saddleOffset about zones[0].phi)
  const phiA = tv.zones[0]!.phi;
  const sn = dy * Math.cos(phiA) - dx * Math.sin(phiA);
  const h = z - (tv.cz + tv.saddle * (r2 > 0 ? (sn * sn) / r2 : 0));
  const close = 0.25 + 0.3 * tvZ;
  const taper = h > 0 ? 0.25 * h + 0.25 * h * h : h < -close ? 2 * (-h - close) : 0;
  return rho - tv.R + 0.04 + taper;
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
    rootQz = 0,
    rootPhi = 0;
  {
    const c = A.avCenter;
    const ax = A.avAxis;
    const czz = c.z + zAnn * ROOT_EXCURSION;
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
      // sinuses of Valsalva bulge at the cusp centres (trefoil in short axis, ±6 %), narrowing at the commissures;
      // the bulge fades to nothing at the annulus and at the sinotubular junction
      rootPhi = fastAtan2(rootQx * A.avE2.x + rootQy * A.avE2.y + rootQz * A.avE2.z, rootQx * A.avE1.x + rootQy * A.avE1.y + rootQz * A.avE1.z);
      rootR = rootRadiusAt(hp.valves.root, t, rootPhi);
    }
  }
  // the aortic lumen from the annulus upward is never LV wall or fibrous skeleton
  const inRootLumen = rootT >= -0.05 && rootRr < rootR;
  // nor is the outflow tract below it: the basal septal shell reached 0.35 cm into the tract at end diastole and, once
  // the root descended with the base (ROOT_EXCURSION), 0.75 cm at end systole
  const inOutflowLumen = rootT > -1.6 && rootRr < rootR;

  // ---------- Valves, annuli and chordae (thin, highest priority) ----------
  const V = hp.valves;
  const hit = chainHit;
  // mitral leaflets: anterior leaflet on the aortomitral curtain, posterior around the rest of the D-shaped annulus
  {
    const t = mitralDistance(x, y, z, V.mitral);
    if (mitralHit.d < t) {
      setSample(out, Tissue.Valve, mitralHit.d - t, mitralHit.nx, mitralHit.ny, mitralHit.nz, x, y, z, m.anatomy.mitral.calcification, mitralHit.leaflet === 0 ? Structure.MitralAnterior : Structure.MitralPosterior);
      return true;
    }
  }
  // aortic cusps: pockets hung from the crown-shaped attachment on the sinus wall
  if (rootT > -0.5 && rootRr < rootR + 0.02) {
    const half = aorticCuspDistance(V.aortic, V.root, rootT, rootRr, rootPhi);
    if (aorticHit.d < half) {
      const ur = 1 / (rootRr || 1);
      const ax = A.avAxis;
      setSample(out, Tissue.Valve, aorticHit.d - half, aorticHit.nr * rootQx * ur + aorticHit.nt * ax.x, aorticHit.nr * rootQy * ur + aorticHit.nt * ax.y, aorticHit.nr * rootQz * ur + aorticHit.nt * ax.z, x, y, z, m.anatomy.aorticValve.calcification, Structure.AorticValve);
      return true;
    }
  }
  // aortic coaptation surfaces: when the valve is closed adjacent cusps press together along the lines from the
  // centre to each commissure (Y sign in PSAX-AV), in a band below the free margin that is 4.5 mm tall at the centre
  // and rises with the margin toward the commissures. Until 2026-09-13 these fins sat 28.6° away from the commissures
  // of the cusps — 3.7° from the parasternal long-axis plane — reached 0.65 cm down into the ventricular side of the
  // valve and were 0.8 mm thick: a long bright line through the middle of the closed valve in PLAX.
  if (hp.state.avOpen < 0.2 && rootT > 0 && rootT < V.aortic.hComm && rootRr < rootR * 0.97) {
    const [bottom, top] = aorticCoaptationBand(V.aortic, rootRr / rootR);
    if (rootT > bottom && rootT < top) {
      const n = V.cuspCount;
      let dphi = (((rootPhi - 0.5 - Math.PI / n) % (TWO_PI / n)) + TWO_PI / n) % (TWO_PI / n);
      if (dphi > Math.PI / n) dphi = TWO_PI / n - dphi;
      const dist = rootRr * Math.sin(dphi);
      if (dist < AV_COAPT_HALF) {
        // the surface normal is tangential (the band contains the axis and the radial direction)
        const ux = rootQx / (rootRr || 1),
          uy = rootQy / (rootRr || 1),
          uz = rootQz / (rootRr || 1);
        const ax = A.avAxis;
        setSample(out, Tissue.Valve, dist - AV_COAPT_HALF, ax.y * uz - ax.z * uy, ax.z * ux - ax.x * uz, ax.x * uy - ax.y * ux, x, y, z, m.anatomy.aorticValve.calcification, Structure.AorticValve);
        return true;
      }
    }
  }
  // pulmonary cusps (three, hinged at the outflow–trunk junction; clipped to the trunk lumen). They must not enter
  // the aortic root or its wall: at the level of the sinuses they used to replace 0.3 cm of the anterior aortic wall
  // (decision 75)
  const outsideAorticRoot = rootT <= -1.6 || rootRr > rootR + 0.22;
  if (outsideAorticRoot && sdCapsule(x, y, z, A.rvotM.x, A.rvotM.y, A.rvotM.z + hp.pvZ, A.paEnd.x, A.paEnd.y, A.paEnd.z, A.paR + 0.02) < 0) {
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
  // tricuspid leaflets (anterior, septal, posterior)
  {
    const t = skirtDistance(x, y, z, V.tv);
    if (skirtHit.d < t) {
      const dxt = x - V.tv.cx,
        dyt = y - V.tv.cy;
      const rr = Math.hypot(dxt, dyt) || 1;
      setSample(out, Tissue.Valve, skirtHit.d - t, dxt / rr, dyt / rr, 0.8, x, y, z, 0, V.tv.zones[skirtHit.zone]!.structure);
      return true;
    }
  }
  // fibrous annuli (bright hinge points in long-axis views)
  {
    const dR = mitralAnnulusDistance(x, y, z, V.mitral, 0.11);
    if (dR < 0) {
      setSample(out, Tissue.Fibrous, dR, x - V.mitral.cx, y - V.mitral.cy, 0, x, y, z, 0.15 * m.anatomy.mitral.calcification, Structure.MitralAnnulus);
      return true;
    }
    const q = V.tvRing;
    const dT = sdTorusZ(x, y, z - saddleOffset(fastAtan2(y - q[1], x - q[0]), V.tv.zones[0]!.phi, V.tv.saddle), q[0], q[1], q[2], q[3], 0.09);
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

  // Mitral inflow: the ventricle opens onto the whole annulus. The bullet profile is centred on the long axis and the
  // annulus 0.9 cm behind it, so the posterior and commissural hinges used to lie 0.2-0.8 cm (diastole) and up to
  // 1.2 cm (systole) inside the wall: the posterior leaflet grew out of myocardium and its insertion was lost. The
  // cavity and the wall around it are the smooth union of the profile with the annular outline, which narrows apically
  // into the profile (inflowTaper); basal to the hinges the column is atrium. The outflow tract and root keep their own
  // geometry.
  const inRootTube = rootT > -1.6 && rootRr < rootR + 0.2;
  const zHinge = mitralHingeZ(x, y, V.mitral);
  const dInflow = inRootTube ? 1e3 : mitralInflowSdf(x, y, z, V.mitral);
  const dLvBlood = smin(dCavR, dInflow, 0.3);
  // Papillary muscles inside the cavity (round cones rooted in the wall, see computeHeartPose)
  if (dLvBlood < 0) {
    const P = hp.paps;
    const dPa = sdRoundCone(x, y, z, P[0]!, P[1]!, P[2]!, P[3]!, P[4]!, P[5]!, P[6]!, P[7]!);
    const dPm = sdRoundCone(x, y, z, P[8]!, P[9]!, P[10]!, P[11]!, P[12]!, P[13]!, P[14]!, P[15]!);
    const dPap = Math.min(dPa, dPm);
    if (dPap < 0) {
      setSample(out, Tissue.Myocardium, dPap, x, y, 0, x / rsc, y / rsc, z / lsc, 0, Structure.PapillaryMuscle);
      return true;
    }
    // LV blood (the inflow column basal to the hinge plane belongs to the atrium)
    setSample(out, Tissue.Blood, dLvBlood, nx0, ny0, nz0, x / rsc, y / rsc, (z - lv.lengthCm) / lsc, 0, dCavR >= 0 && z < zHinge ? Structure.LaCavity : Structure.LvCavity);
    return true;
  }
  const wallT = tNow;
  // Ventricular wall: shell of local thickness around the *unclipped* profile, apical to (slightly above)
  // the annulus. The annular plane itself is not a wall: it holds the mitral orifice, the LVOT and fibrous tissue.
  const dEllR = smin(dProf, dInflow, 0.3) - regional;
  // the trabeculated inner surface belongs to the wall: from the rough endocardium to the smooth epicardium
  if (dEllR + trab >= 0 && dEllR < wallT && z >= zAnn - 0.25 && !inOutflowLumen) {
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
    // the mitral orifice column basal to the annular plane is atrial blood (the LV ends at the annulus); it follows the
    // D-shaped annulus, so in front of the straight segment the aortomitral curtain and the outflow tract remain
    if (insideMitralOutline(x, y, V.mitral)) {
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
      setSample(out, Tissue.Blood, rr - R, rootQx / rr, rootQy / rr, rootQz / rr, x, y, z - zAnn * ROOT_EXCURSION, 0, t < 0 ? Structure.Lvot : Structure.AorticRoot);
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
    const zTop = la.z - lr.z; // fixed superior boundary (roof, under the pulmonary bifurcation)
    const zBottom = zAnn + 0.25;
    const czL = (zTop + zBottom) / 2,
      rzL = (zBottom - zTop) / 2;
    // reservoir / conduit / booster: radial size follows LV contraction (maximal at end-systole); the atrial
    // kick and its hold until ejection shrink it further (laBooster)
    const bo = hp.laBooster * (A.laReservoir + (1 - A.laReservoir) * hp.state.contraction);
    const xIas = A.iasX;
    // interatrial septum: muscular septum ~0.55 cm with a thicker limbus around the thin fossa ovalis membrane
    const fo = Math.hypot((y - A.fossaY) / 0.6, (z - A.fossaZ) / 0.7);
    const tIas = fo < 1 ? 0.12 : fo < 1.3 ? 0.7 : 0.55;
    // LA: ellipsoid flattened against the septum (medial clip), against the oesophagus / descending aorta
    // (posterior clip) and under the pulmonary bifurcation (roof clip)
    const dEllLa = sdEllipsoid(x, y, z, la.x, la.y, czL, lr.x * bo, lr.y * bo, rzL);
    const dFreeLa = smax(smax(dEllLa, la.y - 0.72 * lr.y * bo - y, 0.6), zTop + 0.15 * rzL - z, 0.5);
    const d = smax(dFreeLa, xIas + tIas / 2 - x, 0.3);
    if (d < 0) {
      setSample(out, Tissue.Blood, d, (x - la.x) / lr.x, (y - la.y) / lr.y, (z - czL) / rzL, x, y, z, 0, Structure.LaCavity);
      return true;
    }
    if (dFreeLa < 0.25 && x > xIas + tIas / 2) {
      setSample(out, Tissue.Myocardium, -Math.min(dFreeLa, 0.25 - dFreeLa), (x - la.x) / lr.x, (y - la.y) / lr.y, (z - czL) / rzL, x, y, z, 0, Structure.LaWall);
      return true;
    }
    // RA: rounder, flattened against the septum and posteriorly
    const ra = A.raCenter,
      rr = A.raR;
    const zTopR = ra.z - rr.z;
    // The atrium ends AT the annulus: it used to run 0.25 cm past it, with its own 0.22 cm wall sealing the
    // orifice and hiding the excess, so the cavity measured 5.60 cm (the top of the 3.5-5.6 range) while the
    // ellipsoid was really 5.82 cm long. Opening the orifice exposed that, so the ellipsoid is shortened by
    // the same amount instead of letting a wall trim it.
    const zBotR = A.tvCenter.z + hp.tvZ * 0.7 + 0.03; // the caval junction moves a little with TAPSE
    const czR = (zTopR + zBotR) / 2,
      rzR = (zBotR - zTopR) / 2;
    const raC = 1 - 0.35 * hp.raCollapse; // tamponade: late-diastolic RA collapse
    const dEllRa = sdEllipsoid(x, y, z, ra.x, ra.y, czR, rr.x * bo * raC, rr.y * bo * raC, rzR);
    const dFreeRa = smax(dEllRa, ra.y - 0.8 * rr.y * bo - y, 0.6);
    const dR = smax(dFreeRa, x - (xIas - tIas / 2), 0.3);
    if (dR < 0) {
      setSample(out, Tissue.Blood, dR, (x - ra.x) / rr.x, (y - ra.y) / rr.y, (z - czR) / rzR, x, y, z, 0, Structure.RaCavity);
      return true;
    }
    if (dFreeRa < 0.22 && x < xIas - tIas / 2) {
      // No wall across the tricuspid orifice: there the atrium opens into the ventricle, and the annulus and
      // leaflets are emitted by the valve block above. Both atria end 0.25 cm past their annulus, but on the
      // left the LV cavity is classified first and claims the orifice, while on the right nothing did — so
      // the atrial wall filled the gap and drew a 2.6 mm echogenic line splitting RA from RV in every A4C.
      // Reported from the images by a cardiologist; measured as RaCavity -> RaWall 0.28 -> RvCavity along a
      // line straight through the annulus centre.
      if (Math.hypot(x - V.tv.cx, y - V.tv.cy) < V.tv.R) {
        // past the annulus the blood belongs to the ventricle, as it does on the left where the LV cavity
        // claims the mitral orifice: calling it atrium instead stretched ra-long past its reference range
        const past = z > A.tvCenter.z + hp.tvZ * 0.7;
        setSample(out, Tissue.Blood, dFreeRa - 0.22, (x - ra.x) / rr.x, (y - ra.y) / rr.y, (z - czR) / rzR, x, y, z, 0, past ? Structure.RvCavity : Structure.RaCavity);
        return true;
      }
      setSample(out, Tissue.Myocardium, -Math.min(dFreeRa, 0.22 - dFreeRa), (x - ra.x) / rr.x, (y - ra.y) / rr.y, (z - czR) / rzR, x, y, z, 0, Structure.RaWall);
      return true;
    }
    // interatrial septum: slab between the clipped atria wherever either atrium reaches the septal plane
    // (behind the aortic root in PSAX-AV as well as in A4C and subcostal views)
    if (Math.abs(x - xIas) <= tIas / 2 && z < zAnn + 0.4) {
      if (sdEllipsoid(xIas, y, z, la.x, la.y, czL, lr.x * bo, lr.y * bo, rzL) < 0.45 || sdEllipsoid(xIas, y, z, ra.x, ra.y, czR, rr.x * bo * raC, rr.y * bo * raC, rzR) < 0.45) {
        setSample(out, Tissue.Myocardium, -(tIas / 2 - Math.abs(x - xIas)), 1, 0, 0, x, y, z, 0, Structure.InteratrialSeptum);
        return true;
      }
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
    // pulmonary veins: four ostia on the flat posterior wall (two superior, two inferior), the right pair behind the septum
    for (let i = 0; i < 4; i++) {
      const sx = i % 2 === 0 ? -1 : 1;
      const px = la.x + sx * lr.x * 0.6;
      const pz = czL + (i < 2 ? -0.7 : 0.6);
      const py0 = la.y - lr.y * 0.7;
      const dPv = sdCapsule(x, y, z, px, py0, pz, px + sx * 1.2, py0 - 2.2, pz + (i < 2 ? -0.6 : 0.5), 0.45);
      if (dPv < 0) {
        setSample(out, Tissue.Blood, dPv, 0, -1, 0, x, y, z, 0, Structure.PulmonaryVein);
        return true;
      }
      if (dPv < 0.12) {
        setSample(out, Tissue.VesselWall, -Math.min(dPv, 0.12 - dPv), 0, -1, 0, x, y, z, 0, Structure.PulmonaryVein);
        return true;
      }
    }
    // venae cavae: the superior enters the RA roof from above (torso superior), the inferior its floor from
    // below and behind through the liver, joined by a hepatic vein (subcostal views); the IVC narrows with the sniff
    {
      const dSvc = sdCapsule(x, y, z, A.svcA.x, A.svcA.y, A.svcA.z, A.svcB.x, A.svcB.y, A.svcB.z, A.svcR);
      if (dSvc < 0) {
        setSample(out, Tissue.Blood, dSvc, 0, 0, -1, x, y, z, 0, Structure.Svc);
        return true;
      }
      if (dSvc < 0.12) {
        setSample(out, Tissue.VesselWall, -Math.min(dSvc, 0.12 - dSvc), 0, 0, -1, x, y, z, 0, Structure.Svc);
        return true;
      }
      const rI = A.ivcR * (1 - m.ivcCollapse);
      const dIvc = sdCapsule(x, y, z, A.ivcA.x, A.ivcA.y, A.ivcA.z, A.ivcB.x, A.ivcB.y, A.ivcB.z, rI);
      if (dIvc < 0) {
        setSample(out, Tissue.Blood, dIvc, 0, 0, 1, x, y, z, 0, Structure.Ivc);
        return true;
      }
      if (dIvc < 0.12) {
        setSample(out, Tissue.VesselWall, -Math.min(dIvc, 0.12 - dIvc), 0, 0, 1, x, y, z, 0, Structure.Ivc);
        return true;
      }
      const dHv = sdCapsule(x, y, z, A.hvA.x, A.hvA.y, A.hvA.z, A.hvB.x, A.hvB.y, A.hvB.z, 0.4);
      if (dHv < 0) {
        setSample(out, Tissue.Blood, dHv, 0, 0, 1, x, y, z, 0, Structure.HepaticVein);
        return true;
      }
      if (dHv < 0.08) {
        setSample(out, Tissue.VesselWall, -Math.min(dHv, 0.08 - dHv), 0, 0, 1, x, y, z, 0, Structure.HepaticVein);
        return true;
      }
    }
    // coronary sinus: runs in the posterior atrioventricular groove toward the RA (A4C posterior, A2C inferior)
    {
      // outside the inferior wall, which at the annulus follows the posterior mitral annulus
      const mvI = V.mitral;
      const rInflow = -mvI.cy + Math.sqrt(Math.max(0, mvI.R * mvI.R - mvI.cx * mvI.cx)) - inflowTaper(0.6, mvI);
      const gy = -(Math.max(lvCavityRadius(sh, hp.prof, -Math.PI / 2, zAnn + 0.6), rInflow) + lv.lvpwd * hp.thickK + 0.4);
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
    // the outflow tract and the pulmonary root move with the base (pvZ, decision 111): evaluated at the point shifted back
    const pvZ = hp.pvZ;
    const zo = z - pvZ;
    const dRvot = Math.min(
      sdRoundCone(x, y, zo, A.rvotA.x, A.rvotA.y, A.rvotA.z, A.rvotM.x, A.rvotM.y, A.rvotM.z, A.rvotRa * k, A.rvotRm * k),
      sdRoundCone(x, y, zo, A.rvotM.x, A.rvotM.y, A.rvotM.z, A.rvotB.x, A.rvotB.y, A.rvotB.z, A.rvotRm * k, A.rvotR * k),
    );
    // pulmonary trunk from the valve to the bifurcation; right branch behind the ascending aorta, left branch
    const dPa = Math.min(
      sdRoundCone(x, y, zo, A.rvotB.x, A.rvotB.y, A.rvotB.z, A.paStj.x, A.paStj.y, A.paStj.z, A.paRootR, A.paR),
      // the trunk runs from the moving junction to the bifurcation, which stays
      sdCapsule(x, y, z, A.paStj.x, A.paStj.y, A.paStj.z + pvZ, A.paEnd.x, A.paEnd.y, A.paEnd.z, A.paR),
    );
    const dRpa = sdCapsule(x, y, z, A.paEnd.x, A.paEnd.y, A.paEnd.z, A.rpaEnd.x, A.rpaEnd.y, A.rpaEnd.z, A.rpaR);
    const dLpa = sdCapsule(x, y, z, A.paEnd.x, A.paEnd.y, A.paEnd.z, A.lpaEnd.x, A.lpaEnd.y, A.lpaEnd.z, A.lpaR);
    const dTrunk = Math.min(dPa, dRpa, dLpa);
    const vx = x - A.rvotB.x,
      vy = y - A.rvotB.y,
      vz = zo - A.rvotB.z;
    if (dTrunk < 0) {
      setSample(out, Tissue.Blood, dTrunk, vx, vy, vz, x, y, z, 0, Structure.PulmonaryArtery);
      return true;
    }
    if (dTrunk < 0.18 && dRvot > 0) {
      setSample(out, Tissue.VesselWall, -Math.min(dTrunk, 0.18 - dTrunk), vx, vy, vz, x, y, z, 0, Structure.PulmonaryArtery);
      return true;
    }
    // tricuspid inflow: the RV cavity and its wall reach the whole annulus. The crescent is closed at the tricuspid
    // plane, so its wall ran as a floor 0.5-1.5 cm thick across the orifice, and in systole its free wall pulled in
    // while the annulus stayed put: the lateral hinge sat outside the heart in 6-10 of 10 frames of eleven cases.
    const dRvU = smin(dRv, tvInflowSdf(x, y, z, V.tv, hp.tvZ), 0.3);
    rvTmp[0] = dRvU;
    const dCavRv = Math.min(dRvU, dRvot);
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
      setSample(out, Tissue.Blood, dCavRv, x / rr, y / rr, 0, x / (1 - 0.3 * s), y / (1 - 0.3 * s), z, 0, dRvot < dRvU ? Structure.Rvot : dRv >= 0 && z <= A.tvCenter.z + hp.tvZ * 0.7 ? Structure.RaCavity : Structure.RvCavity);
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
    const dRvEpi = rvTmp[0]! - fw; // crescent and tricuspid inflow, computed just above (this point is outside the RV)
    const la = A.laCenter,
      lr = A.laR;
    const dLaEpi = sdEllipsoid(x, y, z, la.x, la.y, la.z, lr.x + 0.25, lr.y + 0.25, lr.z + 0.25);
    const ra = A.raCenter,
      rar = A.raR;
    const dRaEpi = sdEllipsoid(x, y, z, ra.x, ra.y, ra.z, rar.x + 0.22, rar.y + 0.22, rar.z + 0.22);
    // The sac around the outflow tract and the trunk stays where the pericardium is anchored (sternopericardial ligaments in
    // front, the arterial reflection on the trunk) while they descend in systole (decision 111). One envelope stands for the
    // epicardial fat, the pericardium and the effusion here; moved with the tract, the effusion of the tamponade case, which
    // reaches the transducer face in the parasternal views (chestWall.test.ts), changed its near field with every beat.
    const dRvotEpi = sdCapsule(x, y, z, A.rvotA.x, A.rvotA.y, A.rvotA.z, A.rvotB.x, A.rvotB.y, A.rvotB.z, A.rvotRa + fw);
    const dPaEpi = Math.min(
      sdRoundCone(x, y, z, A.rvotB.x, A.rvotB.y, A.rvotB.z, A.paStj.x, A.paStj.y, A.paStj.z, A.paRootR + 0.2, A.paR + 0.2),
      sdCapsule(x, y, z, A.paStj.x, A.paStj.y, A.paStj.z, A.paEnd.x, A.paEnd.y, A.paEnd.z, A.paR + 0.2),
    );
    // the cardiac silhouette is the smooth union of the epicardial surfaces: the grooves between chambers and
    // the space between outflow and root are filled with epicardial fat, and one pericardium wraps the whole heart
    const dEpi = smin(smin(smin(dLvEpi, dRvEpi, 0.8), smin(dLaEpi, dRaEpi, 0.8), 0.8), smin(dRvotEpi, dPaEpi, 0.8), 0.8);
    const eff = hp.effusion;
    if (dEpi < 0) {
      setSample(out, Tissue.Fat, dEpi, nx0, ny0, nz0, x, y, z, 0, Structure.EpicardialFat);
      return true;
    }
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
    placePulmonaryRoot(m, a);
  }
  return a;
}

/** A frame of the beat without tables: end-diastole or end-systole of the case (for placing anchors against the walls). */
function extremeState(m: HeartModel, systole: boolean): CycleState {
  const { edvMl, esvMl } = m.physiology;
  const k = systole ? 1 : 0;
  return { phase: 0, timeInBeatS: 0, rrS: 1, lvVolumeMl: systole ? esvMl : edvMl, contraction: k, mvOpen: 0, avOpen: 0, tvOpen: 0, pvOpen: 0, longitudinal: k, rvLongitudinal: k, atrialContraction: 0, atrialHold: 0, mitralFlowMlps: 0, aorticFlowMlps: 0, edvMl, esvMl };
}

/**
 * The pulmonary root stands beside the aortic root (decision 112). The valve is placed from torso coordinates (decision
 * 62: ~1.0 cm left, 1.5 cm cranial and 1.5 cm anterior of the aortic valve), which put its centre 2.3 cm from the aortic
 * one in every case, closer than the two roots allow: the aortic sinus and, over a dilated or thickened ventricle, the
 * anterior LV wall filled a quarter to two fifths of the pulmonary root and up to half of the ring where the cusps hinge.
 * Keeping its bearing around the aortic root, the root (valve, root, trunk and branches) moves out from the aortic axis
 * by the least distance that leaves its lumen, from the valve plane to the sinotubular junction, clear of every other
 * structure at end-diastole and at end-systole (the aortic root descends with the base more than the pulmonary root).
 */
function placePulmonaryRoot(m: HeartModel, A: AnchorsCached): void {
  const poses = [computeHeartPose(m, extremeState(m, false)), computeHeartPose(m, extremeState(m, true))];
  const rel = sub(A.rvotB, A.avCenter);
  const u = normalize(sub(rel, scale(A.avAxis, dot(rel, A.avAxis))));
  const base = { rvotB: A.rvotB, paStj: A.paStj, paEnd: A.paEnd, rpaEnd: A.rpaEnd, lpaEnd: A.lpaEnd };
  const smp: TissueSample = { tissue: 0, sdf: 0, nx: 0, ny: 0, nz: 1, mx: 0, my: 0, mz: 0, extraReflect: 0, structure: 0 } as unknown as TissueSample;
  const e1 = A.pvE1,
    e2 = A.pvE2,
    d = A.paDir;
  const moveTo = (off: number): void => {
    const o = scale(u, off);
    A.rvotB = add(base.rvotB, o);
    A.paStj = add(base.paStj, o);
    A.paEnd = add(base.paEnd, o);
    A.rpaEnd = add(base.rpaEnd, o);
    A.lpaEnd = add(base.lpaEnd, o);
  };
  const inLumen = (s: Structure): boolean => s === Structure.PulmonaryArtery || s === Structure.PulmonaryValve || s === Structure.Rvot || s === Structure.RvCavity;
  const conflicts = (off: number): number => {
    moveTo(off);
    let bad = 0;
    for (const hp of poses) {
      const cx = A.rvotB.x,
        cy = A.rvotB.y,
        cz = A.rvotB.z + hp.pvZ;
      for (let i = 0; i <= 10; i++) {
        const t = (1.9 * i) / 10;
        const r = A.paRootR + ((A.paR - A.paRootR) * t) / 1.9 - 0.05;
        for (let k = 0; k < 24; k++) {
          const ang = (k / 24) * 2 * Math.PI;
          const c = Math.cos(ang) * r,
            sn = Math.sin(ang) * r;
          const x = cx + d.x * t + e1.x * c + e2.x * sn,
            y = cy + d.y * t + e1.y * c + e2.y * sn,
            z = cz + d.z * t + e1.z * c + e2.z * sn;
          if (!classifyHeart(m, hp, x + hp.swingX, y, z, smp) || !inLumen(smp.structure)) bad++;
        }
      }
    }
    return bad;
  };
  if (conflicts(0) === 0) {
    moveTo(0);
    return;
  }
  // coarse steps outward, then halve the last interval
  let lo = 0,
    hi = -1;
  for (let off = 0.25; off <= 2.5 + 1e-9; off += 0.25) {
    if (conflicts(off) === 0) {
      hi = off;
      break;
    }
    lo = off;
  }
  if (hi < 0) {
    moveTo(2.5);
    return;
  }
  for (let it = 0; it < 5; it++) {
    const mid = (lo + hi) / 2;
    if (conflicts(mid) === 0) hi = mid;
    else lo = mid;
  }
  moveTo(hi + 0.05);
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
