import type { Vec3 } from '@/core/vec3';
/** Submicron overlap of floating-point representations of the same junction plane. */
export const VASCULAR_JOIN_EPS_CM = 1e-5;
export interface VascularPathPoint {
  p: Vec3;
  radiusCm: number;
}

/** Piecewise swept circular lumen. End caps are spherical; internal joins use the union of lumina.
 * A tapered segment uses its orthogonal centreline projection (not an exact cone distance).
 * Keep the packed coordinates/radii shared with the GPU and mesh classifier.
 */
export interface VascularTube {
  /** Per segment: ax, ay, az, radiusA, bx, by, bz, radiusB. */
  segments: Float32Array;
  min: Vec3;
  max: Vec3;
}
export interface TubeDistance {
  segment: number;
  distance: number;
  nx: number;
  ny: number;
  nz: number;
}

export function compileVascularTube(
  paths: readonly (readonly VascularPathPoint[])[],
  wallCm: number,
): VascularTube {
  if (!Number.isFinite(wallCm) || wallCm < 0) throw new Error('Invalid vascular envelope');
  const data: number[] = [];
  const min = { x: Infinity, y: Infinity, z: Infinity },
    max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const path of paths) {
    if (path.length < 2) throw new Error('Vascular path needs at least two points');
    for (const { p, radiusCm } of path) {
      if (!(radiusCm > 0) || !Number.isFinite(radiusCm) || !Number.isFinite(p.x + p.y + p.z))
        throw new Error('Invalid vascular path');
      const r = radiusCm + wallCm;
      min.x = Math.min(min.x, p.x - r);
      min.y = Math.min(min.y, p.y - r);
      min.z = Math.min(min.z, p.z - r);
      max.x = Math.max(max.x, p.x + r);
      max.y = Math.max(max.y, p.y + r);
      max.z = Math.max(max.z, p.z + r);
    }
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]!,
        b = path[i]!;
      data.push(a.p.x, a.p.y, a.p.z, a.radiusCm, b.p.x, b.p.y, b.p.z, b.radiusCm);
    }
  }
  return { segments: new Float32Array(data), min, max };
}

export function vascularTubeDistance(
  tube: VascularTube,
  x: number,
  y: number,
  z: number,
  out: TubeDistance,
): boolean {
  const { min, max, segments: d } = tube;
  if (x < min.x || x > max.x || y < min.y || y > max.y || z < min.z || z > max.z) return false;
  let segment = -1;
  let best = Infinity,
    nx = 0,
    ny = 0,
    nz = 1;
  for (let i = 0; i < d.length; i += 8) {
    const ax = d[i]!,
      ay = d[i + 1]!,
      az = d[i + 2]!,
      ar = d[i + 3]!;
    const dx = d[i + 4]! - ax,
      dy = d[i + 5]! - ay,
      dz = d[i + 6]! - az,
      dr = d[i + 7]! - ar;
    const reach = best + Math.max(ar, d[i + 7]!);
    if (reach < 0) continue;
    const gx = Math.max(Math.min(ax, ax + dx) - x, x - Math.max(ax, ax + dx), 0);
    const gy = Math.max(Math.min(ay, ay + dy) - y, y - Math.max(ay, ay + dy), 0);
    const gz = Math.max(Math.min(az, az + dz) - z, z - Math.max(az, az + dz), 0);
    if (gx * gx + gy * gy + gz * gz >= reach * reach) continue;
    const len2 = dx * dx + dy * dy + dz * dz;
    const raw = len2 > 1e-12 ? ((x - ax) * dx + (y - ay) * dy + (z - az) * dz) / len2 : 0;
    const u = Math.max(0, Math.min(1, raw));
    const rx = x - ax - u * dx,
      ry = y - ay - u * dy,
      rz = z - az - u * dz;
    const radial = Math.sqrt(rx * rx + ry * ry + rz * rz),
      distance = radial - ar - u * dr;
    if (distance >= best) continue;
    best = distance;
    segment = i / 8;
    const inv = radial > 1e-8 ? 1 / radial : 0;
    const taper = raw > 0 && raw < 1 ? dr / len2 : 0;
    nx = rx * inv - taper * dx;
    ny = ry * inv - taper * dy;
    nz = rz * inv - taper * dz;
  }
  const norm = Math.hypot(nx, ny, nz) || 1;
  out.segment = segment;
  out.distance = best;
  out.nx = nx / norm;
  out.ny = ny / norm;
  out.nz = nz / norm;
  return true;
}
