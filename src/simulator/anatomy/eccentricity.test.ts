// @tier slow
import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { buildCaseModels, REST_PATIENT } from './caseModels';
import { classifyHeart, computeHeartPose } from './heartModel';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { makeSample, Structure } from './tissue';

/**
 * The D sign (PR 26 of the 27-09 panel): the left ventricular eccentricity index, the cavity's diameter parallel to the
 * septum over the one perpendicular to it at the papillary level, is 1.00 ± 0.06 in systole and 1.01 ± 0.04 in diastole
 * in normal hearts; above 1.2 it marks right ventricular overload, and pressure overload flattens the septum most at end
 * systole (Ryan et al., J Am Coll Cardiol 1985;5:918-927). Measured in the heart's own short axis.
 */
function eccentricity(id: string, at: 'ed' | 'es'): number {
  const { heart, tables } = buildCaseModels(loadCaseById(id), REST_PATIENT);
  const hp = computeHeartPose(
    heart,
    cycleStateAt(tables, at === 'ed' ? 0 : tables.endSystoleS / tables.rrS),
  );
  const z = hp.zAnn + 0.45 * hp.lengthNow;
  const s = makeSample();
  const run = (dx: number, dy: number) => {
    const inside = (t: number) =>
      classifyHeart(heart, hp, dx * t, dy * t, z, s) &&
      (s.structure === Structure.LvCavity || s.structure === Structure.PapillaryMuscle);
    let lo = 0,
      hi = 0;
    for (let t = 0; t < 5 && inside(t); t += 0.02) hi = t;
    for (let t = 0; t > -5 && inside(t); t -= 0.02) lo = t;
    return hi - lo;
  };
  // x runs septum (−) to lateral wall (+), y inferior to anterior: parallel over perpendicular to the septum
  return run(0, 1) / run(1, 0);
}

describe('the D sign of right ventricular pressure overload', () => {
  it('a normal ventricle is round; the pulmonary hypertension case flattens its septum past 1.2 at end systole', () => {
    const normal = [
      eccentricity('normal-excellent-window', 'ed'),
      eccentricity('normal-excellent-window', 'es'),
    ];
    for (const ei of normal) expect(Math.abs(ei - 1)).toBeLessThan(0.07);
    const ed = eccentricity('pulmonary-hypertension-rv', 'ed');
    const es = eccentricity('pulmonary-hypertension-rv', 'es');
    expect(es).toBeGreaterThan(1.2);
    // pressure overload: flatter in systole than in diastole
    expect(es).toBeGreaterThan(ed);
  });
});
