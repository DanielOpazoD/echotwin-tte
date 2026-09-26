import type { Structure } from './tissue';
import { fastAtan2 } from '@/core/noise';
import type { Vec3 } from '@/core/vec3';

export const TWO_PI = Math.PI * 2;

// Constants shared with the GLSL port (glslHeart.ts interpolates them): change them here only.
/** Skirt bounding box above / below the annulus plane and beyond the annulus radius (cm). */
export const SKIRT_ABOVE_CM = 3.5;
export const SKIRT_BELOW_CM = 2.5;
export const SKIRT_RADIAL_MARGIN_CM = 1.5;
/** Parallel-fibre zones end at this lateral fraction of the annulus radius. */
export const SKIRT_FIBRE_CLIP = 0.98;
/** Lateral fraction where the parallel zone starts to taper, and the taper width. */
export const SKIRT_TAPER_START = 0.8;
export const SKIRT_TAPER_WIDTH = 0.18;
/** Lateral period of the scallop lobes (fraction of the annulus radius). */
export const SKIRT_LOBE_PERIOD = 0.8;
/** Leaflet thickness profile: base and free-edge share of the nominal thickness, floor (cm), and the share kept at the commissures vs the body. */
export const SKIRT_THICK_BASE = 0.6;
export const SKIRT_THICK_EDGE = 0.4;
export const SKIRT_THICK_FLOOR_CM = 0.035;
export const SKIRT_THICK_COMMISSURE = 0.4;
export const SKIRT_THICK_BODY = 0.6;

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
  /** Saddle height (cm, high to low) and the azimuth of its high points (the most atrial, decision 138). */
  saddle: number;
  saddlePhi: number;
  /**
   * Tilt of the annulus (decision 148): apical offset tiltC·cos φ + tiltS·sin φ + lift added to the saddle; the
   * tricuspid annulus lifts its anterior half toward the level of the aortic root.
   */
  tiltC: number;
  tiltS: number;
  lift: number;
  /** 1 when closed (coaptation-line shaping and scallops fully applied), 0 when open. */
  closed: number;
  zones: SkirtZone[];
  /**
   * Radial extension of the annulus (cm) at azimuths TV_BUMP_PHI0 + k·TV_BUMP_STEP_RAD, k = 0…TV_BUMP_N − 1 (decisions
   * 224 and 226), none
   * outside; the leaflets, the ring and the inflow column are drawn in coordinates where it is a circle again.
   */
  bump: Float64Array;
}

/**
 * Apical offset (cm) of the tricuspid annulus from the level of its centre at azimuth `phi`: a saddle `saddle` cm high
 * whose high (most atrial) points lie at `saddlePhi` and opposite, centred on that level (decision 138), plus a tilt
 * tiltC·cos φ + tiltS·sin φ + lift (decision 148). The leaflets, the ring, the inflow column and the floors of the atrium
 * and the ventricle all hang from this surface.
 */
export function annulusOffset(
  phi: number,
  saddlePhi: number,
  saddle: number,
  tiltC: number,
  tiltS: number,
  lift: number,
): number {
  const sn = Math.sin(phi - saddlePhi);
  return saddle * (sn * sn - 0.5) + tiltC * Math.cos(phi) + tiltS * Math.sin(phi) + lift;
}

/** The annulus offset of a skirt at azimuth `phi` around its centre. */
export function skirtOffset(k: SkirtDesc, phi: number): number {
  return annulusOffset(phi, k.saddlePhi, k.saddle, k.tiltC, k.tiltS, k.lift);
}

/** The annulus offset above a heart-frame point, by its azimuth around the annulus centre. */
export function skirtOffsetAt(k: SkirtDesc, x: number, y: number): number {
  return skirtOffset(k, fastAtan2(y - k.cy, x - k.cx));
}

/**
 * Azimuth of the first entry, step (rad) and length of the tricuspid annulus extension table (decisions 224 and 226):
 * −30°, −20°, …, 80°.
 */
export const TV_BUMP_PHI0 = -Math.PI / 6;
export const TV_BUMP_STEP_RAD = Math.PI / 18;
export const TV_BUMP_N = 12;

/** The annulus extension (cm) at azimuth `phi` (rad, −π…π), interpolated in its table. */
export function skirtBumpAt(k: SkirtDesc, phi: number): number {
  const f = (phi - TV_BUMP_PHI0) / TV_BUMP_STEP_RAD;
  if (f <= 0 || f >= TV_BUMP_N - 1) return 0;
  const i = Math.floor(f);
  const t = f - i;
  return k.bump[i]! * (1 - t) + k.bump[i + 1]! * t;
}

/**
 * Scale that takes an offset (dx, dy) from the annulus centre to the coordinates where the extended annulus is the
 * circle of radius R (decision 224): the radius shrinks by R / (R + extension) at its azimuth.
 */
export function skirtWarpScale(k: SkirtDesc, dx: number, dy: number): number {
  const b = skirtBumpAt(k, Math.atan2(dy, dx));
  return b > 0 ? k.R / (k.R + b) : 1;
}

/**
 * Radial shrink (cm; negative widens) of the tricuspid inflow column at height `h` below the annulus (positive
 * apical). Above the annulus it closes after `close` cm. Below it the column keeps the annular width over the length
 * of the septal and posterior leaflets (1.6 cm), widening by up to `bulge` toward the free wall, and only then narrows
 * at the rate it used to narrow from the annulus into the
 * crescent: the right ventricular base is at least as wide as the annulus (basal diameter 3.4 cm for a 3.3 cm annulus
 * in the normal case). Until decision 138 the column narrowed 0.9 cm within 1.5 cm, and the open leaflets, kept 2.5 mm
 * inside the cavity, formed a funnel that pointed 25-53° toward the centre of the orifice.
 */
export function tvInflowTaper(h: number, close: number, bulge: number): number {
  if (h < -close) return 2 * (-h - close);
  if (h <= 0) return 0;
  const past = Math.max(0, h - 1.6);
  return -bulge * Math.min(1, h / 0.8) + 0.25 * past + 0.25 * past * past;
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

/** Result of the last skirt query: distance, along-fraction (0 hinge → 1 free edge), zone index, zone weight and
 *  the surface normal (heart frame) of the closest leaflet segment — computed from the profile edge like the mitral
 *  valve, so the specular echo follows the leaflet orientation instead of a fixed radial direction. */
export const skirtHit = { d: 0, frac: 0, zone: 0, w: 0, nx: 0, ny: 0, nz: 1 };

/**
 * Distance from a heart-frame point to an AV-valve skirt (minimum over its leaflet zones). Radial zones
 * are revolution surfaces of their profile; parallel zones hang the profile from the annulus arc along
 * the zone direction (the anterior mitral leaflet crosses the orifice centre to reach its coaptation
 * line), with the reach scaled per fibre so the closed free edges meet on a curved line and scalloped
 * zones show their lobes. Writes `skirtHit`; returns the local thickness (for the inside test).
 */
export function skirtDistance(x: number, y: number, z: number, k: SkirtDesc): number {
  const w0 = skirtWarpScale(k, x - k.cx, y - k.cy);
  const dx = (x - k.cx) * w0,
    dy = (y - k.cy) * w0;
  const zr0 = z - k.cz;
  const rho = Math.sqrt(dx * dx + dy * dy);
  if (zr0 > SKIRT_ABOVE_CM || zr0 < -SKIRT_BELOW_CM || rho > k.R + SKIRT_RADIAL_MARGIN_CM) {
    skirtHit.d = 1e3;
    return 0;
  }
  const phi = fastAtan2(dy, dx);
  // the leaflets hang from the annulus at its height there and meet at a common coaptation point in the centre: the
  // annulus offset weighs by the distance from the centre (decision 148; a tilted annulus otherwise shifted each leaflet
  // whole and left their closed tips at different heights)
  const zr = zr0 - skirtOffset(k, phi) * Math.min(1, rho / k.R);
  let best = Infinity,
    bestFrac = 0,
    bestW = 0,
    bestZone = 0,
    bestNx = 0,
    bestNy = 0,
    bestNz = 1;
  for (let zi = 0; zi < k.zones.length; zi++) {
    const zn = k.zones[zi]!;
    const ca = Math.cos(zn.phi),
      sa = Math.sin(zn.phi);
    let w: number, rhoS: number, s: number;
    if (zn.kind === 1) {
      const v = dx * ca + dy * sa;
      const u = -dx * sa + dy * ca;
      const t = Math.abs(u) / k.R;
      if (t >= SKIRT_FIBRE_CLIP) continue;
      const vAtt = Math.sqrt(k.R * k.R - u * u);
      rhoS = k.R - (vAtt - v);
      const tw = (t - SKIRT_TAPER_START) / SKIRT_TAPER_WIDTH;
      w = tw <= 0 ? 1 : 1 - tw * tw * (3 - 2 * tw);
      let sc = Math.sqrt(1 - t * t) * (1 + zn.c * t * t);
      if (zn.lobes > 0) sc *= 1 + zn.lobes * Math.cos((TWO_PI * t) / SKIRT_LOBE_PERIOD);
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
        // surface normal from the profile edge (like the mitral valve): the edge direction in the
        // (rho, z) plane is (ex, ez), so the outward normal is (-ez, ex) rotated into 3D by the
        // radial direction at this point. For radial zones the radial direction is (dx, dy)/rho;
        // for parallel zones it is the zone's perpendicular (−sa, ca).
        let rx: number, ry: number;
        if (zn.kind === 1) {
          rx = -sa;
          ry = ca;
        } else {
          rx = rho > 1e-6 ? dx / rho : Math.cos(zn.phi);
          ry = rho > 1e-6 ? dy / rho : Math.sin(zn.phi);
        }
        bestNx = -ez * rx;
        bestNy = -ez * ry;
        bestNz = ex;
      }
    }
  }
  skirtHit.d = best;
  skirtHit.frac = bestFrac;
  skirtHit.zone = bestZone;
  skirtHit.w = bestW;
  skirtHit.nx = bestNx;
  skirtHit.ny = bestNy;
  skirtHit.nz = bestNz;
  // leaflets are thickest at the free edge (rough zone) and thin out toward the commissures
  return (
    (k.thickness * (SKIRT_THICK_BASE + SKIRT_THICK_EDGE * bestFrac) * 0.5 + SKIRT_THICK_FLOOR_CM) *
    (SKIRT_THICK_COMMISSURE + SKIRT_THICK_BODY * bestW)
  );
}

/** Free-edge point of a skirt zone at lateral fraction t (parallel zones) or azimuth offset Δφ (radial zones). */
export function skirtTip(k: SkirtDesc, zn: SkirtZone, param: number, out: number[]): void {
  const P = zn.prof;
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
    out[2] =
      k.cz +
      P[7]! * s +
      skirtOffset(k, Math.atan2(out[1] - k.cy, out[0] - k.cx)) *
        Math.min(1, Math.hypot(out[0] - k.cx, out[1] - k.cy) / k.R);
  } else {
    const dphi = param;
    const q = dphi / zn.halfSpan;
    const s = 1 - zn.c * q * q * k.closed;
    const rTip = k.R + (P[6]! - k.R) * s;
    const ang = zn.phi + dphi;
    out[0] = k.cx + rTip * Math.cos(ang);
    out[1] = k.cy + rTip * Math.sin(ang);
    out[2] = k.cz + P[7]! * s + skirtOffset(k, ang) * Math.min(1, Math.abs(rTip) / k.R);
  }
  // back from the circle to the extended annulus (decision 224)
  const ex = out[0] - k.cx,
    ey = out[1] - k.cy;
  const e = 1 + skirtBumpAt(k, Math.atan2(ey, ex)) / k.R;
  out[0] = k.cx + ex * e;
  out[1] = k.cy + ey * e;
}

/**
 * Signed distance to the tricuspid inflow column: the annular circle, narrowing below the hinges into the RV
 * crescent and closing on the atrial side where the atrium ends (0.3·TAPSE basal to the annulus in systole).
 */
export function tvInflowSdf(x: number, y: number, z: number, tv: SkirtDesc, tvZ: number): number {
  const w0 = skirtWarpScale(tv, x - tv.cx, y - tv.cy);
  const dx = (x - tv.cx) * w0,
    dy = (y - tv.cy) * w0;
  const rho = Math.sqrt(dx * dx + dy * dy);
  // the same annulus surface as the leaflets and the ring
  const phi = fastAtan2(dy, dx);
  const h = z - (tv.cz + skirtOffset(tv, phi));
  // the bulge goes toward the free wall, not into the septum (the septal leaflet lies on it: zone 1)
  const bulge = TV_INFLOW_BULGE_CM * 0.5 * (1 - Math.cos(phi - (tv.zones[1]?.phi ?? 0)));
  return rho - tv.R + 0.04 + tvInflowTaper(h, 0.25 + 0.3 * tvZ, bulge);
}

/** How far the right ventricular inflow widens beyond the annulus toward the free wall (cm, decision 138). */
export const TV_INFLOW_BULGE_CM = 0.2;

/**
 * Semilunar cusps as 2-segment chains in the (inward, axis) plane: closed = shallow cup with the free edges
 * meeting near the axis, open = lying along the wall; the two segment angles are solved (bisection) so the
 * free edge reaches the orifice radius for the given openness. Fills `segs` (count × 12) and `widths` (count × 3).
 */
export function buildCuspChains(
  cx: number,
  cy: number,
  cz: number,
  ax: Vec3,
  e1: Vec3,
  e2: Vec3,
  R: number,
  openness: number,
  count: number,
  segs: Float64Array,
  widths: Float64Array,
  phi0: number,
): number {
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
