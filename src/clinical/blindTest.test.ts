import { describe, expect, it } from 'vitest';
import { gradeAnswers } from './blindTest';

const key = Array.from({ length: 24 }, (_, i) => ({ tile: i + 1, real: i % 2 === 0 }));
const answer = (correct: number): Record<string, 'real' | 'sim'> => {
  const a: Record<string, 'real' | 'sim'> = {};
  key.forEach((k, i) => (a[String(k.tile)] = (i < correct ? k.real : !k.real) ? 'real' : 'sim'));
  return a;
};

describe('blind test scoring', () => {
  it('counts the answers, the confusions and the chance of the score', () => {
    const all = gradeAnswers(key, answer(24));
    expect(all).toMatchObject({ tiles: 24, answered: 24, correct: 24, accuracy: 1 });
    expect(all.pChance).toBeCloseTo(Math.pow(0.5, 24), 12);
    const half = gradeAnswers(key, answer(12));
    expect(half.correct).toBe(12);
    // the twelve wrong answers alternate real→sim and sim→real
    expect(half.realCalledSim).toBe(6);
    expect(half.simCalledReal).toBe(6);
    expect(half.pChance).toBeCloseTo(0.581, 2);
    // the protocol's goal: 17 of 24 is the first score that is unlikely by chance
    expect(gradeAnswers(key, answer(17)).pChance).toBeCloseTo(0.032, 2);
    expect(gradeAnswers(key, answer(16)).pChance).toBeGreaterThan(0.05);
  });

  it('ignores unanswered tiles and malformed answers without crediting them', () => {
    const partial = gradeAnswers(key, {
      '1': 'real',
      '2': 'sim',
      '3': 'sim',
      '4': 'maybe' as 'sim',
    });
    expect(partial.answered).toBe(3);
    expect(partial.correct).toBe(2);
    expect(partial.pChance).toBeCloseTo(0.5, 6);
    expect(gradeAnswers(key, {}).accuracy).toBeNaN();
  });
});
