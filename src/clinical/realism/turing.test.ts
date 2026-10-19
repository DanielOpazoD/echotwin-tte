import { describe, expect, it } from 'vitest';
import {
  aucFromRatings,
  buildTrial,
  gradeTuring,
  seededRandom,
  simRating,
  type Answer,
  type ClipItem,
} from './turing';

const items = (view: string, real: number, sim: number): ClipItem[] => [
  ...Array.from({ length: real }, (_, i) => ({
    source: 'real' as const,
    view,
    file: `/x/real-${view}-${i}.mp4`,
    what: `real ${i}`,
  })),
  ...Array.from({ length: sim }, (_, i) => ({
    source: 'sim' as const,
    view,
    file: `/x/sim-${view}-${i}.mp4`,
    what: `sim ${i}`,
  })),
];

describe('buildTrial', () => {
  const pool = [
    ...items('a4c/tile-still', 9, 4),
    ...items('a2c/tile-still', 3, 8),
    ...items('plax/tile-clip', 0, 3),
  ];
  it('balances real and simulated clips per view, up to perView each, and leaves out views with one side empty', () => {
    const t = buildTrial(pool, 6, 1);
    const count = (view: string, real: boolean) =>
      t.key.filter((k) => k.view === view && k.real === real).length;
    expect([count('a4c/tile-still', true), count('a4c/tile-still', false)]).toEqual([4, 4]);
    expect([count('a2c/tile-still', true), count('a2c/tile-still', false)]).toEqual([3, 3]);
    expect(t.skipped).toEqual([{ view: 'plax/tile-clip', real: 0, sim: 3 }]);
    expect(t.clips.map((c) => c.n)).toEqual(t.key.map((k) => k.n));
    expect(new Set(t.clips.map((c) => c.file)).size).toBe(t.clips.length);
  });
  it('is fixed by its seed and changes with it', () => {
    expect(buildTrial(pool, 6, 1)).toEqual(buildTrial(pool, 6, 1));
    expect(buildTrial(pool, 6, 2).key.map((k) => k.what)).not.toEqual(
      buildTrial(pool, 6, 1).key.map((k) => k.what),
    );
  });
  it('mixes the sources: neither half of the order is all of one kind', () => {
    const t = buildTrial(pool, 6, 3);
    const firstHalf = t.key.slice(0, t.key.length / 2).filter((k) => k.real).length;
    expect(firstHalf).toBeGreaterThan(0);
    expect(firstHalf).toBeLessThan(t.key.length / 2);
  });
});

describe('gradeTuring', () => {
  const key = [
    { n: 1, real: true, view: 'a', what: '' },
    { n: 2, real: false, view: 'a', what: '' },
    { n: 3, real: true, view: 'b', what: '' },
    { n: 4, real: false, view: 'b', what: '' },
  ];
  const ans = (
    n: number,
    call: 'real' | 'sim',
    confidence: 1 | 2 | 3,
    giveaways: Answer['giveaways'] = [],
  ): Answer => ({
    n,
    call,
    confidence,
    giveaways,
  });
  it('a reader who tells them apart: accuracy 1, AUC 1, giveaways from the simulated clips caught', () => {
    const g = gradeTuring(key, {
      answers: [
        ans(1, 'real', 3),
        ans(2, 'sim', 2, ['textura']),
        ans(3, 'real', 1, ['bordes']),
        ans(4, 'sim', 3, ['textura', 'movimiento']),
      ],
    });
    expect([g.correct, g.accuracy, g.auc, g.simDetected, g.realAccepted]).toEqual([4, 1, 1, 1, 1]);
    expect(g.giveaways).toEqual([
      { giveaway: 'textura', count: 2 },
      { giveaway: 'movimiento', count: 1 },
    ]);
    expect(g.byView['b']).toEqual({ answered: 2, correct: 2, accuracy: 1 });
  });
  it('a reader who cannot: calls everything real with the same confidence → AUC ½', () => {
    const g = gradeTuring(key, { answers: key.map((k) => ans(k.n, 'real', 1)) });
    expect(g.accuracy).toBe(0.5);
    expect(g.auc).toBe(0.5);
    expect(g.simDetected).toBe(0);
  });
  it('a reader fooled the other way round: AUC 0', () => {
    const g = gradeTuring(key, { answers: key.map((k) => ans(k.n, k.real ? 'sim' : 'real', 2)) });
    expect(g.auc).toBe(0);
    expect(g.pChance).toBe(1);
  });
  it('ratings and the Mann–Whitney AUC', () => {
    expect([1, 2, 3].map((c) => simRating({ call: 'real', confidence: c as 1 | 2 | 3 }))).toEqual([
      3, 2, 1,
    ]);
    expect([1, 2, 3].map((c) => simRating({ call: 'sim', confidence: c as 1 | 2 | 3 }))).toEqual([
      4, 5, 6,
    ]);
    expect(aucFromRatings([2, 3], [1, 2])).toBe(0.875);
    expect(aucFromRatings([], [1])).toBeNaN();
  });
  it('seededRandom is uniform enough and reproducible', () => {
    const r = seededRandom(9);
    const v = Array.from({ length: 10_000 }, () => r());
    expect(Math.min(...v)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...v)).toBeLessThan(1);
    expect(v.reduce((a, b) => a + b, 0) / v.length).toBeCloseTo(0.5, 1);
    expect(seededRandom(9)()).toBe(v[0]);
  });
});
