import { hash3 } from './random';

/**
 * 3D value noise, trilinearly interpolated on an integer lattice. Cheap enough for per-sample
 * evaluation in the procedural slicer. Evaluated in *material* coordinates so the resulting
 * speckle is attached to tissue and advects with it (spec 7.4).
 */
export function valueNoise3(x: number, y: number, z: number, seed: number): number {
  const x0 = Math.floor(x),
    y0 = Math.floor(y),
    z0 = Math.floor(z);
  const fx = x - x0,
    fy = y - y0,
    fz = z - z0;
  // smoothstep fade
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const uz = fz * fz * (3 - 2 * fz);
  const c000 = hash3(x0, y0, z0, seed);
  const c100 = hash3(x0 + 1, y0, z0, seed);
  const c010 = hash3(x0, y0 + 1, z0, seed);
  const c110 = hash3(x0 + 1, y0 + 1, z0, seed);
  const c001 = hash3(x0, y0, z0 + 1, seed);
  const c101 = hash3(x0 + 1, y0, z0 + 1, seed);
  const c011 = hash3(x0, y0 + 1, z0 + 1, seed);
  const c111 = hash3(x0 + 1, y0 + 1, z0 + 1, seed);
  const x00 = c000 + (c100 - c000) * ux;
  const x10 = c010 + (c110 - c010) * ux;
  const x01 = c001 + (c101 - c001) * ux;
  const x11 = c011 + (c111 - c011) * ux;
  const y0v = x00 + (x10 - x00) * uy;
  const y1v = x01 + (x11 - x01) * uy;
  return y0v + (y1v - y0v) * uz;
}

/**
 * Lattice value noise: the integer lattice values are precomputed once per seed (128³ bytes) so a
 * sample costs 8 array reads instead of 8 hashes. Periodic every 128 units; combined with a second
 * octave at 2.1× the period is not perceptible at speckle scale. Deterministic per seed.
 */
const LAT = 128;
const LAT_MASK = LAT - 1;
const latticeCache = new Map<number, Uint8Array>();

export function noiseLattice(seed: number): Uint8Array {
  let l = latticeCache.get(seed);
  if (l) return l;
  l = new Uint8Array(LAT * LAT * LAT);
  let i = 0;
  for (let z = 0; z < LAT; z++)
    for (let y = 0; y < LAT; y++)
      for (let x = 0; x < LAT; x++) l[i++] = Math.floor(hash3(x, y, z, seed) * 255.999);
  latticeCache.set(seed, l);
  return l;
}

export function latticeNoise3(x: number, y: number, z: number, lattice: Uint8Array): number {
  const x0 = Math.floor(x),
    y0 = Math.floor(y),
    z0 = Math.floor(z);
  const fx = x - x0,
    fy = y - y0,
    fz = z - z0;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const uz = fz * fz * (3 - 2 * fz);
  const ix = x0 & LAT_MASK,
    iy = y0 & LAT_MASK,
    iz = z0 & LAT_MASK;
  const ix1 = (ix + 1) & LAT_MASK,
    iy1 = (iy + 1) & LAT_MASK,
    iz1 = (iz + 1) & LAT_MASK;
  const z0o = iz * LAT * LAT,
    z1o = iz1 * LAT * LAT;
  const y0o = iy * LAT,
    y1o = iy1 * LAT;
  const c000 = lattice[z0o + y0o + ix]!,
    c100 = lattice[z0o + y0o + ix1]!,
    c010 = lattice[z0o + y1o + ix]!,
    c110 = lattice[z0o + y1o + ix1]!,
    c001 = lattice[z1o + y0o + ix]!,
    c101 = lattice[z1o + y0o + ix1]!,
    c011 = lattice[z1o + y1o + ix]!,
    c111 = lattice[z1o + y1o + ix1]!;
  const x00 = c000 + (c100 - c000) * ux;
  const x10 = c010 + (c110 - c010) * ux;
  const x01 = c001 + (c101 - c001) * ux;
  const x11 = c011 + (c111 - c011) * ux;
  const y0v = x00 + (x10 - x00) * uy;
  const y1v = x01 + (x11 - x01) * uy;
  return (y0v + (y1v - y0v) * uz) / 255;
}

/** Fast atan2 approximation (max error ≈ 0.005 rad), for per-sample azimuths. */
export function fastAtan2(y: number, x: number): number {
  const ax = Math.abs(x),
    ay = Math.abs(y);
  const a = Math.min(ax, ay) / (Math.max(ax, ay) + 1e-12);
  const s = a * a;
  let r = ((-0.0464964749 * s + 0.15931422) * s - 0.327622764) * s * a + a;
  if (ay > ax) r = 1.57079637 - r;
  if (x < 0) r = 3.14159274 - r;
  if (y < 0) r = -r;
  return r;
}
