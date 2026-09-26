import type { AnatomyConfig } from '@/cases/schema';
import { aha17FromCode, lvSegmentCode } from './lvSegments';
import { RV_GROOVE_ANTERIOR_RAD, RV_GROOVE_INFERIOR_RAD } from './anchors';
import { MITRAL_CENTRE_X } from './heartFrame';
import {
  allocLvProfileTable,
  axialWallFactor,
  buildLvProfile,
  lvNeckGain,
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

export function lvGeometryFromVolume(
  edvMl: number,
  lengthCm: number,
  sphericity: number,
  anatomy: AnatomyConfig['lv'],
  annulusR = Infinity,
): LvGeometry {
  const shape = lvShapeFor(sphericity);
  // cavity volume between the annulus plane and the apex: π·ratio·R²·L·∫g²
  const rMax = Math.sqrt(edvMl / (Math.PI * shape.ratio * lengthCm * shape.I));
  const edProfile = buildLvProfile(
    shape,
    rMax,
    lengthCm,
    0,
    allocLvProfileTable(),
    lvNeckGain(shape, rMax, annulusR),
    Number.isFinite(annulusR) ? MITRAL_CENTRE_X : 0,
  );
  const tBase = (anatomy.ivsdCm + anatomy.lvpwdCm) / 2;
  const tMean = (zeta: number): number =>
    tBase * axialWallFactor(zeta, anatomy.apexWallThicknessCm / tBase);
  const wallVolumeMl = Math.max(20, lvShellVolume(edProfile, shape.ratio, tMean, 1));
  return {
    lengthCm,
    rMax,
    shape,
    wallVolumeMl,
    ivsd: anatomy.ivsdCm,
    lvpwd: anatomy.lvpwdCm,
    apexT: anatomy.apexWallThicknessCm,
    edProfile,
  };
}

/** Wall-motion amplitude per AHA segment (1 normal). */
export type SegmentAmplitudes = Float32Array; // length 18 (index 1..17)

export function segmentAmplitudes(anatomy: AnatomyConfig): SegmentAmplitudes {
  const s = new Float32Array(18).fill(1);
  for (const wm of anatomy.wallMotion) s[wm.segment] = wm.amplitude;
  return s;
}

/**
 * AHA 17-segment id from heart-frame azimuth (rad, 0 = lateral, π/2 = anterior) and level fraction 0 (annulus) → 1 (end
 * of the cavity; the cap beyond it). The rules and the model choices are in `lvSegments.ts` (decision 152); until then
 * the cap began at 93 % of the cavity length and the azimuth was shifted by a fixed 28°.
 */
export function ahaSegment(azimuthRad: number, levelFrac: number): number {
  return aha17FromCode(
    lvSegmentCode(azimuthRad, levelFrac, RV_GROOVE_ANTERIOR_RAD, RV_GROOVE_INFERIOR_RAD),
  );
}

/**
 * Fraction of the cavity surface that a regional abnormality holds at its end-diastolic radius (basal and mid segments
 * 1/18 each, apical 1/12 each), weighted by hypokinesia. The apical cap (17) is tissue beyond the end of the cavity
 * (decision 152), so it holds no cavity surface: its amplitude only changes its own thickening, and its share of the
 * apex belongs to the apical segment of its quadrant, as in the 16-segment model. Until decision 152 the cap was the
 * last 7 % of the cavity and weighed 1/12, with the apical segments at 1/16.
 */
export function regionalMeanFraction(amp: SegmentAmplitudes): number {
  let sum = 0;
  for (let seg = 1; seg <= 16; seg++) {
    const frac = seg <= 12 ? 1 / 18 : 1 / 12;
    sum += (1 - Math.min(1, amp[seg] ?? 1)) * frac;
  }
  return sum;
}
