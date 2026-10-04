import { lvNeckGain, lvNeckWeight, lvProfileG, type LvShape } from './lvShape';
import { septalShiftAt } from './lvWall';

const LEVELS = 32,
  ANGLES = 48;
const cosine = Float64Array.from({ length: ANGLES }, (_, i) =>
  Math.cos((2 * Math.PI * (i + 0.5)) / ANGLES),
);
const sine = Float64Array.from({ length: ANGLES }, (_, i) =>
  Math.sin((2 * Math.PI * (i + 0.5)) / ANGLES),
);
const shifts = Float64Array.from({ length: LEVELS * ANGLES }, (_, i) =>
  septalShiftAt(
    1,
    (2 * Math.PI * ((i % ANGLES) + 0.5)) / ANGLES,
    (Math.floor(i / ANGLES) + 0.5) / LEVELS,
  ),
);

/** Polar area integration of the SAME angular x displacement used by the classifier.
 * Each ray intersects ((x - neckX - shift)*neckScale)^2 + (y/ratio)^2 = rho^2.
 * Numerical geometry, not a patient-specific compensation coefficient.
 */
export function shiftedProfileVolume(
  sh: LvShape,
  radius: number,
  length: number,
  annulusRadius: number,
  neckX: number,
  shiftCm: number,
): number {
  const neck = lvNeckGain(sh, radius, annulusRadius);
  let sum = 0;
  for (let z = 0; z < LEVELS; z++) {
    const fraction = (z + 0.5) / LEVELS,
      w = lvNeckWeight(fraction),
      scale = 1 + neck * w;
    const rho = radius * lvProfileG(sh, fraction),
      ox = neckX * w;
    if (shiftCm === 0) {
      sum += (Math.PI * sh.ratio * rho * rho) / scale;
      continue;
    }
    let area = 0;
    for (let a = 0; a < ANGLES; a++) {
      const cx = ox + shiftCm * shifts[z * ANGLES + a]!;
      const c = cosine[a]!,
        s = sine[a]! / sh.ratio;
      const qa = c * c * scale * scale + s * s,
        qb = c * cx * scale * scale;
      const rr = Math.max(
        0,
        (qb + Math.sqrt(Math.max(0, qb * qb - qa * (cx * cx * scale * scale - rho * rho)))) / qa,
      );
      area += rr * rr;
    }
    sum += (Math.PI * area) / ANGLES;
  }
  return (sum * length) / LEVELS;
}

/** Keep the unflattened profile volume while allowing the septum to change shape. */
export function radiusPreservingSeptalVolume(
  sh: LvShape,
  radius: number,
  length: number,
  annulusRadius: number,
  neckX: number,
  shiftCm: number,
): number {
  if (shiftCm <= 0) return radius;
  const target = shiftedProfileVolume(sh, radius, length, annulusRadius, neckX, 0);
  let lo = radius,
    hi = radius + shiftCm;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (shiftedProfileVolume(sh, mid, length, annulusRadius, neckX, shiftCm) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
