import type { SegmentCoverage } from '@/simulator/view-recognition/segmentCoverage';

/**
 * The LV segments of a window, steady (decision 342). The view analysis reads each frame on its own, and in an off-axis
 * plane the heart moves through the plane with the beat: at the app's opening probe the parasternal septum went from
 * segment 8 to 9 and the posterior wall from 5 to 4 within each beat, and the segment panel's colours and lists changed
 * three times per cycle. A segment's place in a window is judged on the loop, as a reader does: evaluable when it is
 * evaluable over at least STEADY_ASSESSABLE_SHARE of one beat, partial when it lies in the plane for part of it, out of
 * the plane otherwise. The result holds while the window stays (probe, patient, console and case); a new window shows
 * its first frame until its first beat is in, then its beat, and stays. Pure: no store, no DOM.
 */
export const STEADY_ASSESSABLE_SHARE = 2 / 3;

export interface SteadyCoverage {
  aha17: SegmentCoverage[];
  lv16: SegmentCoverage[];
}

/** One frame of the view analysis with the time and beat length it was read at. */
export interface CoverageFrame extends SteadyCoverage {
  timeS: number;
  rrS: number;
}

/**
 * One beat's frames summarised per segment: evaluable when evaluable in at least STEADY_ASSESSABLE_SHARE of them, in the
 * plane when in it in any; the measures are their means over the frames that hold the segment in the plane, and the
 * reason the most frequent one among the frames where it was not evaluable.
 */
export function summariseBeat(frames: readonly SegmentCoverage[][]): SegmentCoverage[] {
  const first = frames[0];
  if (!first) return [];
  return first.map((c0, i) => {
    const all = frames.map((f) => f[i] ?? c0);
    const inPlane = all.filter((c) => c.inPlane);
    const assessableShare = all.filter((c) => c.assessable).length / all.length;
    const assessable = assessableShare >= STEADY_ASSESSABLE_SHARE;
    const reasons = new Map<string, number>();
    for (const c of all)
      if (!c.assessable && c.reason) reasons.set(c.reason, (reasons.get(c.reason) ?? 0) + 1);
    const reason = assessable
      ? null
      : (([...reasons.entries()].sort(
          (a, b) => b[1] - a[1],
        )[0]?.[0] as SegmentCoverage['reason']) ?? c0.reason);
    const mean = (pick: (c: SegmentCoverage) => number): number =>
      inPlane.length ? inPlane.reduce((m, c) => m + pick(c), 0) / inPlane.length : 0;
    const contrasts = inPlane.map((c) => c.borderContrast).filter((v): v is number => v !== null);
    return {
      ...c0,
      inPlane: inPlane.length > 0,
      insonified: all.some((c) => c.insonified),
      assessable,
      reason,
      areaCm2: mean((c) => c.areaCm2),
      insonifiedFraction: mean((c) => c.insonifiedFraction),
      lengthCm: mean((c) => c.lengthCm),
      borderContrast: contrasts.length
        ? contrasts.reduce((m, v) => m + v, 0) / contrasts.length
        : null,
    };
  });
}

/** Holds a window's segments steady: the first frame until a beat is in, then that beat's summary while the key stays. */
export class SteadySegments {
  private key = '';
  private startS = NaN;
  private lastS = NaN;
  private frames: CoverageFrame[] = [];
  private held: SteadyCoverage | null = null;

  /** The segments to show for this frame of the window `key`. */
  push(key: string, f: CoverageFrame): SteadyCoverage {
    if (key !== this.key) {
      this.key = key;
      this.frames = [];
      this.held = null;
      this.startS = f.timeS;
      this.lastS = NaN;
    }
    if (this.held) return this.held;
    // the same frame again (a redraw, a frozen image) adds nothing
    if (f.timeS !== this.lastS) {
      this.frames.push(f);
      this.lastS = f.timeS;
    }
    if (f.timeS - this.startS >= f.rrS && this.frames.length >= 2) {
      this.held = {
        aha17: summariseBeat(this.frames.map((x) => x.aha17)),
        lv16: summariseBeat(this.frames.map((x) => x.lv16)),
      };
      this.frames = [];
      return this.held;
    }
    return { aha17: this.frames[0]!.aha17, lv16: this.frames[0]!.lv16 };
  }
}
