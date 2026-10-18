// @tier slow
/**
 * The segment panel holds still in a window (decision 342). At the app's opening probe, an off-axis parasternal long
 * axis, the heart moves through the plane with the beat and the frame-by-frame analysis changed the panel's lists three
 * times per cycle (evaluable 2,4,5,8,10 → 2,4,5,8,9,10 → 2,3,4,8,9). Over three beats of an unchanged probe the steady
 * panel changes once, when the first beat is in.
 */
import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { SimulatorCore } from '@/simulator/core/simulatorCore';
import { baseInput } from '@/simulator/core/baseInput';
import { SteadySegments } from '@/app/steadySegments';
import type { SegmentCoverage } from '@/simulator/view-recognition/segmentCoverage';

const lists = (c: SegmentCoverage[]): string =>
  `${c
    .filter((x) => x.assessable)
    .map((x) => x.segmentId)
    .join(',')}|${c
    .filter((x) => x.inPlane && !x.assessable)
    .map((x) => x.segmentId)
    .join(',')}`;

describe('the segment panel holds still in a window (decision 342)', () => {
  it('changes once over three beats of the opening probe, where the frames change several times a beat', () => {
    const input = baseInput();
    const core = new SimulatorCore(loadCaseById('normal-excellent-window'), input);
    core.setInput(input);
    const steady = new SteadySegments();
    const raw: string[] = [];
    const shown: string[] = [];
    try {
      for (let i = 0; i < 120; i++) {
        const out = core.step(0.025);
        if (!out?.view) continue;
        raw.push(lists(out.view.segments.aha17));
        const held = steady.push('opening', {
          aha17: out.view.segments.aha17,
          lv16: out.view.segments.lv16,
          timeS: out.timeS,
          rrS: out.rrS,
        });
        shown.push(lists(held.aha17));
      }
    } finally {
      core.dispose();
    }
    const changes = (v: string[]) => v.filter((x, k) => k > 0 && x !== v[k - 1]).length;
    expect(changes(raw), 'the frames themselves change within each beat').toBeGreaterThanOrEqual(6);
    expect(changes(shown)).toBeLessThanOrEqual(1);
  });
});
