// @tier slow
import { describe, expect, it } from 'vitest';
import { CASE_INPUTS, loadCaseById } from '@/cases';
import { SimulatorCore } from '@/simulator/core/simulatorCore';
import { baseInput } from '@/simulator/core/baseInput';
import { classifyHeart, computeHeartPose } from '@/simulator/anatomy/heartModel';
import { makeSample, Structure, Tissue } from '@/simulator/anatomy/tissue';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import { ProceduralSliceRenderer } from '@/simulator/renderer/procedural/sliceRenderer';
import { scenePhysicsFor } from '@/simulator/renderer/scenePhysics';
import {
  allocPolarFrame,
  CALIBRATED_TIER,
  DEFAULT_ACQUISITION,
  polarSpecFor,
} from '@/simulator/renderer/types';
import { LAA_WALL_CM, PERICARDIUM_CM } from '@/simulator/anatomy/classify/pericardium';
import { AORTIC_EXTENSION_WALL_CM } from '@/simulator/anatomy/aorticExtension';

/**
 * The right atrial appendage holds its published volume, lies against the ascending aorta, and the five-chamber view
 * shows the right atrium beside the aorta (decisions 388 and 389).
 *
 * - On CT the appendage holds 13.3 ± 3.5 mL in men and 10.7 ± 2.8 mL in women at its largest, at 45 % of the cycle, and
 *   6.06 ± 2.03 and 5.18 ± 1.57 mL at its least, at 5 %, after the atrial contraction (BMC Cardiovasc Disord 2025, 60
 *   patients in sinus rhythm). At end-systole every case's appendage is within one SD of its sex's largest volume; at
 *   end-diastole every case in sinus rhythm is within one SD of its least. The finger of decision 323 held 7.1-8.8 mL at
 *   its largest; the pouch of decision 388, which emptied with its atrium, still 7.3-8.3 mL at end-diastole.
 * - At end-diastole and at end-systole its blood comes within the two walls of the ascending aorta's or the root's
 *   blood (MAX_AORTA_GAP_CM), and only their walls lie between: on CT and in the Rodero heart (3.0-3.6 mm) the walls touch.
 *   The appendage of decision 388 stood 4-10 mm off, with up to 4.6 mm of mediastinal fat and 1.0-1.4 mm of pericardium.
 * - In the canonical five-chamber view at end-diastole the right atrium's blood comes within MAX_A5C_RIGHT_GAP_CM of the
 *   aorta, its own wall and the pericardium it meets the plane in, and takes at least MIN_A5C_RIGHT of the sector. The
 *   finger was cut as a small circle far from the root, 0.30-0.47 % of the sector, and Daniel saw no right atrium there.
 */
const PUBLISHED_MAX_ML = {
  male: { mean: 13.3, sd: 3.5 },
  female: { mean: 10.7, sd: 2.8 },
} as const;
const PUBLISHED_MIN_ML = {
  male: { mean: 6.06, sd: 2.03 },
  female: { mean: 5.18, sd: 1.57 },
} as const;
/** The two walls lumen to lumen, and the 1 mm grid's rounding. */
const MAX_AORTA_GAP_CM = LAA_WALL_CM + AORTIC_EXTENSION_WALL_CM + 0.07;
/**
 * In the plane, from the right atrium's blood to the aorta's wall: the atrium's wall, the sac's layer where the plane runs
 * beside the contact, and one line of the sector at 15 cm (1.3 mm).
 */
const MAX_A5C_RIGHT_GAP_CM = LAA_WALL_CM + PERICARDIUM_CM + 0.15;
const MIN_A5C_RIGHT = 0.005;
/**
 * Declared (decision 389), the share of the sector: with its published volume at end-diastole the appendage, and in
 * four cases the only right atrium the plane cuts then, is smaller than the one of decision 388 (0.53-0.77 %), which held
 * 1.5-2 mL more than the published at end-diastole. It lies against the ascending aorta.
 */
const KNOWN_A5C_RIGHT_ED: Record<string, string> = {
  'normal-excellent-window': '0.46 %, the appendage alone',
  'hfref-severe-mr': '0.46 %, the appendage alone',
  'inferior-rwma': '0.49 %',
  'aortic-stenosis-severe': '0.41 %, the appendage alone',
  'hocm-sam': '0.48 %, the appendage alone',
  'pericardial-effusion-tamponade': '0.49 %',
};

/** What a miss of the heart's classifier stands for: the mediastinum or the lung. */
const OUTSIDE = -1;

const models = (id: string) => new SimulatorCore(loadCaseById(id), baseInput()).models;

/** The appendage's blood (mL) at `phase`, counted on a 1.5 mm grid over a box around it. */
function appendageMl(id: string, phase: number): number {
  const { heart, tables } = models(id);
  const hp = computeHeartPose(heart, cycleStateAt(tables, phase));
  const s = makeSample();
  const g = 0.15;
  let n = 0;
  for (let x = -7.5; x <= -1.5; x += g)
    for (let y = -1.5; y <= 6.5; y += g)
      for (let z = -5; z <= 1; z += g)
        if (
          classifyHeart(heart, hp, x + hp.swingX, y, z, s) &&
          s.structure === Structure.RaAppendage
        )
          n++;
  return n * g ** 3;
}

/**
 * The shortest way (cm) from the appendage's blood to the aortic blood (ascending aorta or root) at `phase` on a 1 mm
 * grid, and what lies on it other than the two lumens.
 */
function appendageToAorta(id: string, phase: number): { gap: number; between: Set<number> } {
  const { heart, tables } = models(id);
  const hp = computeHeartPose(heart, cycleStateAt(tables, phase));
  const s = makeSample();
  const g = 0.1,
    x0 = -6,
    y0 = 0.5,
    z0 = -5.5,
    nx = 56,
    ny = 61,
    nz = 61;
  const kind = new Uint8Array(nx * ny * nz); // 1 aortic blood, 2 appendage blood
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++)
      for (let k = 0; k < nz; k++) {
        if (!classifyHeart(heart, hp, x0 + i * g + hp.swingX, y0 + j * g, z0 + k * g, s)) continue;
        if (s.tissue !== Tissue.Blood) continue;
        const q = (i * ny + j) * nz + k;
        if (s.structure === Structure.AscendingAorta || s.structure === Structure.AorticRoot)
          kind[q] = 1;
        else if (s.structure === Structure.RaAppendage) kind[q] = 2;
      }
  const r = 8;
  let best = Infinity,
    a = [0, 0, 0],
    b = [0, 0, 0];
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++)
      for (let k = 0; k < nz; k++) {
        if (kind[(i * ny + j) * nz + k] !== 2) continue;
        for (let di = -r; di <= r; di++)
          for (let dj = -r; dj <= r; dj++)
            for (let dk = -r; dk <= r; dk++) {
              const d2 = di * di + dj * dj + dk * dk;
              if (d2 >= best) continue;
              const I = i + di,
                J = j + dj,
                K = k + dk;
              if (I < 0 || J < 0 || K < 0 || I >= nx || J >= ny || K >= nz) continue;
              if (kind[(I * ny + J) * nz + K] !== 1) continue;
              best = d2;
              a = [I, J, K];
              b = [i, j, k];
            }
      }
  const between = new Set<number>(); // structures, OUTSIDE when the heart's classifier misses
  if (best === Infinity) return { gap: Infinity, between };
  for (let t = 0; t <= 1; t += 0.02) {
    const p = [0, 1, 2].map((c) => [x0, y0, z0][c]! + g * (a[c]! + t * (b[c]! - a[c]!)));
    const hit = classifyHeart(heart, hp, p[0]! + hp.swingX, p[1]!, p[2]!, s);
    if (hit && s.tissue === Tissue.Blood) continue;
    between.add(hit ? s.structure : OUTSIDE);
  }
  return { gap: g * Math.sqrt(best), between };
}

describe('the right atrial appendage holds its published volume (decisions 388 and 389)', () => {
  for (const { id } of CASE_INPUTS)
    it(id, () => {
      const c = loadCaseById(id);
      const { tables } = models(id);
      const sex = c.demographics.sexForReference;
      const most = appendageMl(id, tables.endSystoleS / tables.rrS);
      expect(most).toBeGreaterThanOrEqual(PUBLISHED_MAX_ML[sex].mean - PUBLISHED_MAX_ML[sex].sd);
      expect(most).toBeLessThanOrEqual(PUBLISHED_MAX_ML[sex].mean + PUBLISHED_MAX_ML[sex].sd);
      // without an atrial contraction the appendage does not empty to its least
      if (c.rhythm.type !== 'sinus') return;
      const least = appendageMl(id, 0);
      expect(least).toBeGreaterThanOrEqual(PUBLISHED_MIN_ML[sex].mean - PUBLISHED_MIN_ML[sex].sd);
      expect(least).toBeLessThanOrEqual(PUBLISHED_MIN_ML[sex].mean + PUBLISHED_MIN_ML[sex].sd);
    });
});

describe('the right atrial appendage lies against the ascending aorta (decision 389)', () => {
  const walls = new Set<number>([Structure.RaWall, Structure.AscendingAorta, Structure.AorticRoot]);
  for (const { id } of CASE_INPUTS)
    it(id, () => {
      const { tables } = models(id);
      for (const phase of [0, tables.endSystoleS / tables.rrS]) {
        const { gap, between } = appendageToAorta(id, phase);
        expect(gap, `${id} at ${phase.toFixed(2)}`).toBeLessThanOrEqual(MAX_AORTA_GAP_CM);
        expect(
          [...between].filter((n) => !walls.has(n)),
          `${id} at ${phase.toFixed(2)}`,
        ).toEqual([]);
      }
    });
});

describe('the five-chamber view shows the right atrium beside the aorta (decisions 388 and 389)', () => {
  for (const { id } of CASE_INPUTS)
    it(id, () => {
      const c = loadCaseById(id);
      const { heart, thorax, tables } = models(id);
      const spec = polarSpecFor(DEFAULT_ACQUISITION, CALIBRATED_TIER);
      const beam = beamFrameFromPose(
        poseFromControl(thorax, canonicalControl(getViewTarget('a5c'), heart, thorax)),
        1,
      );
      const f = allocPolarFrame(spec);
      new ProceduralSliceRenderer().render(
        {
          heart,
          heartPose: computeHeartPose(heart, cycleStateAt(tables, 0)),
          thorax,
          physics: scenePhysicsFor(c, DEFAULT_ACQUISITION),
        },
        beam,
        spec,
        0,
        f,
      );
      const { lines, samples, sectorRad, depthCm } = f.spec;
      const at = (q: number): [number, number] => {
        const th = (Math.floor(q / samples) / (lines - 1) - 0.5) * sectorRad;
        const d = (((q % samples) + 0.5) / samples) * depthCm;
        return [d * Math.sin(th), d * Math.cos(th)];
      };
      const right: [number, number][] = [],
        aorta: [number, number][] = [];
      f.structure.forEach((st, q) => {
        if (st === Structure.RaCavity || st === Structure.RaAppendage) right.push(at(q));
        else if (st === Structure.AscendingAorta || st === Structure.AorticRoot) aorta.push(at(q));
      });
      let gap = Infinity;
      for (const [u, v] of right)
        for (const [p, q] of aorta) gap = Math.min(gap, Math.hypot(u - p, v - q));
      expect(gap).toBeLessThanOrEqual(MAX_A5C_RIGHT_GAP_CM);
      const share = right.length / f.structure.length;
      const declared = KNOWN_A5C_RIGHT_ED[id];
      expect(share < MIN_A5C_RIGHT, `${(100 * share).toFixed(2)} %`).toBe(!!declared);
    });
});
