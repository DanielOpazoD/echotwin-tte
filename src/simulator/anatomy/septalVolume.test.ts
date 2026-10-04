// @tier slow
import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { buildCaseModels, REST_PATIENT } from './caseModels';
import { classifyHeart, computeHeartPose } from './heartModel';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { makeSample, Structure } from './tissue';

function radicalInverse(i: number, base: number): number {
  let fraction = 1,
    value = 0;
  while (i > 0) {
    fraction /= base;
    value += fraction * (i % base);
    i = Math.floor(i / base);
  }
  return value;
}

describe('septal deformation preserves ventricular blood volume', () => {
  it('matches the hemodynamic volume at ED, ES and filling in pulmonary hypertension', () => {
    const c = loadCaseById('pulmonary-hypertension-rv');
    const { heart, tables } = buildCaseModels(c, REST_PATIENT);
    for (const phase of [0, tables.endSystoleS / tables.rrS, 0.7]) {
      const state = cycleStateAt(tables, phase);
      const hp = computeHeartPose(heart, state);
      const sample = makeSample();
      const n = 160000,
        length = heart.lv.lengthCm;
      let inside = 0;
      for (let i = 1; i <= n; i++) {
        const x = -4.5 + 9 * radicalInverse(i, 2);
        const y = -4.5 + 9 * radicalInverse(i, 3);
        const z = -1 + (length + 1.6) * radicalInverse(i, 5);
        if (
          classifyHeart(heart, hp, x, y, z, sample) &&
          (sample.structure === Structure.LvCavity ||
            sample.structure === Structure.PapillaryMuscle)
        )
          inside++;
      }
      const volumeMl = (inside * 81 * (length + 1.6)) / n;
      expect(Math.abs(volumeMl / state.lvVolumeMl - 1), `phase ${phase}`).toBeLessThan(0.05);
      expect(hp.septalShiftCm).toBeGreaterThan(0.5);
      // Independent anatomical transverse section, not a claimed screen measurement.
      // ASE right-heart 2025: AP/septolateral eccentricity >1.1 is abnormal.
      const diameter = (axis: 0 | 1) => {
        let lo = Infinity,
          hi = -Infinity;
        for (let v = -6; v <= 6; v += 0.01) {
          if (
            classifyHeart(
              heart,
              hp,
              axis === 0 ? v : 0,
              axis === 1 ? v : 0,
              hp.zAnn + 0.45 * hp.lengthNow,
              sample,
            ) &&
            (sample.structure === Structure.LvCavity ||
              sample.structure === Structure.PapillaryMuscle)
          ) {
            lo = Math.min(lo, v);
            hi = Math.max(hi, v);
          }
        }
        return hi - lo;
      };
      expect(diameter(1) / diameter(0), `preserved D-shape at phase ${phase}`).toBeGreaterThan(1.1);
    }
  });
});
