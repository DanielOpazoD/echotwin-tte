import { axialWallFactor } from './lvShape';
import { latticeNoise3 } from '@/core/noise';
import type { HeartModel } from './heartModel';

/**
 * Local LV wall thickness (cm) at azimuth/level: end-diastolic thickness interpolated between the
 * septal and free-wall values, systolic thickening from wall incompressibility scaled by the segment's
 * motion (akinetic segments barely thicken), and a low-frequency modulation around the wall.
 */
export function wallThicknessAt(
  m: HeartModel,
  thickK: number,
  az: number,
  levelFrac: number,
  amp: number,
): number {
  const lv = m.lv;
  const septalness = 0.5 - 0.5 * Math.cos(az);
  const tBase = lv.lvpwd + (lv.ivsd - lv.lvpwd) * septalness;
  // end-diastolic thickness: septal / free-wall value over the basal half, tapering to the apical thickness
  const tED = tBase * axialWallFactor(levelFrac, lv.apexT / tBase);
  // low-frequency thickness modulation (±14 % at the base, fading to none at the apical cap)
  const wallMod =
    1 +
    0.28 *
      (latticeNoise3(
        Math.cos(az) * 1.6 + 7.3,
        Math.sin(az) * 1.6 + 2.1,
        levelFrac * 2.4,
        m.wallNoise,
      ) -
        0.5) *
      (1 - levelFrac * levelFrac);
  return tED * Math.max(0.6, 1 + (thickK - 1) * (0.35 + 0.65 * amp)) * wallMod;
}

/** Septal shift toward the LV (cm) at azimuth/level: maximal at the mid septum, zero at the free wall, base and apex. */
export function septalShiftAt(shiftCm: number, az: number, levelFrac: number): number {
  if (shiftCm <= 0) return 0;
  const c = -Math.cos(az); // 1 at the septum (az = π)
  if (c <= 0) return 0;
  const zw = 1 - Math.pow((levelFrac - 0.45) / 0.45, 2);
  if (zw <= 0) return 0;
  return shiftCm * c * c * zw;
}

/**
 * The septal crest under the membranous septum (decision 223). Beneath the commissure of the non-coronary and right
 * coronary sinuses the muscular septum narrows to the thin membranous septum: by CT 3.0-3.4 mm at 1 mm below it, 4.1-4.7
 * at 2 mm, 6.1-6.9 at 5 mm and 9.7-10.7 at 10 mm (Schamroth Pravda et al., Europace 2024;26:euae109). The model's septum
 * kept its full thickness up to its basal edge, 1.0-1.1 cm right under the aortic annulus. `septalCrestFactor` is the
 * share of the wall thickness kept at azimuth `az` (around the LV axis) and height `zRel` below the mitral annulus: the
 * membranous part (0.2) above SEPTAL_CREST_Z_CM, the CT profile below it (as shares of the thickness 1 cm down), over
 * ±SEPTAL_CREST_HALF_WIDTH around the commissure's azimuth.
 */
export const SEPTAL_CREST_AZ = 2.85;
export const SEPTAL_CREST_HALF_WIDTH = 0.7;
export const SEPTAL_CREST_Z_CM = 0.05;
export function septalCrestFactor(az: number, zRel: number): number {
  let da = Math.abs(az - SEPTAL_CREST_AZ);
  if (da > Math.PI) da = 2 * Math.PI - da;
  if (da >= SEPTAL_CREST_HALF_WIDTH) return 1;
  const cw = Math.cos((da / SEPTAL_CREST_HALF_WIDTH) * (Math.PI / 2));
  const d = zRel - SEPTAL_CREST_Z_CM;
  let f = 1;
  if (d <= 0) f = 0.2;
  else if (d < 0.1) f = 0.2 + 1.1 * d;
  else if (d < 0.2) f = 0.31 + 1.2 * (d - 0.1);
  else if (d < 0.5) f = 0.43 + 0.7 * (d - 0.2);
  else if (d < 1) f = 0.64 + 0.72 * (d - 0.5);
  return 1 - cw * cw * (1 - f);
}
