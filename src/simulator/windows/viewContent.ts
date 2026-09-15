import {
  classifyHeart,
  torsoToHeart,
  type HeartModel,
  type HeartPose,
} from '@/simulator/anatomy/heartModel';
import { isAnteriorLung, type ThoraxModel } from '@/simulator/anatomy/thoraxModel';
import { makeSample, Structure } from '@/simulator/anatomy/tissue';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import { add, scale } from '@/core/vec3';
import { canonicalControl, type ViewTarget } from './viewTargets';

/**
 * What each view actually contains, structure by structure, over the plane that is really drawn — the one
 * reachable from the intercostal window, not the canonical one the view asks for.
 *
 * This exists because a whole class of defect was invisible to the rest of the test suite. The goldens
 * compare pixels of a few views, and the model measurer checks sizes; neither notices that a structure is
 * missing from the image. The parasternal short axis of the great vessels held zero pixels of pulmonary
 * artery, pulmonary valve and right outflow tract for twenty iterations, and it took a cardiologist looking
 * at screenshots to find it (decisions 59 and 62).
 */
export interface ViewContentOptions {
  /** Sector depth in cm (the rectangle sampled is 2·halfWidth × depth, as in tools/offline/render/slice-map). */
  depthCm?: number;
  halfWidthCm?: number;
  /** Grid step in cm. 0.1 keeps a whole twelve-view sweep well under a second per phase. */
  stepCm?: number;
  /** Sector opening (degrees) inside which lung hides what lies behind it; the default acquisition's. */
  sectorDeg?: number;
}

/** Fraction of the sampled rectangle occupied by each structure (0–1). Absent structures are simply missing. */
export function viewStructureFractions(
  view: ViewTarget,
  heart: HeartModel,
  thorax: ThoraxModel,
  pose: HeartPose,
  opts: ViewContentOptions = {},
): Map<Structure, number> {
  const depth = opts.depthCm ?? 16;
  const half = opts.halfWidthCm ?? 8;
  const step = opts.stepCm ?? 0.1;
  const beam = beamFrameFromPose(poseFromControl(thorax, canonicalControl(view, heart, thorax)), 1);
  // The image stops where a beam meets lung: the renderer turns everything behind the pleura into reverberation.
  // Counting the heart behind it anyway let the A3C preset pass with 12.9% of LV cavity while its image was 81% lung
  // and 0% LV (decision 72). Lung entry is found once per ray direction, as the renderer marches its lines.
  const halfSector = ((opts.sectorDeg ?? 80) * Math.PI) / 360;
  const RAY_STEP_RAD = Math.PI / 720;
  const lungEntry = new Map<number, number>();
  const lungEntryAt = (angle: number): number => {
    const key = Math.round(angle / RAY_STEP_RAD);
    let r = lungEntry.get(key);
    if (r === undefined) {
      r = Infinity;
      const a = key * RAY_STEP_RAD;
      const dir = add(scale(beam.forward, Math.cos(a)), scale(beam.lateral, Math.sin(a)));
      for (let rr = step / 2; rr < Math.hypot(depth, half); rr += step / 2) {
        const p = add(beam.origin, scale(dir, rr));
        if (isAnteriorLung(thorax, p.x, p.y, p.z)) {
          r = rr;
          break;
        }
      }
      lungEntry.set(key, r);
    }
    return r;
  };
  const s = makeSample();
  const counts = new Map<Structure, number>();
  let total = 0;
  for (let dep = step / 2; dep < depth; dep += step)
    for (let lat = -half + step / 2; lat < half; lat += step) {
      total++;
      const angle = Math.atan2(lat, dep);
      if (Math.abs(angle) <= halfSector && Math.hypot(dep, lat) >= lungEntryAt(angle)) {
        counts.set(Structure.Lung, (counts.get(Structure.Lung) ?? 0) + 1);
        continue;
      }
      const pT = add(beam.origin, add(scale(beam.forward, dep), scale(beam.lateral, lat)));
      const pH = torsoToHeart(heart.frame, pT);
      if (!classifyHeart(heart, pose, pH.x, pH.y, pH.z, s)) continue;
      counts.set(s.structure, (counts.get(s.structure) ?? 0) + 1);
    }
  const out = new Map<Structure, number>();
  for (const [k, v] of counts) out.set(k, v / total);
  return out;
}

/** Combined fraction of a group of structures, so a test can ask for "LV myocardium" without naming walls. */
export function fractionOfAny(
  fractions: Map<Structure, number>,
  group: readonly Structure[],
): number {
  let sum = 0;
  for (const st of group) sum += fractions.get(st) ?? 0;
  return sum;
}

export const LV_MYOCARDIUM = [
  Structure.LvWallSeptal,
  Structure.LvWallLateral,
  Structure.LvWallAnterior,
  Structure.LvWallInferior,
  Structure.LvApex,
] as const;
export const MITRAL_LEAFLETS = [Structure.MitralAnterior, Structure.MitralPosterior] as const;
export const RIGHT_OUTFLOW = [
  Structure.Rvot,
  Structure.PulmonaryValve,
  Structure.PulmonaryArtery,
] as const;
