import { describe, expect, it } from 'vitest';
import { auc, crossValidate, predictLogistic, trainLogistic } from './logistic';

/** Deterministic normal deviates (Box–Muller on xorshift). */
function gaussian(seed: number): () => number {
  let s = seed | 0 || 1;
  const u = (): number => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) + 1) / 4294967297;
  };
  return () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
}

describe('distinguishability by logistic regression', () => {
  it('scores a perfect ranking 1, a reversed one 0 and ties one half', () => {
    expect(auc([0.9, 0.8, 0.2, 0.1], [1, 1, 0, 0])).toBe(1);
    expect(auc([0.1, 0.2, 0.8, 0.9], [1, 1, 0, 0])).toBe(0);
    expect(auc([0.5, 0.5, 0.5, 0.5], [1, 1, 0, 0])).toBe(0.5);
    expect(auc([0.9, 0.5, 0.5, 0.1], [1, 0, 1, 0])).toBe(0.875);
  });

  it('separates two Gaussian clouds that differ in one of eight features and ignores the other seven', () => {
    const g = gaussian(11);
    const x: number[][] = [],
      y: number[] = [];
    for (let i = 0; i < 400; i++) {
      const cls = i % 2;
      const row = Array.from({ length: 8 }, () => g());
      row[3] = row[3]! + (cls ? 2.5 : -2.5); // the telling feature, three standard deviations apart
      row[5] = Number.NaN; // a feature never available
      x.push(row);
      y.push(cls);
    }
    const cv = crossValidate(x, y, 5, 3);
    expect(cv.auc).toBeGreaterThan(0.97);
    expect(Math.min(...cv.folds)).toBeGreaterThan(0.93);
    const model = trainLogistic(x, y);
    const w = Array.from(model.weights, Math.abs);
    expect(w[3]).toBeGreaterThan(3 * Math.max(...w.filter((_, j) => j !== 3)));
    expect(model.weights[5]).toBe(0);
    expect(predictLogistic(model, x[0]!) > 0.5).toBe(y[0] === 1);
  });

  it('stays at chance on labels that carry no information, whatever the class balance', () => {
    const g = gaussian(5);
    const x: number[][] = [],
      y: number[] = [];
    for (let i = 0; i < 600; i++) {
      x.push(Array.from({ length: 10 }, () => g()));
      y.push(i % 4 === 0 ? 1 : 0); // one positive in four
    }
    const cv = crossValidate(x, y, 5, 9);
    expect(cv.auc).toBeGreaterThan(0.4);
    expect(cv.auc).toBeLessThan(0.6);
  });
});
