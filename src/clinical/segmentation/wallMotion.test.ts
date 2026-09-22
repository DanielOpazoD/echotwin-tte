import { describe, expect, it } from 'vitest';
import type { WallMotionId } from './catalog';
import {
  computeWmsi,
  consolidateWallMotion,
  observationErrors,
  type SegmentObservation,
  type WallMotionScore,
} from './wallMotion';

/** Wall-motion scoring and WMSI against the acceptance criteria of the segmentation guide (decision 152). */
const obs = (
  segmentId: number,
  viewId: string,
  score: WallMotionScore | null,
  over: Partial<SegmentObservation> = {},
): SegmentObservation => ({
  model: 'LV_16',
  segmentId: segmentId as WallMotionId,
  viewId,
  phase: 0,
  inPlane: true,
  insonified: true,
  assessable: score !== null,
  reason: score === null ? 'insufficient_border_visibility' : null,
  wallMotionScore: score,
  source: 'synthetic_ground_truth',
  referenceIds: ['ase-eacvi-chamber-2015'],
  ...over,
});
const ALL = Array.from({ length: 16 }, (_, i) => i + 1);

describe('wall-motion score index', () => {
  it('is 1 for sixteen normal segments', () => {
    const a = consolidateWallMotion(ALL.map((id) => obs(id, 'a4c', 1)));
    expect(computeWmsi(a)).toMatchObject({ value: 1, assessed: 16, total: 16, unscored: [] });
  });

  it('divides by the segments scored: 12 × 1 + 2 × 2 over 14 is 16/14, the other two unscored (not 0, not 1)', () => {
    const o = ALL.map((id) =>
      id <= 12 ? obs(id, 'a4c', 1) : id <= 14 ? obs(id, 'a4c', 2) : obs(id, 'a4c', null),
    );
    const w = computeWmsi(consolidateWallMotion(o));
    expect(w.value).toBeCloseTo(16 / 14, 12);
    expect(w.assessed).toBe(14);
    expect(w.unscored).toEqual([15, 16]);
  });

  it('is null when no segment could be scored', () => {
    const w = computeWmsi(consolidateWallMotion(ALL.map((id) => obs(id, 'a4c', null))));
    expect(w.value).toBeNull();
    expect(w.assessed).toBe(0);
  });

  it('counts a segment seen in the A4C and the A3C once', () => {
    const a4c = [3, 9, 14, 6, 12, 16].map((id) => obs(id, 'a4c', 1));
    const a3c = [2, 8, 14, 5, 11, 16].map((id) => obs(id, 'a3c', id >= 14 ? 1 : 2));
    const a = consolidateWallMotion([...a4c, ...a3c]);
    const w = computeWmsi(a);
    expect(w.assessed).toBe(10); // 3 6 9 12 14 16 and 2 5 8 11, not 12
    expect(w.value).toBeCloseTo((6 * 1 + 4 * 2) / 10, 12);
    expect(a[13]!.views).toEqual(['a4c', 'a3c']);
    // a repeated assessment of one segment is refused, not counted twice
    expect(() => computeWmsi([...a, a[13]!])).toThrow(/twice/);
  });

  it('records a discrepancy between views instead of averaging it', () => {
    const o = [obs(16, 'a4c', 1), obs(16, 'a3c', 3)];
    const strict = consolidateWallMotion(o)[15]!;
    expect(strict).toMatchObject({ score: null, discrepant: true, scores: [1, 3] });
    const worst = consolidateWallMotion(o, 'most-abnormal')[15]!;
    expect(worst).toMatchObject({ score: 3, discrepant: true, scores: [1, 3] });
  });

  it('refuses the apex cap, a score without assessability and mixed sources', () => {
    expect(observationErrors(obs(17, 'a4c', 1))).not.toEqual([]);
    expect(
      observationErrors(obs(9, 'a4c', 2, { assessable: false, reason: 'shadowed' })).some((e) =>
        /no score/.test(e),
      ),
    ).toBe(true);
    expect(
      observationErrors(obs(9, 'a4c', 2, { insonified: false })).some((e) => /insonified/.test(e)),
    ).toBe(true);
    expect(() =>
      consolidateWallMotion([obs(1, 'a2c', 1), obs(4, 'a2c', 3, { source: 'learner' })]),
    ).toThrow(/source/);
    expect(() => consolidateWallMotion([obs(17, 'a4c', 1)])).toThrow();
    // assessments of two sources never make one index
    const truth = consolidateWallMotion(ALL.slice(0, 8).map((id) => obs(id, 'a2c', 1))).slice(0, 8);
    const learner = consolidateWallMotion(
      ALL.slice(8).map((id) => obs(id, 'a4c', 2, { source: 'learner' })),
    ).slice(8);
    expect(() => computeWmsi([...truth, ...learner])).toThrow(/one source/);
  });
});
