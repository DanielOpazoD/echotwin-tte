/**
 * Signed-distance primitives (cm). All return negative inside. Kept allocation-free.
 */
export function sdSphere(px: number, py: number, pz: number, cx: number, cy: number, cz: number, r: number): number {
  const dx = px - cx,
    dy = py - cy,
    dz = pz - cz;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
}

/** Approximate ellipsoid SDF (bound), good enough for interfaces a few mm thick. */
export function sdEllipsoid(
  px: number,
  py: number,
  pz: number,
  cx: number,
  cy: number,
  cz: number,
  rx: number,
  ry: number,
  rz: number,
): number {
  const dx = (px - cx) / rx,
    dy = (py - cy) / ry,
    dz = (pz - cz) / rz;
  const k0 = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const ex = dx / rx,
    ey = dy / ry,
    ez = dz / rz;
  const k1 = Math.sqrt(ex * ex + ey * ey + ez * ez);
  if (k1 < 1e-9) return -Math.min(rx, ry, rz);
  return (k0 * (k0 - 1)) / k1;
}

/** Capsule / tube between a and b with radius r. */
export function sdCapsule(
  px: number,
  py: number,
  pz: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  r: number,
): number {
  const pax = px - ax,
    pay = py - ay,
    paz = pz - az;
  const bax = bx - ax,
    bay = by - ay,
    baz = bz - az;
  const bb = bax * bax + bay * bay + baz * baz;
  let h = bb > 0 ? (pax * bax + pay * bay + paz * baz) / bb : 0;
  h = h < 0 ? 0 : h > 1 ? 1 : h;
  const dx = pax - bax * h,
    dy = pay - bay * h,
    dz = paz - baz * h;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
}

/** Infinite cylinder along unit axis (ux,uy,uz) through (cx,cy,cz). */
export function sdCylinder(
  px: number,
  py: number,
  pz: number,
  cx: number,
  cy: number,
  cz: number,
  ux: number,
  uy: number,
  uz: number,
  r: number,
): number {
  const dx = px - cx,
    dy = py - cy,
    dz = pz - cz;
  const t = dx * ux + dy * uy + dz * uz;
  const qx = dx - ux * t,
    qy = dy - uy * t,
    qz = dz - uz * t;
  return Math.sqrt(qx * qx + qy * qy + qz * qz) - r;
}

/**
 * Distance from point to a rectangle patch in 3D given by origin o, unit tangent u (length lu),
 * unit tangent v (length lv) — a thin leaflet/cusp is |d| < thickness.
 */
export function sdRectPatch(
  px: number,
  py: number,
  pz: number,
  ox: number,
  oy: number,
  oz: number,
  ux: number,
  uy: number,
  uz: number,
  lu: number,
  vx: number,
  vy: number,
  vz: number,
  lv: number,
): number {
  const dx = px - ox,
    dy = py - oy,
    dz = pz - oz;
  let a = dx * ux + dy * uy + dz * uz;
  let b = dx * vx + dy * vy + dz * vz;
  a = a < 0 ? 0 : a > lu ? lu : a;
  b = b < -lv ? -lv : b > lv ? lv : b;
  const qx = ox + ux * a + vx * b - px;
  const qy = oy + uy * a + vy * b - py;
  const qz = oz + uz * a + vz * b - pz;
  return Math.sqrt(qx * qx + qy * qy + qz * qz);
}

export const smin = (a: number, b: number, k: number): number => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};
export const smax = (a: number, b: number, k: number): number => -smin(-a, -b, k);

/** Torus with axis z through (cx,cy,cz): major radius R, tube radius r. */
export function sdTorusZ(px: number, py: number, pz: number, cx: number, cy: number, cz: number, R: number, r: number): number {
  const dx = px - cx,
    dy = py - cy;
  const q = Math.sqrt(dx * dx + dy * dy) - R;
  const dz = pz - cz;
  return Math.sqrt(q * q + dz * dz) - r;
}

/** Result of a chain query: distance and the fractional position along the chain (0 hinge → 1 tip). */
export interface ChainHit {
  d: number;
  frac: number;
}

/**
 * Distance to a chain of flat rectangular segments (a bent leaflet / cusp). `segs` holds, per
 * segment, [sx,sy,sz, dx,dy,dz] (start point and unit direction) starting at `offset`; all segments
 * share the width axis (wx,wy,wz), half width and length. Writes distance and along-fraction to `out`.
 */
export function sdSegmentChain(
  px: number,
  py: number,
  pz: number,
  segs: Float64Array,
  offset: number,
  nSeg: number,
  segLen: number,
  wx: number,
  wy: number,
  wz: number,
  halfW: number,
  out: ChainHit,
  taper = 0,
): number {
  let best = Infinity;
  let bestFrac = 0;
  for (let i = 0; i < nSeg; i++) {
    // optional width taper along the chain (sector-shaped cusps: wide at the hinge, narrow at the free edge)
    const hw = halfW * (1 - (taper * (i + 0.5)) / nSeg);
    const o = offset + i * 6;
    const sx = segs[o]!,
      sy = segs[o + 1]!,
      sz = segs[o + 2]!,
      dx = segs[o + 3]!,
      dy = segs[o + 4]!,
      dz = segs[o + 5]!;
    const rx = px - sx,
      ry = py - sy,
      rz = pz - sz;
    let a = rx * dx + ry * dy + rz * dz;
    a = a < 0 ? 0 : a > segLen ? segLen : a;
    let b = rx * wx + ry * wy + rz * wz;
    b = b < -hw ? -hw : b > hw ? hw : b;
    const qx = sx + dx * a + wx * b - px;
    const qy = sy + dy * a + wy * b - py;
    const qz = sz + dz * a + wz * b - pz;
    const d = Math.sqrt(qx * qx + qy * qy + qz * qz);
    if (d < best) {
      best = d;
      bestFrac = (i + a / segLen) / nSeg;
    }
  }
  out.d = best;
  out.frac = bestFrac;
  return best;
}
