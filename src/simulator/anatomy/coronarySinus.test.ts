// @tier slow
import { describe, expect, it } from 'vitest';
import { CASE_INPUTS, loadCaseById } from '@/cases';
import { SimulatorCore } from '@/simulator/core/simulatorCore';
import { baseInput } from '@/simulator/core/baseInput';
import { classifyHeart, computeHeartPose } from '@/simulator/anatomy/heartModel';
import { makeSample, Structure, Tissue } from '@/simulator/anatomy/tissue';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';

/**
 * The coronary sinus runs in the posterior atrioventricular groove on the atrial side of the mitral annulus and opens into
 * the right atrium (decision 321). It ran on the ventricular side, the inferior wall took part of its lumen, and it ended
 * against the wall of the inferior vena cava, with no opening into the atrium. Over a 1 mm grid around the crux, at
 * end-diastole and end-systole: its blood touches no blood but the right atrium's, through an ostium of at least
 * 0.2 cm², and lies on average above the annulus.
 *
 * Declared: the tamponade, whose collapsing right atrium leaves the ostium against the vena cava.
 */
const KNOWN_CS_OSTIUM: Record<string, string> = {
  'pericardial-effusion-tamponade':
    'the collapsing right atrium leaves the ostium against the vena cava',
};
const H = 0.1;
const CS_BLOOD = Structure.CoronarySinus * 100 + Tissue.Blood;

function census(id: string, phase: number) {
  const { heart, tables } = new SimulatorCore(loadCaseById(id), baseInput()).models;
  const hp = computeHeartPose(heart, cycleStateAt(tables, phase));
  const s = makeSample();
  const lab = (x: number, y: number, z: number) =>
    classifyHeart(heart, hp, x + hp.swingX, y, z, s) ? s.structure * 100 + s.tissue : -1;
  let n = 0,
    zSum = 0,
    ostium = 0;
  const other = new Map<string, number>();
  for (let x = -5; x <= 4; x += H)
    for (let y = -5; y <= 0; y += H)
      for (let z = hp.zAnn - 2; z <= hp.zAnn + 1.5; z += H) {
        if (lab(x, y, z) !== CS_BLOOD) continue;
        n++;
        zSum += z;
        for (const [dx, dy, dz] of [
          [H, 0, 0],
          [-H, 0, 0],
          [0, H, 0],
          [0, -H, 0],
          [0, 0, H],
          [0, 0, -H],
        ] as const) {
          const b = lab(x + dx, y + dy, z + dz);
          if (b === CS_BLOOD) continue;
          if (b === Structure.RaCavity * 100 + Tissue.Blood) ostium += H * H;
          else if (b < 0 || b % 100 === Tissue.Blood) {
            const k = b < 0 ? 'outside the heart' : `blood of structure ${Math.floor(b / 100)}`;
            other.set(k, (other.get(k) ?? 0) + H * H);
          }
        }
      }
  return { n, zMean: zSum / Math.max(1, n), zAnn: hp.zAnn, ostium, other };
}

describe('the coronary sinus runs above the mitral annulus into the right atrium (decision 321)', () => {
  for (const { id } of CASE_INPUTS)
    it(id, () => {
      const problems: string[] = [];
      let closed = false;
      for (const phase of [0, 0.35]) {
        const c = census(id, phase);
        if (c.n === 0) problems.push(`@${phase}: no coronary sinus`);
        if (c.zMean >= c.zAnn) problems.push(`@${phase}: on the ventricular side of the annulus`);
        for (const [k, a] of c.other)
          if (a > 0.05) problems.push(`@${phase}: touches ${k} over ${a.toFixed(2)} cm²`);
        if (c.ostium < 0.2) closed = true;
      }
      expect(problems).toEqual([]);
      const declared = KNOWN_CS_OSTIUM[id];
      // a declared case must still need it: once its ostium opens, the entry is stale
      expect(closed, declared ? `declared: ${declared}` : 'ostium into the right atrium').toBe(
        !!declared,
      );
    });
});
