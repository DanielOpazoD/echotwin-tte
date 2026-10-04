import { sdEllipsoid, smax } from './sdf';

export const LA_POSTERIOR_RATIO = 0.72;

/** Interatrial septum: unchanged fossa/limbus/muscle model, shared with GLSL. */
export function iasThickness(fo: number): number {
  return fo < 1 ? 0.12 : fo < 1.3 ? 0.7 : 0.55;
}

/** The actual atrial body, including its posterior and roof flattening. */
export function leftAtrialFreeSdf(
  x: number,
  y: number,
  z: number,
  cx: number,
  cy: number,
  cz: number,
  rx: number,
  ry: number,
  rz: number,
  zTop: number,
): number {
  const d = sdEllipsoid(x, y, z, cx, cy, cz, rx, ry, rz);
  return smax(smax(d, cy - LA_POSTERIOR_RATIO * ry - y, 0.6), zTop + 0.15 * rz - z, 0.5);
}

export const IAS_X = -2.35;
export const FOSSA_Y = -1.6;
export const FOSSA_Z = -2.3;

/** Idealized atrial shape: declared AP span plus a volume-constrained transverse/longitudinal scale. */
export function sizedLeftAtrium(k: number, apDiameterCm: number) {
  const rx = 2.5 * k,
    // The posterior cut retains 0.72 ry and the anterior side ry.
    // Set their total span from the declared AP dimension; volume sets the other axes.
    ry = apDiameterCm / (1 + LA_POSTERIOR_RATIO),
    rz = 2.65 * k;
  return {
    center: { x: IAS_X - 0.35 + rx, y: -1.3, z: -rz * 0.85 },
    radii: { x: rx, y: ry, z: rz * 0.88 },
  };
}

export const ATRIAL_QUADRATURE_POINTS = 8192;
const POINTS = ATRIAL_QUADRATURE_POINTS;
function radicalInverse(i: number, base: number): number {
  let f = 1,
    result = 0;
  while (i > 0) {
    f /= base;
    result += f * (i % base);
    i = Math.floor(i / base);
  }
  return result;
}
export const atrialQuadrature = Float64Array.from(
  { length: POINTS * 3 },
  (_, i) => 2 * radicalInverse(Math.floor(i / 3) + 1, [2, 3, 5][i % 3]!) - 1,
);

/** Numerical volume of the shared clipped atrial body at full nominal annular excursion.
 * Excludes appendage and pulmonary veins (ASE comprehensive TTE 2019, section 4.C.2).
 * This is geometry normalization, not patient calibration or a flow/pressure solver.
 */
export function maximalAtrialBodyVolume(
  k: number,
  excursionCm: number,
  apDiameterCm: number,
): number {
  const { center, radii } = sizedLeftAtrium(k, apDiameterCm);
  const rx = radii.x,
    ry = radii.y,
    cx = center.x,
    cy = center.y;
  const top = center.z - radii.z,
    bottom = excursionCm + 0.25;
  const cz = (top + bottom) / 2,
    rz = (bottom - top) / 2;
  let inside = 0;
  for (let i = 0; i < POINTS; i++) {
    const x = cx + rx * atrialQuadrature[3 * i]!,
      y = cy + ry * atrialQuadrature[3 * i + 1]!,
      z = cz + rz * atrialQuadrature[3 * i + 2]!;
    const free = leftAtrialFreeSdf(x, y, z, cx, cy, cz, rx, ry, rz, top);
    const septum =
      IAS_X + iasThickness(Math.hypot((y - FOSSA_Y) / 0.6, (z - FOSSA_Z) / 0.7)) / 2 - x;
    if (smax(free, septum, 0.3) < 0) inside++;
  }
  return (8 * rx * ry * rz * inside) / POINTS;
}
const cache = new Map<string, number>();
/** Solve the same shape for the declared maximum volume, rather than assuming a universal MAPSE. */
export function atrialScaleForVolume(
  volumeMl: number,
  excursionCm: number,
  apDiameterCm: number,
): number {
  const key = `${volumeMl}|${excursionCm}|${apDiameterCm}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let lo = 0.2,
    hi = 3;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (maximalAtrialBodyVolume(mid, excursionCm, apDiameterCm) < volumeMl) lo = mid;
    else hi = mid;
  }
  const k = (lo + hi) / 2;
  if (cache.size >= 64) cache.delete(cache.keys().next().value!);
  cache.set(key, k);
  return k;
}
