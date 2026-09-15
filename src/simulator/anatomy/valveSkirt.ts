import type { Structure } from './tissue';
import { fastAtan2 } from '@/core/noise';
import type { Vec3 } from '@/core/vec3';

export const TWO_PI = Math.PI * 2;

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
export function saddleOffset(phi: number, phiA: number, saddle: number): number {
  const sn = Math.sin(phi - phiA);
  return saddle * sn * sn;
}

/** Build a (ρ, z) profile polyline from per-segment angles (from +z toward inward −ρ) and a segment length. */
export function buildProfile(R: number, angles: number[], segLen: number): Float64Array {
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
export const skirtHit = { d: 0, frac: 0, zone: 0, w: 0 };

/**
 * Distance from a heart-frame point to an AV-valve skirt (minimum over its leaflet zones). Radial zones
 * are revolution surfaces of their profile; parallel zones hang the profile from the annulus arc along
 * the zone direction (the anterior mitral leaflet crosses the orifice centre to reach its coaptation
 * line), with the reach scaled per fibre so the closed free edges meet on a curved line and scalloped
 * zones show their lobes. Writes `skirtHit`; returns the local thickness (for the inside test).
 */
export function skirtDistance(x: number, y: number, z: number, k: SkirtDesc): number {
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
export function skirtTip(k: SkirtDesc, zn: SkirtZone, param: number, out: number[]): void {
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

/**
 * Signed distance to the tricuspid inflow column: the annular circle, narrowing below the hinges into the RV
 * crescent and closing on the atrial side where the atrium ends (0.3·TAPSE basal to the annulus in systole).
 */
export function tvInflowSdf(x: number, y: number, z: number, tv: SkirtDesc, tvZ: number): number {
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

/**
 * Semilunar cusps as 2-segment chains in the (inward, axis) plane: closed = shallow cup with the free edges
 * meeting near the axis, open = lying along the wall; the two segment angles are solved (bisection) so the
 * free edge reaches the orifice radius for the given openness. Fills `segs` (count × 12) and `widths` (count × 3).
 */
export function buildCuspChains(cx: number, cy: number, cz: number, ax: Vec3, e1: Vec3, e2: Vec3, R: number, openness: number, count: number, segs: Float64Array, widths: Float64Array, phi0: number): number {
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
