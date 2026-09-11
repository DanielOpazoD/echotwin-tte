import type { AnatomyConfig, PhysiologyConfig } from '@/cases/schema';
import type { CycleState } from '@/simulator/cardiac-cycle/cycleModel';
import { Structure, Tissue, type TissueSample } from './tissue';
import { sdCapsule, sdEllipsoid, sdSegmentChain, sdTorusZ, smax, type ChainHit } from './sdf';
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
  a: number; // lateral (x) radius at ED
  b: number; // anteroposterior (y) radius at ED
  zc: number; // ellipsoid centre z
  c: number; // ellipsoid z radius
  wallVolumeMl: number;
  ivsd: number;
  lvpwd: number;
}

function clippedEllipsoidIntegral(L: number, zc: number, c: number): number {
  // ∫_0^L (1 − ((z−zc)/c)²) dz
  const f = (z: number): number => z - Math.pow(z - zc, 3) / (3 * c * c);
  return f(L) - f(0);
}

export function lvGeometryFromVolume(edvMl: number, lengthCm: number, sphericity: number, anatomy: AnatomyConfig['lv']): LvGeometry {
  const delta = 0.35 + 0.9 * sphericity; // how far the ellipsoid extends above the annulus
  const c = lengthCm / 2 + delta;
  const zc = lengthCm - c;
  const I = clippedEllipsoidIntegral(lengthCm, zc, c);
  const ratio = 0.94; // slight AP flattening
  const a = Math.sqrt(edvMl / (Math.PI * ratio * I));
  const b = a * ratio;
  // wall volume from mean thickness (ED)
  const tMean = (anatomy.ivsdCm + anatomy.lvpwdCm) / 2;
  const aE = a + tMean,
    bE = b + tMean,
    cE = c + anatomy.apexWallThicknessCm * 0.7;
  const IE = clippedEllipsoidIntegral(lengthCm + anatomy.apexWallThicknessCm, zc, cE);
  const epiVol = Math.PI * aE * bE * IE;
  return { lengthCm, a, b, zc, c, wallVolumeMl: Math.max(20, epiVol - edvMl), ivsd: anatomy.ivsdCm, lvpwd: anatomy.lvpwdCm };
}

export interface HeartFrame {
  origin: Vec3; // torso coords of heart origin
  ex: Vec3;
  ey: Vec3;
  ez: Vec3;
}

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
  const deg = (((azimuthRad * 180) / Math.PI) % 360 + 360) % 360;
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
  };
}

/** Per-frame deformation parameters derived from the cycle state (computed once per frame). */
export interface HeartPose {
  state: CycleState;
  zAnn: number; // annulus displacement toward apex (cm)
  aCav: number; // cavity radii (x) now
  bCav: number;
  lengthNow: number;
  aEpi: number;
  bEpi: number;
  cCav: number;
  zcCav: number;
  radialScale: number; // aCav / a at ED
  longScale: number; // lengthNow / length at ED
  mvAngleAnt: number; // anterior leaflet angle (rad) in y–z plane from +z toward −y
  mvAnglePost: number;
  avOpenAngle: number; // rad from perpendicular (closed) toward axis (open)
  tvAngleAnt: number;
  tvAnglePost: number;
  rvScale: number;
  tvZ: number; // tricuspid annulus displacement (TAPSE)
  laBooster: number; // atrial contraction radial scale (1 = none)
  effusion: number;
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
  const zr = z - k.cz;
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

export function computeHeartPose(m: HeartModel, state: CycleState): HeartPose {
  const { lv } = m;
  const long = state.longitudinal;
  const zAnn = m.physiology.mapseCm * long;
  const lengthNow = lv.lengthCm - zAnn;
  const volNow = state.lvVolumeMl;
  const delta = lv.c - lv.lengthCm / 2;
  const cCav = lengthNow / 2 + delta;
  const zcCav = lv.lengthCm - cCav; // apex fixed at z = L
  const I = clippedEllipsoidIntegral(lengthNow, zcCav, cCav) - (zAnn > 0 ? 0 : 0);
  // cavity: integrate from zAnn to L (annulus moved). Approximate by scaling with the same integral over [0,L] shape.
  const ratio = lv.b / lv.a;
  const aCav = Math.sqrt(Math.max(volNow, 5) / (Math.PI * ratio * Math.max(I, 1e-3)));
  const bCav = aCav * ratio;
  // epicardium: incompressible wall
  const epiVol = volNow + lv.wallVolumeMl;
  const apexT = m.anatomy.lv.apexWallThicknessCm;
  const cE = cCav + apexT * 0.7;
  const IE = clippedEllipsoidIntegral(lengthNow + apexT, zcCav, cE);
  const aEpi = Math.sqrt(epiVol / (Math.PI * ratio * IE));
  const bEpi = aEpi * ratio;
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
  const postClosed = [0.95, 0.7, 0.45];
  const postOpen = [-0.61 * openScale, -0.79 * openScale, -0.96 * openScale];
  const mvAngleAnt = antClosed[1]! + (antOpen[1]! - antClosed[1]!) * open;
  const mvAnglePost = postClosed[1]! + (postOpen[1]! - postClosed[1]!) * open;
  const avOpenAngle = 0.15 + (1.35 * m.anatomy.aorticValve.maxOpeningFraction - 0.15) * state.avOpen;
  const tvAngleAnt = -1.0 + (0.6 + 1.0) * state.tvOpen;
  const tvAnglePost = 0.8 + (-0.7 - 0.8) * state.tvOpen;
  const A = anchorsCached(m);
  const cusps = m.anatomy.aorticValve.bicuspid ? 2 : 3;
  const CUSP_SEGS = 2;
  const segs = new Float64Array(cusps * CUSP_SEGS * 6);
  const tvZ = m.physiology.tapseCm * long;
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
  };
  // aortic cusps: 2 segments each in the (inward, axis) plane; closed = shallow cup, open = flat on the wall
  const cuspOffsets: number[] = [];
  const cuspWidths = new Float64Array(cusps * 3);
  // Cusps are sheets ~1.5·R long from the annular nadir to the free edge. Closed: cup with free edges
  // meeting near the centre at mid-sinus level; open: lying along the sinus wall. The opening is
  // parametrised by the orifice radius (0.05·R closed → 0.9·R fully open, scaled by the case's
  // maxOpeningFraction), and the two segment angles are solved for that reach each frame.
  const cuspSegLen = (A.avR * 1.5) / CUSP_SEGS;
  {
    const c = A.avCenter;
    const ax = A.avAxis;
    const czz = c.z + zAnn * 0.5;
    const e1 = A.avE1,
      e2 = A.avE2;
    const R = A.avR;
    const openness = Math.max(0, Math.min(1, state.avOpen)) * m.anatomy.aorticValve.maxOpeningFraction;
    const targetReach = R - R * (0.05 + 0.85 * openness);
    let lo = 0,
      hi = 1;
    for (let it = 0; it < 14; it++) {
      const mid = (lo + hi) / 2;
      const reach = cuspSegLen * (Math.cos(0.45 + 1.0 * mid) + Math.cos(0.95 + 0.5 * mid));
      if (reach > targetReach) lo = mid;
      else hi = mid;
    }
    const f = (lo + hi) / 2;
    const angles = [0.45 + 1.0 * f, 0.95 + 0.5 * f];
    let off = 0;
    for (let i = 0; i < cusps; i++) {
      const phi = (i * 2 * Math.PI) / cusps + 0.5;
      const rx = e1.x * Math.cos(phi) + e2.x * Math.sin(phi);
      const ry = e1.y * Math.cos(phi) + e2.y * Math.sin(phi);
      const rz = e1.z * Math.cos(phi) + e2.z * Math.sin(phi);
      let sx = c.x + rx * R,
        sy = c.y + ry * R,
        sz = czz + rz * R;
      cuspOffsets.push(off);
      for (let k = 0; k < CUSP_SEGS; k++) {
        const a = angles[k]!;
        const dx = -rx * Math.cos(a) + ax.x * Math.sin(a);
        const dy = -ry * Math.cos(a) + ax.y * Math.sin(a);
        const dz = -rz * Math.cos(a) + ax.z * Math.sin(a);
        const o = off + k * 6;
        segs[o] = sx;
        segs[o + 1] = sy;
        segs[o + 2] = sz;
        segs[o + 3] = dx;
        segs[o + 4] = dy;
        segs[o + 5] = dz;
        sx += dx * cuspSegLen;
        sy += dy * cuspSegLen;
        sz += dz * cuspSegLen;
      }
      cuspWidths[i * 3] = ax.y * rz - ax.z * ry;
      cuspWidths[i * 3 + 1] = ax.z * rx - ax.x * rz;
      cuspWidths[i * 3 + 2] = ax.x * ry - ax.y * rx;
      off += CUSP_SEGS * 6;
    }
  }
  // chordae: from the mitral leaflet free edges (anterior at φ = 45°/135°, posterior at −45°/−135°) to the papillary tips
  const radialScale = aCav / lv.a;
  const longScale = lengthNow / lv.lengthCm;
  const papTip = (p: Vec3): [number, number, number] => [p.x * radialScale * 0.9, p.y * radialScale * 0.9, p.z * longScale - 1.6 * longScale];
  const pa = papTip(A.papAL),
    pm = papTip(A.papPM);
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
    mvRing: [A.mvCenter.x, A.mvCenter.y, zAnn, A.mvR * 0.98],
    tvRing: [A.tvCenter.x, A.tvCenter.y, A.tvCenter.z + tvZ, A.tvR * 0.98],
  };
  return {
    state,
    zAnn,
    aCav,
    bCav,
    lengthNow,
    aEpi,
    bEpi,
    cCav,
    zcCav,
    radialScale,
    longScale,
    mvAngleAnt,
    mvAnglePost,
    avOpenAngle,
    tvAngleAnt,
    tvAnglePost,
    rvScale: 1 - 0.22 * state.contraction,
    tvZ: m.physiology.tapseCm * long,
    laBooster: 1 - 0.06 * state.atrialContraction,
    effusion: m.anatomy.pericardium.effusionCm,
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
  tvCenter: Vec3;
  tvR: number;
  rvotA: Vec3;
  rvotB: Vec3;
  rvotR: number;
  papAL: Vec3;
  papPM: Vec3;
  papR: number;
}

function anchors(m: HeartModel): Anchors {
  const a = m.anatomy;
  const L = m.lv.lengthCm;
  const laVol = a.la.volumeMl;
  const laRz = Math.cbrt(laVol / ((4 / 3) * Math.PI)) * 1.15;
  const laRx = laRz * 0.92,
    laRy = laRz * 0.8;
  const raR = Math.cbrt(a.ra.volumeMl / ((4 / 3) * Math.PI));
  const rvR = a.rv.basalDiameterCm / 2;
  return {
    mvCenter: v3(0.2, -0.9, 0),
    mvR: a.mitral.annulusDiameterCm / 2,
    avCenter: v3(-0.7, 1.35, -0.25),
    avAxis: normalize(v3(-0.15, 0.6, -0.78)),
    avR: a.aorta.annulusCm / 2,
    sinusR: a.aorta.sinusCm / 2,
    ascR: a.aorta.ascendingCm / 2,
    laCenter: v3(0.3, -1.3, -laRz * 0.95),
    laR: v3(laRx, laRy, laRz),
    raCenter: v3(-5.0 - raR * 0.15, -0.5 - raR * 0.1, -raR * 0.95 - 0.3),
    raR: v3(raR * 0.95, raR * 0.9, raR * 1.05),
    // RV modelled as a large ellipsoid carved by the LV epicardium → crescent wrapping the septum
    rvCenter: v3(-2.8, 1.3, L * 0.3),
    rvR: v3(2.1 + rvR, 2.2 + rvR, a.rv.lengthCm * 0.55),
    tvCenter: v3(-4.9, -0.2, 0.3),
    tvR: a.tricuspid.annulusDiameterCm / 2,
    rvotA: v3(-2.8, 3.6, 0.3),
    rvotB: v3(-0.6, 5.7, -2.6),
    rvotR: 1.1,
    papAL: v3(m.lv.a * 0.55, m.lv.b * 0.35, L * 0.58),
    papPM: v3(-m.lv.a * 0.25, -m.lv.b * 0.72, L * 0.58),
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
  const a = m.lv.a + 0.45, // mid-wall radius
    b = m.lv.b + 0.45;
  const rvc = A.rvCenter;
  return [
    { id: 'lv-apex', label: 'Ápex VI', p: v3(0, 0, L - 0.3), radius: 0.8 },
    { id: 'lv-apical-cavity', label: 'Cavidad apical VI', p: v3(0, 0, L * 0.8), radius: 0.9 },
    { id: 'lv-mid', label: 'Cavidad VI (mitad)', p: v3(0, 0, L * 0.5), radius: 1.2 },
    { id: 'mv', label: 'Válvula mitral', p: v3(0.2, -0.9, 0.7), radius: 1.2 },
    { id: 'av', label: 'Válvula aórtica', p: A.avCenter, radius: 1.0 },
    { id: 'lvot', label: 'TSVI', p: v3(-0.6, 0.9, 0.3), radius: 0.9 },
    { id: 'aortic-root', label: 'Raíz aórtica', p: add(A.avCenter, scale(A.avAxis, 2.2)), radius: 1.1 },
    { id: 'la', label: 'Aurícula izquierda', p: A.laCenter, radius: 1.5 },
    { id: 'ra', label: 'Aurícula derecha', p: A.raCenter, radius: 1.4 },
    { id: 'rv', label: 'Ventrículo derecho (entrada)', p: v3(rvc.x - 2.0, -0.3, L * 0.35), radius: 1.3 },
    { id: 'rv-anterior', label: 'Ventrículo derecho (anterior)', p: v3(-1.0, m.lv.b + m.lv.ivsd + 1.0, L * 0.35), radius: 0.9 },
    { id: 'rvot', label: 'TSVD', p: v3(-1.7, 4.7, -1.2), radius: 1.0 },
    { id: 'tv', label: 'Válvula tricúspide', p: v3(A.tvCenter.x, A.tvCenter.y, 1.0), radius: 1.2 },
    { id: 'ivs-anteroseptal', label: 'Septum anteroseptal', p: v3(-a * 0.5, b * 0.87, L * 0.45), radius: 0.9 },
    { id: 'ivs-inferoseptal', label: 'Septum inferoseptal', p: v3(-a * 1.0, -b * 0.1, L * 0.45), radius: 0.9 },
    { id: 'wall-inferolateral', label: 'Pared inferolateral', p: v3(a * 0.5, -b * 0.87, L * 0.45), radius: 0.9 },
    { id: 'wall-anterolateral', label: 'Pared anterolateral', p: v3(a * 1.0, b * 0.1, L * 0.45), radius: 0.9 },
    { id: 'wall-anterior', label: 'Pared anterior', p: v3(0, b * 1.0, L * 0.45), radius: 0.9 },
    { id: 'wall-inferior', label: 'Pared inferior', p: v3(0, -b * 1.0, L * 0.45), radius: 0.9 },
    { id: 'pap-al', label: 'Papilar anterolateral', p: A.papAL, radius: 0.7 },
    { id: 'desc-aorta', label: 'Aorta descendente', p: v3(1.5, -6.2, -2.5), radius: 1.0 },
    { id: 'pap-pm', label: 'Papilar posteromedial', p: A.papPM, radius: 0.7 },
    { id: 'ias', label: 'Septum interauricular', p: v3(-2.5, -1.6, -2.2), radius: 1.0 },
  ];
}

/**
 * Classify a heart-frame point. Writes into `out` and returns true when the point belongs to a
 * cardiac structure (including pericardium/effusion); false when outside the heart.
 */
export function classifyHeart(m: HeartModel, hp: HeartPose, x: number, y: number, z: number, out: TissueSample): boolean {
  const bc = m.boundCenter;
  const bdx = x - bc.x,
    bdy = y - bc.y,
    bdz = z - bc.z;
  if (bdx * bdx + bdy * bdy + bdz * bdz > m.boundRadius * m.boundRadius) return false;

  const A = anchorsCached(m);
  const lv = m.lv;
  const zAnn = hp.zAnn;

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
    if (hit.d < t) {
      const o = V.cuspOffsets[i]! + Math.min(1, Math.floor(hit.frac * 2)) * 6;
      const dx = V.segs[o + 3]!,
        dy = V.segs[o + 4]!,
        dz = V.segs[o + 5]!;
      setSample(out, Tissue.Valve, hit.d - t, dy * wz - dz * wy, dz * wx - dx * wz, dx * wy - dy * wx, x, y, z, m.anatomy.aorticValve.calcification, Structure.AorticValve);
      return true;
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
    const dR = sdTorusZ(x, y, z, r[0], r[1], r[2], r[3], 0.11);
    if (dR < 0) {
      setSample(out, Tissue.Fibrous, dR, x - r[0], y - r[1], 0, x, y, z, 0.15 * m.anatomy.mitral.calcification, Structure.MitralAnnulus);
      return true;
    }
    const q = V.tvRing;
    const dT = sdTorusZ(x, y, z, q[0], q[1], q[2], q[3], 0.09);
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
  const dEll = sdEllipsoid(x, y, z, 0, 0, hp.zcCav, hp.aCav, hp.bCav, hp.cCav);
  // clip at annulus plane (z ≥ zAnn) with a smooth max
  const dCav = smax(dEll, zAnn - z, 0.6);
  // local wall thickness by azimuth (septal thicker if IVS > PW) & level, regional motion by segment
  const az = fastAtan2(y, x);
  const levelFrac = Math.min(1, Math.max(0, (z - zAnn) / Math.max(hp.lengthNow, 1)));
  const seg = ahaSegment(az, levelFrac);
  const amp = m.segAmp[seg] ?? 1;
  // Regional wall motion: reduce local inward displacement → local cavity SDF shifted outward
  const regional = (1 - amp) * (lv.a - hp.aCav) * 1.0;
  const dCavR = dCav - regional;
  // wall thickness: interpolate septal (az≈π, i.e. x<0) vs free wall
  const septalness = 0.5 - 0.5 * Math.cos(az); // 1 at septum (az=π), 0 at lateral
  const tED = lv.lvpwd + (lv.ivsd - lv.lvpwd) * septalness;
  // thickening: epicardial radius growth from incompressibility (approx uniform thickening factor)
  const thickFactor = (hp.aEpi - hp.aCav) / Math.max((lv.a + (lv.ivsd + lv.lvpwd) / 2) - lv.a, 0.2);
  // low-frequency thickness modulation around the wall (trabeculation / non-uniform myocardium)
  const wallMod = 0.86 + 0.28 * latticeNoise3(Math.cos(az) * 1.6 + 7.3, Math.sin(az) * 1.6 + 2.1, levelFrac * 2.4, m.wallNoise);
  const tNow = tED * Math.max(0.6, thickFactor * (0.6 + 0.4 * amp) + (1 - amp) * 0.0) * wallMod;
  const apexThick = m.anatomy.lv.apexWallThicknessCm;

  // Papillary muscles inside the cavity
  if (dCavR < 0) {
    const s = hp.radialScale;
    const pa = A.papAL,
      pm = A.papPM;
    const ls = hp.longScale;
    const dPa = sdCapsule(x, y, z, pa.x * s, pa.y * s, pa.z * ls, pa.x * s * 0.9, pa.y * s * 0.9, pa.z * ls - 1.6 * ls, A.papR * (0.9 + 0.3 * hp.state.contraction));
    const dPm = sdCapsule(x, y, z, pm.x * s, pm.y * s, pm.z * ls, pm.x * s * 0.9, pm.y * s * 0.9, pm.z * ls - 1.6 * ls, A.papR * (0.9 + 0.3 * hp.state.contraction));
    const dPap = Math.min(dPa, dPm);
    if (dPap < 0) {
      setSample(out, Tissue.Myocardium, dPap, x, y, 0, x / s, y / s, z / ls, 0, Structure.PapillaryMuscle);
      return true;
    }
    // LV blood
    setSample(out, Tissue.Blood, dCavR, x / hp.aCav, y / hp.bCav, (z - hp.zcCav) / hp.cCav, x / s, y / s, (z - lv.lengthCm) / ls, 0, Structure.LvCavity);
    return true;
  }
  const wallT = z > lv.lengthCm - 0.5 ? apexThick : tNow;
  // Ventricular wall: shell around the *unclipped* ellipsoid, apical to (slightly above) the annulus.
  // The annular plane itself is not a wall: it holds the mitral orifice, the LVOT and fibrous tissue.
  const dEllR = dEll - regional;
  if (dEllR >= 0 && dEllR < wallT && z >= zAnn - 0.25) {
    const s = hp.radialScale;
    const ls = hp.longScale;
    let structure = Structure.LvWallLateral;
    if (z > lv.lengthCm - 0.6) structure = Structure.LvApex;
    else if (septalness > 0.7) structure = Structure.LvWallSeptal;
    else if (Math.sin(az) > 0.5) structure = Structure.LvWallAnterior;
    else if (Math.sin(az) < -0.5) structure = Structure.LvWallInferior;
    const dIn = -Math.min(dEllR, wallT - dEllR);
    const nearEpi = wallT - dEllR < dEllR;
    const sign = nearEpi ? 1 : -1;
    setSample(out, Tissue.Myocardium, dIn, sign * x / hp.aCav, sign * y / hp.bCav, sign * (z - hp.zcCav) / hp.cCav, x / s, y / s, (z - lv.lengthCm) / ls, 0, structure);
    return true;
  }
  // Annular plane region (inside the ellipsoid but basal to the annulus): mitral orifice is blood
  // continuous with the LA; the LVOT is handled by the aortic tube below; the rest is fibrous tissue.
  const inAnnularRegion = dEllR < 0 && z < zAnn;
  if (inAnnularRegion) {
    const mdx = x - A.mvCenter.x,
      mdy = y - A.mvCenter.y;
    if (Math.hypot(mdx, mdy) < A.mvR * 0.98) {
      setSample(out, Tissue.Blood, -0.3, 0, 0, 1, x, y, z, 0, Structure.LvCavity);
      return true;
    }
  }

  // ---------- Aortic root / LVOT (tube along avAxis) ----------
  {
    const c = A.avCenter;
    const ax = A.avAxis;
    const czz = c.z + zAnn * 0.5;
    const dx = x - c.x,
      dy = y - c.y,
      dz = z - czz;
    const t = dx * ax.x + dy * ax.y + dz * ax.z; // along axis, 0 at annulus, negative toward LV
    if (t > -1.6 && t < 7.5) {
      const qx = dx - ax.x * t,
        qy = dy - ax.y * t,
        qz = dz - ax.z * t;
      const rr = Math.sqrt(qx * qx + qy * qy + qz * qz);
      // radius profile: LVOT (t<0) → annulus → sinuses (t≈1) → STJ → ascending
      let R: number;
      if (t < 0) R = A.avR * 0.95 + (m.anatomy.aorta.lvotDiameterCm / 2 - A.avR * 0.95) * Math.min(1, -t / 1.2);
      else if (t < 2.2) R = A.avR + (A.sinusR - A.avR) * Math.sin((Math.PI * t) / 2.2);
      else R = A.ascR;
      const wall = 0.2;
      if (rr < R) {
        setSample(out, Tissue.Blood, rr - R, qx / rr, qy / rr, qz / rr, x, y, z - zAnn * 0.5, 0, t < 0 ? Structure.Lvot : Structure.AorticRoot);
        return true;
      }
      if (rr < R + wall) {
        const dIn = -Math.min(rr - R, R + wall - rr);
        setSample(out, Tissue.VesselWall, dIn, qx / rr, qy / rr, qz / rr, x, y, z, 0, Structure.AorticRoot);
        return true;
      }
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
    const bo = hp.laBooster;
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
    const zBotR = A.tvCenter.z + hp.tvZ + 0.25;
    const czR = (zTopR + zBotR) / 2,
      rzR = (zBotR - zTopR) / 2;
    const dR = sdEllipsoid(x, y, z, ra.x, ra.y, czR, rr.x * bo, rr.y * bo, rzR);
    if (dR < 0) {
      setSample(out, Tissue.Blood, dR, (x - ra.x) / rr.x, (y - ra.y) / rr.y, (z - czR) / rzR, x, y, z, 0, Structure.RaCavity);
      return true;
    }
    if (dR < 0.22) {
      setSample(out, Tissue.Myocardium, -Math.min(dR, 0.22 - dR), (x - ra.x) / rr.x, (y - ra.y) / rr.y, (z - czR) / rzR, x, y, z, 0, Structure.RaWall);
      return true;
    }
    // interatrial septum: tissue bridging the two atria
    if (d < 0.9 && dR < 0.9 && z < zAnn + 0.4) {
      setSample(out, Tissue.Myocardium, -Math.min(0.9 - d, 0.9 - dR), 1, 0, 0, x, y, z, 0, Structure.InteratrialSeptum);
      return true;
    }
  }

  // ---------- RV cavity, free wall, RVOT ----------
  {
    const rc = A.rvCenter,
      rr = A.rvR;
    const s = hp.rvScale;
    const czR = rc.z + hp.tvZ * 0.5;
    const dRvEll = sdEllipsoid(x, y, z, rc.x, rc.y, czR, rr.x * s, rr.y * s, rr.z);
    // carve out the LV epicardium (+ a small septal gap) so the RV wraps around the septum
    const dLvEpi = sdEllipsoid(x, y, z, 0, 0, hp.zcCav, hp.aEpi, hp.bEpi, hp.cCav + apexThick * 0.7);
    const dRv = smax(dRvEll, -(dLvEpi - 0.05), 0.4);
    const dRvot = sdCapsule(x, y, z, A.rvotA.x, A.rvotA.y, A.rvotA.z, A.rvotB.x, A.rvotB.y, A.rvotB.z, A.rvotR * (0.85 + 0.15 * (1 - hp.state.contraction)));
    const dCavRv = Math.min(dRv, dRvot);
    if (dCavRv < 0) {
      setSample(out, Tissue.Blood, dCavRv, (x - rc.x) / rr.x, (y - rc.y) / rr.y, (z - czR) / rr.z, x / s, y / s, z, 0, dRvot < dRv ? Structure.Rvot : Structure.RvCavity);
      return true;
    }
    const fw = m.anatomy.rv.freeWallThicknessCm * (1 + 0.35 * hp.state.contraction);
    if (dCavRv < fw) {
      setSample(out, Tissue.Myocardium, -Math.min(dCavRv, fw - dCavRv), (x - rc.x) / rr.x, (y - rc.y) / rr.y, (z - czR) / rr.z, x / s, y / s, z, 0, Structure.RvWall);
      return true;
    }
  }

  // ---------- Pericardium & effusion (outer envelope of all epicardial surfaces) ----------
  {
    const dLvEpi = sdEllipsoid(x, y, z, 0, 0, hp.zcCav, hp.aEpi, hp.bEpi, hp.cCav + apexThick * 0.7);
    const rc = A.rvCenter,
      rr = A.rvR;
    const fw = m.anatomy.rv.freeWallThicknessCm;
    const dRvEpi = sdEllipsoid(x, y, z, rc.x, rc.y, rc.z, rr.x * hp.rvScale + fw, rr.y * hp.rvScale + fw, rr.z + fw);
    const la = A.laCenter,
      lr = A.laR;
    const dLaEpi = sdEllipsoid(x, y, z, la.x, la.y, la.z, lr.x + 0.25, lr.y + 0.25, lr.z + 0.25);
    const ra = A.raCenter,
      rar = A.raR;
    const dRaEpi = sdEllipsoid(x, y, z, ra.x, ra.y, ra.z, rar.x + 0.22, rar.y + 0.22, rar.z + 0.22);
    const dRvotEpi = sdCapsule(x, y, z, A.rvotA.x, A.rvotA.y, A.rvotA.z, A.rvotB.x, A.rvotB.y, A.rvotB.z, A.rvotR + fw);
    const dEpi = Math.min(dLvEpi, dRvEpi, dLaEpi, dRaEpi, dRvotEpi);
    const eff = hp.effusion;
    if (dEpi < 0.12) {
      setSample(out, Tissue.Pericardium, -Math.min(Math.max(dEpi, 0), 0.12 - Math.max(dEpi, 0)), x / hp.aEpi, y / hp.bEpi, (z - hp.zcCav) / hp.cCav, x, y, z, 0, Structure.Pericardium);
      return true;
    }
    if (eff > 0 && dEpi < 0.12 + eff) {
      setSample(out, Tissue.Fluid, dEpi - 0.12 - eff, x / hp.aEpi, y / hp.bEpi, (z - hp.zcCav) / hp.cCav, x, y, z, 0, Structure.PericardialEffusion);
      return true;
    }
    if (eff > 0 && dEpi < 0.12 + eff + 0.12) {
      setSample(out, Tissue.Pericardium, 0, x / hp.aEpi, y / hp.bEpi, (z - hp.zcCav) / hp.cCav, x, y, z, 0, Structure.Pericardium);
      return true;
    }
  }
  return false;
}

interface AnchorsCached extends Anchors {
  avE1: Vec3;
  avE2: Vec3;
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
    a = { ...base, avE1: e1, avE2: e2 };
    (m as HeartModel & { _anchors?: AnchorsCached })._anchors = a;
  }
  return a;
}

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
    { kind: 'ellipsoid', center: v3(0, 0, lv.zc), radii: v3(lv.a + t, lv.b + t, lv.c + 0.5), color: 0xc0413f, opacity: 0.35 },
    { kind: 'ellipsoid', center: A.rvCenter, radii: v3(A.rvR.x * 0.75, A.rvR.y * 0.62, A.rvR.z * 0.9), color: 0x8a3a6a, opacity: 0.28 },
    { kind: 'ellipsoid', center: A.laCenter, radii: A.laR, color: 0xb05050, opacity: 0.25 },
    { kind: 'ellipsoid', center: A.raCenter, radii: A.raR, color: 0x7a4a7a, opacity: 0.25 },
    { kind: 'tube', center: A.avCenter, end: rootEnd, radii: v3(A.sinusR, A.sinusR, A.sinusR), color: 0xd86a6a, opacity: 0.3 },
  ];
}
