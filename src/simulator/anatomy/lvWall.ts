import { axialWallFactor } from './lvShape';
import { latticeNoise3 } from '@/core/noise';
import type { HeartModel } from './heartModel';

/**
 * Local LV wall thickness (cm) at azimuth/level: end-diastolic thickness interpolated between the
 * septal and free-wall values, systolic thickening from wall incompressibility scaled by the segment's
 * motion (akinetic segments barely thicken), and a low-frequency modulation around the wall.
 */
export function wallThicknessAt(m: HeartModel, thickK: number, az: number, levelFrac: number, amp: number): number {
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
export function septalShiftAt(shiftCm: number, az: number, levelFrac: number): number {
  if (shiftCm <= 0) return 0;
  const c = -Math.cos(az); // 1 at the septum (az = π)
  if (c <= 0) return 0;
  const zw = 1 - Math.pow((levelFrac - 0.45) / 0.45, 2);
  if (zw <= 0) return 0;
  return shiftCm * c * c * zw;
}
