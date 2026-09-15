import type { AnatomyConfig } from '@/cases/schema';
import {
  allocLvProfileTable,
  axialWallFactor,
  buildLvProfile,
  lvShapeFor,
  lvShellVolume,
  type LvProfileTable,
  type LvShape,
} from './lvShape';

/** End-diastolic LV geometry derived from the case volume, length and sphericity. */
export interface LvGeometry {
  lengthCm: number; // annulus → endocardial apex at ED
  rMax: number; // maximal lateral cavity radius at ED
  shape: LvShape; // bullet profile (see lvShape.ts)
  wallVolumeMl: number; // myocardial shell volume at ED (conserved through the cycle)
  ivsd: number;
  lvpwd: number;
  apexT: number;
  /** ED profile table (annulus at z = 0), for tools that need the resting geometry. */
  edProfile: LvProfileTable;
}

export function lvGeometryFromVolume(edvMl: number, lengthCm: number, sphericity: number, anatomy: AnatomyConfig['lv']): LvGeometry {
  const shape = lvShapeFor(sphericity);
  // cavity volume between the annulus plane and the apex: π·ratio·R²·L·∫g²
  const rMax = Math.sqrt(edvMl / (Math.PI * shape.ratio * lengthCm * shape.I));
  const edProfile = buildLvProfile(shape, rMax, lengthCm, 0, allocLvProfileTable());
  const tBase = (anatomy.ivsdCm + anatomy.lvpwdCm) / 2;
  const tMean = (zeta: number): number => tBase * axialWallFactor(zeta, anatomy.apexWallThicknessCm / tBase);
  const wallVolumeMl = Math.max(20, lvShellVolume(edProfile, shape.ratio, tMean, 1));
  return { lengthCm, rMax, shape, wallVolumeMl, ivsd: anatomy.ivsdCm, lvpwd: anatomy.lvpwdCm, apexT: anatomy.apexWallThicknessCm, edProfile };
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
  // model azimuth 0 = A4C lateral wall (anterolateral segment, centred at 30° in the AHA convention)
  const deg = (((azimuthRad * 180) / Math.PI + 28) % 360 + 360) % 360;
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

/** Surface fractions of the AHA segments (basal/mid 1/18 each, apical 1/16 each, apex 1/12), weighted by hypokinesia. */
export function regionalMeanFraction(amp: SegmentAmplitudes): number {
  let sum = 0;
  for (let seg = 1; seg <= 17; seg++) {
    const frac = seg <= 12 ? 1 / 18 : seg <= 16 ? 1 / 16 : 1 / 12;
    sum += (1 - Math.min(1, amp[seg] ?? 1)) * frac;
  }
  return sum;
}
