// @tier slow
import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { SimulatorCore } from '@/simulator/core/simulatorCore';
import { baseInput } from '@/simulator/core/baseInput';
import { classifyHeart, computeHeartPose } from '@/simulator/anatomy/heartModel';
import { makeSample, Structure, Tissue } from '@/simulator/anatomy/tissue';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';

/**
 * The right atrium's blood is closed by its wall (decision 379): it may meet the ventricle's blood through the orifice,
 * the venae cavae, the coronary sinus, the leaflets and the septum, but not the fat, the pericardium or the outside of
 * the heart. Its vestibule opened only the 2.2 mm of the floor's wall over the ring, and where nothing filled the space
 * beneath, its blood met them over 9.5-22 cm² at end-diastole or mid-systole in three cases (1 mm grid).
 */
const H = 0.1;
// the right atrium in the heart frame: right of the septum (negative x), above and around the tricuspid ring
const X0 = -9,
  Y0 = -5,
  Z0 = -6,
  NX = 80,
  NY = 90,
  NZ = 80;
const OUTSIDE = -1;

/**
 * What is left (cm²), each a defect no decision has corrected yet: beside the mouths of the venae cavae and the coronary
 * sinus the wall is not drawn so that the veins open into the atrium, and where the vein's own lumen does not reach the
 * gap, the atrium's blood meets the groove fat or the pericardium; beside the root the anteromedial lobe does the same.
 * More than a quarter over its figure fails, and so does half a square centimetre under it, until the figure is lowered.
 */
const KNOWN_RA_BARE_BLOOD: Record<string, number> = {
  'normal-excellent-window @0': 2.49,
  'hfref-severe-mr @0.35': 1.38,
  'pulmonary-hypertension-rv @0': 2.51,
};

/** cm² of faces where the right atrium's blood meets fat, pericardium, effusion or the outside of the heart. */
function exposedRaBlood(id: string, phase: number): number {
  const { heart, tables } = new SimulatorCore(loadCaseById(id), baseInput()).models;
  const pose = computeHeartPose(heart, cycleStateAt(tables, phase));
  const s = makeSample();
  const n = NX * NY * NZ;
  const st = new Int16Array(n);
  for (let k = 0; k < NZ; k++)
    for (let j = 0; j < NY; j++)
      for (let i = 0; i < NX; i++) {
        const hit = classifyHeart(heart, pose, X0 + i * H + pose.swingX, Y0 + j * H, Z0 + k * H, s);
        st[i + NX * (j + NY * k)] = !hit || s.tissue === Tissue.Fluid ? OUTSIDE : s.structure;
      }
  const bare = new Set<number>([OUTSIDE, Structure.EpicardialFat, Structure.Pericardium]);
  let faces = 0;
  for (let k = 1; k < NZ - 1; k++)
    for (let j = 1; j < NY - 1; j++)
      for (let i = 1; i < NX - 1; i++) {
        const v = i + NX * (j + NY * k);
        if (st[v] !== Structure.RaCavity) continue;
        for (const o of [1, -1, NX, -NX, NX * NY, -NX * NY]) if (bare.has(st[v + o]!)) faces++;
      }
  return faces * H * H;
}

describe('the right atrium’s blood is closed by its wall (decision 379)', () => {
  for (const [key, known] of Object.entries(KNOWN_RA_BARE_BLOOD))
    it(key, () => {
      const [id, at] = key.split(' @') as [string, string];
      const v = exposedRaBlood(id, Number(at));
      expect(v).toBeLessThanOrEqual(known * 1.25 + 0.05);
      expect(v).toBeGreaterThan(known - 0.5);
    });
});
