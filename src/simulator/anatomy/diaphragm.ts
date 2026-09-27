import type { CycleState } from '@/simulator/cardiac-cycle/cycleModel';
import { classifyHeart } from './classify';
import { computeHeartPose } from './heartPose';
import { torsoToHeart } from './heartFrame';
import type { HeartModel } from './heartModel';
import { makeSample, Structure } from './tissue';
import {
  DIAPHRAGM_MAP_N,
  DIAPHRAGM_MAP_NONE_CM,
  NO_DIAPHRAGM_MAP,
  type DiaphragmMap,
} from './thoraxModel';

/**
 * The right heart rests on the diaphragm (decision 229). The floor of the right atrium, where the inferior vena cava
 * enters it, and the inferior wall of the right ventricle lie on the diaphragm over the liver: that is the subcostal
 * window. The thorax's liver dome is a paraboloid under the right heart, and until decision 229 the heart floated above it
 * (0.5–1.3 cm under the right ventricle and atrium, more to the left), with lung in the gap wherever it lay outside the
 * mediastinum: the subcostal beams crossed a pleura before the heart in 14–16 % of their lines, and the junction of the
 * cava with the atrium was drawn as lung reverberation.
 *
 * The fit samples the heart once, in end-diastole, on a grid of torso columns (x–z, 1 cm): where the chamber just inside
 * the pericardial sac at the lowest point of a column is the right ventricle or the right atrium, the diaphragm rises to
 * that point; around those columns it falls away by `DIAPHRAGM_FALL` per cm, and the liver dome rules beyond. The grid is
 * sampled bilinearly (`diaphragmMapY`), on the CPU and on the GPU alike.
 */
const RESTING: ReadonlySet<number> = new Set([
  Structure.RvWall,
  Structure.RvCavity,
  Structure.RaWall,
  Structure.RaCavity,
]);
/** Veins that leave the heart downward: their tubes are not the heart's underside. */
const DESCENDING: ReadonlySet<number> = new Set([
  Structure.Ivc,
  Structure.HepaticVein,
  Structure.Lung,
]);
/** What lines the sac inside: the chamber above it tells what rests on the diaphragm there. */
const LINING: ReadonlySet<number> = new Set([
  Structure.Pericardium,
  Structure.EpicardialFat,
  Structure.PericardialEffusion,
]);
/**
 * How steeply the diaphragm falls away beside the heart (cm per cm, about 56°): a shape assumption, not a published
 * value. It only has to leave the heart's edge so that the lung keeps the recesses beside it.
 */
export const DIAPHRAGM_FALL = 1.5;
/**
 * Steps of the search for the lowest point of a column (cm): coarse ones up from below — finer than a chamber is tall, so
 * only a sliver of wall at the heart's margin can be stepped over — and fine ones back down.
 */
const COARSE_CM = 1;
const STEP_CM = 0.1;
/** How far from the bounding sphere's centre the fit looks for the right heart's underside (cm). */
const REACH_CM = 10;
const BELOW_CM = 8;
const ABOVE_CM = 2;

export function fitDiaphragmMap(heart: HeartModel, state: CycleState): DiaphragmMap {
  const pose = computeHeartPose(heart, state);
  const s = makeSample();
  const heartAt = (x: number, y: number, z: number): number => {
    const h = torsoToHeart(heart.frame, { x, y, z });
    return classifyHeart(heart, pose, h.x + pose.swingX, h.y, h.z, s) &&
      !DESCENDING.has(s.structure)
      ? s.structure
      : -1;
  };
  // columns near the centre of the heart's bounding sphere (torso frame), searched from below it to a little above it:
  // in the twelve cases, the three positions and both respiratory phases the right heart's underside lies within 7.8 cm
  // of the centre horizontally, from 6.2 cm below it to 0.44 cm above
  const f = heart.frame,
    b = heart.boundCenter,
    R = heart.boundRadius;
  const cx = f.origin.x + f.ex.x * b.x + f.ey.x * b.y + f.ez.x * b.z;
  const cy = f.origin.y + f.ex.y * b.x + f.ey.y * b.y + f.ez.y * b.z;
  const cz = f.origin.z + f.ex.z * b.x + f.ey.z * b.y + f.ez.z * b.z;
  const rest: { x: number; z: number; y: number }[] = [];
  for (let x = Math.round(cx - REACH_CM); x <= cx + REACH_CM; x++)
    for (let z = Math.round(cz - REACH_CM); z <= cz + REACH_CM; z++) {
      const h2 = R * R - (x - cx) ** 2 - (z - cz) ** 2;
      if (h2 <= 0 || Math.hypot(x - cx, z - cz) > REACH_CM) continue;
      let yb = NaN;
      for (let y = cy - Math.min(BELOW_CM, Math.sqrt(h2)); y < cy + ABOVE_CM; y += COARSE_CM)
        if (heartAt(x, y, z) >= 0) {
          yb = y;
          while (heartAt(x, yb - STEP_CM, z) >= 0) yb -= STEP_CM;
          break;
        }
      if (!Number.isFinite(yb)) continue;
      // the chambers just inside the sac: the right heart rests here if it is among those within half a centimetre of
      // the first (at the junction of the septum with the right ventricle either may come first by a millimetre)
      let first = NaN,
        resting = false;
      for (let d = 0; d < 4.5 && !resting; d += STEP_CM) {
        const st = heartAt(x, yb + d, z);
        if (st < 0 || LINING.has(st)) continue;
        if (Number.isNaN(first)) first = d;
        if (d > first + 0.5) break;
        resting = RESTING.has(st);
      }
      if (resting) rest.push({ x, z, y: yb });
    }
  if (!rest.length) return NO_DIAPHRAGM_MAP;
  // the grid, centred on the resting columns, with their heights and the fall around them
  const N = DIAPHRAGM_MAP_N;
  const x0 = Math.round(rest.reduce((a, c) => a + c.x, 0) / rest.length) - N / 2;
  const z0 = Math.round(rest.reduce((a, c) => a + c.z, 0) / rest.length) - N / 2;
  const h = new Float32Array(N * N).fill(DIAPHRAGM_MAP_NONE_CM);
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) {
      let best = DIAPHRAGM_MAP_NONE_CM;
      for (const c of rest)
        best = Math.max(best, c.y - DIAPHRAGM_FALL * Math.hypot(x0 + i - c.x, z0 + j - c.z));
      h[j * N + i] = best;
    }
  return { x0, z0, h };
}
