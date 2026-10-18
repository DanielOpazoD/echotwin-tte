// @tier fast
/**
 * The segments of a window hold steady (decision 342): judged on one beat, they stay while the window stays, and a new
 * window shows its first frame until its own beat is in.
 */
import { describe, expect, it } from 'vitest';
import type { SegmentCoverage } from '@/simulator/view-recognition/segmentCoverage';
import { STEADY_ASSESSABLE_SHARE, SteadySegments, summariseBeat } from './steadySegments';

const seg = (segmentId: number, over: Partial<SegmentCoverage> = {}): SegmentCoverage => ({
  model: 'LV_AHA17',
  segmentId,
  inPlane: true,
  insonified: true,
  assessable: true,
  reason: null,
  areaCm2: 2,
  insonifiedFraction: 1,
  lengthCm: 2,
  borderContrast: 80,
  ...over,
});
const out = (segmentId: number): SegmentCoverage =>
  seg(segmentId, {
    inPlane: false,
    insonified: false,
    assessable: false,
    reason: 'not_in_plane',
    areaCm2: 0,
    borderContrast: null,
  });

describe('steady segments (decision 342)', () => {
  it('judges a segment on the beat: evaluable for two thirds of it, partial when in the plane for part of it', () => {
    // 6 frames: 8 evaluable throughout, 9 in four of them (two evaluable), 3 in one, 5 never
    const frames = [0, 1, 2, 3, 4, 5].map((k) => [
      seg(8),
      k < 4 ? seg(9, { assessable: k < 2, reason: k < 2 ? null : 'insufficient_extent' }) : out(9),
      k === 0 ? seg(3, { assessable: false, reason: 'insufficient_extent' }) : out(3),
      out(5),
    ]);
    const s = summariseBeat(frames);
    expect(s.map((c) => [c.segmentId, c.inPlane, c.assessable])).toEqual([
      [8, true, true],
      [9, true, false],
      [3, true, false],
      [5, false, false],
    ]);
    expect(s[1]!.reason).toBe('insufficient_extent');
    expect(s[1]!.areaCm2).toBe(2);
    // evaluable in exactly two thirds of the frames is evaluable
    const two = [0, 1, 2].map((k) => [
      seg(2, { assessable: k < 2, reason: k < 2 ? null : 'insufficient_border_visibility' }),
    ]);
    expect(STEADY_ASSESSABLE_SHARE).toBeCloseTo(2 / 3, 9);
    expect(summariseBeat(two)[0]!.assessable).toBe(true);
  });

  it('shows the first frame until a beat is in, then holds that beat while the window stays', () => {
    const h = new SteadySegments();
    const f = (t: number, assessable: boolean) => ({
      timeS: t,
      rrS: 1,
      aha17: [seg(8, { assessable, reason: assessable ? null : 'insufficient_border_visibility' })],
      lv16: [],
    });
    expect(h.push('a', f(0, true)).aha17[0]!.assessable).toBe(true);
    // within the beat the panel keeps the first frame, whatever the frames say
    expect(h.push('a', f(0.3, false)).aha17[0]!.assessable).toBe(true);
    expect(h.push('a', f(0.6, false)).aha17[0]!.assessable).toBe(true);
    // the beat is in: evaluable in one frame of three, not evaluable, and so it stays
    expect(h.push('a', f(1.0, false)).aha17[0]!.assessable).toBe(false);
    for (const t of [1.2, 1.5, 2.1, 3.0])
      expect(h.push('a', f(t, true)).aha17[0]!.assessable).toBe(false);
    // a new window starts again from its first frame
    expect(h.push('b', f(3.1, true)).aha17[0]!.assessable).toBe(true);
  });
});
