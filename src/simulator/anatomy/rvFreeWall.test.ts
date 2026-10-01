// @tier slow
import { describe, expect, it } from 'vitest';
import { listCases, loadCaseById } from '@/cases';
import { anchorsCached } from './anchors';
import { buildCaseModels, REST_PATIENT } from './caseModels';
import { classifyHeart, computeHeartPose } from './heartModel';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { makeSample, Structure } from './tissue';

/**
 * The right ventricular free wall in systole and early diastole (decision 243). The crescent pulled its free wall in up
 * to the tricuspid plane while the inflow column, as wide as the annulus and rigid, kept its width 3 cm into the
 * ventricle: in systole the column stood out of the crescent, the free wall folded around it, and in early diastole,
 * when the annulus rose, the fold sprang open — the free wall of the four-chamber view near the atrium «contracting
 * abruptly», out of phase with the rest, to a reviewing echocardiographer.
 */
const RV = new Set<Structure>([
  Structure.RvCavity,
  Structure.RvWall,
  Structure.Rvot,
  Structure.ModeratorBand,
  Structure.RvPapillary,
]);
const cases = listCases().map((c) => c.id);

describe('the right ventricular free wall is one surface through the cycle (decision 243)', () => {
  it.each(cases)(
    'no radial line from the septum leaves the right ventricle and meets it again: %s',
    (id) => {
      const { heart, tables } = buildCaseModels(loadCaseById(id), REST_PATIENT);
      const A = anchorsCached(heart);
      const s = makeSample();
      const folds: string[] = [];
      // systole and early diastole, where the fold was (0.30-0.60 of the cycle on main)
      for (let ph = 0.3; ph < 0.66; ph += 0.05) {
        const hp = computeHeartPose(heart, cycleStateAt(tables, ph));
        const tvPlane = A.tvCenter.z + hp.tvZ;
        for (let az = A.rvAzA + 0.1; az < A.rvAzP - 0.1; az += 0.25) {
          const ca = Math.cos(az),
            sa = Math.sin(az);
          for (let z = tvPlane + 0.3; z < A.rvApexFrac * heart.lv.lengthCm - 0.3; z += 0.5) {
            // 0 before the RV, 1 in it, 2 out of the heart past it; a fold is ≥ 2.5 mm of RV met again past a gap
            let state = 0,
              again = 0;
            for (let r = 1.5; r < 9; r += 0.04) {
              const inHeart = classifyHeart(heart, hp, r * ca, r * sa, z, s);
              const rv = inHeart && RV.has(s.structure);
              if (state === 0 && rv) state = 1;
              else if (state === 1 && !inHeart) state = 2;
              else if (state === 2) {
                again = rv ? again + 0.04 : 0;
                if (again >= 0.25) {
                  folds.push(
                    `phase ${ph.toFixed(2)} az ${az.toFixed(2)} ${(z - tvPlane).toFixed(2)} cm below the annulus, r ${r.toFixed(2)}`,
                  );
                  break;
                }
              }
            }
          }
        }
      }
      expect(folds.slice(0, 6), `${folds.length} folded lines`).toEqual([]);
    },
  );

  it.each(cases)(
    'the free wall of the four-chamber plane moves at most 6 mm in a fortieth of the cycle: %s',
    (id) => {
      const { heart, tables } = buildCaseModels(loadCaseById(id), REST_PATIENT);
      const s = makeSample();
      // lines across the free wall of the four-chamber plane and either side of it, apical of where the annulus goes
      const lines: [number, number][] = [];
      for (const y of [-1, -0.17, 0.8]) for (let z = 4; z <= 7; z += 0.5) lines.push([y, z]);
      const outer = (ph: number): number[] => {
        const hp = computeHeartPose(heart, cycleStateAt(tables, ph % 1));
        return lines.map(([y, z]) => {
          for (let x = -9; x < -1; x += 0.04)
            if (classifyHeart(heart, hp, x, y, z, s) && RV.has(s.structure)) return x;
          return NaN;
        });
      };
      let worst = 0,
        at = '';
      let prev = outer(0);
      for (let k = 1; k <= 40; k++) {
        const now = outer(k / 40);
        now.forEach((x, i) => {
          const jump = Math.abs(x - prev[i]!);
          if (jump > worst) {
            worst = jump;
            at = `phase ${(k / 40).toFixed(3)} y ${lines[i]![0]} z ${lines[i]![1]}: ${prev[i]!.toFixed(2)} → ${x.toFixed(2)} cm`;
          }
        });
        prev = now;
      }
      // 0.88-1.56 cm on main in the normal, pulmonary hypertension and obstructive cases; 0.16-0.46 with the tether
      expect(worst, at).toBeLessThan(0.6);
    },
  );
});
