import { describe, expect, it } from 'vitest';
import { SimulatorCore } from './simulatorCore';
import { baseInput } from './baseInput';
import { loadCaseById } from '@/cases';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import { DEFAULT_ACQUISITION } from '@/simulator/renderer/types';
import { persistenceOverTime } from '@/simulator/renderer/postprocess/consolePipeline';

const P = 0.7;

/**
 * Persistence decays with time, not per rendered frame (decision 94, external audit F12). A device that renders every
 * second or third frame interval must show the same temporal response as one that keeps the simulated frame rate. The
 * probe measures it on the displayed image of the app chain: two cores with identical scenes, one of them given a
 * +12 dB gain step, and the mean grey difference between them after the step, normalised by its settled value. With a
 * linear grey map and no edge enhancement the history blends linearly, so the fraction reached after T frame intervals
 * is 1 − p^T. With a weight per rendered frame it was 1 − p^(T/k) when stepping k intervals per frame: 0.30 instead of
 * 0.51 two intervals after the step at half the rate.
 */
function stepResponse(k: number): { fractions: number[]; reported: number; intervals: number[] } {
  const c = loadCaseById('normal-excellent-window');
  const setup = new SimulatorCore(c, baseInput());
  const probe = canonicalControl(getViewTarget('a4c'), setup.models.heart, setup.models.thorax);
  const settings = (gainDb: number) => ({ ...DEFAULT_ACQUISITION, tgcDb: [...DEFAULT_ACQUISITION.tgcDb], grayMap: 'linear' as const, edgeEnhance: 0, persistence: P, gainDb });
  const interval = 1 / setup.step(1 / 30)!.simulatedFps;
  const dt = k * interval;
  const withStep = new SimulatorCore(c, baseInput({ probe, settings: settings(-6) }));
  const without = new SimulatorCore(c, baseInput({ probe, settings: settings(-6) }));
  for (let t = 0; t < 0.25; t += dt) {
    withStep.step(dt);
    without.step(dt);
  }
  withStep.setInput(baseInput({ probe, settings: settings(6) }));
  const mean = (rgba: ArrayBuffer): number => {
    const u = new Uint8Array(rgba);
    let s = 0;
    for (let o = 0; o < u.length; o += 4) s += u[o]!;
    return s / (u.length / 4);
  };
  const d: number[] = [];
  let reported = NaN;
  for (let n = 0; n < Math.ceil(0.3 / dt); n++) {
    const a = withStep.step(dt)!;
    d.push(mean(a.rgba) - mean(without.step(dt)!.rgba));
    reported = Number(a.stats.persistence);
  }
  const settled = d.slice(-3).reduce((x, y) => x + y, 0) / 3;
  return { fractions: d.slice(0, 3).map((v) => v / settled), reported, intervals: [1, 2, 3].map((n) => n * k) };
}

describe('persistence over time (decision 94)', () => {
  it('weighs the history by elapsed frame intervals, and a frame right after another still contributes', () => {
    const interval = 1 / 48;
    expect(persistenceOverTime(P, interval, interval)).toBeCloseTo(P, 12);
    expect(persistenceOverTime(P, 2 * interval, interval)).toBeCloseTo(P * P, 12);
    expect(persistenceOverTime(P, 0.5 * interval, interval) ** 2).toBeCloseTo(P, 12);
    expect(persistenceOverTime(P, 0, interval)).toBeCloseTo(P ** 0.25, 12);
    expect(persistenceOverTime(0, 3 * interval, interval)).toBe(0);
  });

  for (const k of [1, 2, 3]) {
    it(`the displayed image follows a gain step with the same time response when the loop renders every ${k} frame interval(s)`, { timeout: 120_000 }, () => {
      const { fractions, reported, intervals } = stepResponse(k);
      const expected = intervals.map((t) => 1 - P ** t);
      expect(
        fractions.map((f, i) => Math.abs(f - expected[i]!) < 0.02),
        `fraction of the step after ${intervals.join(', ')} intervals: ${fractions.map((f) => f.toFixed(3)).join(', ')} against ${expected.map((f) => f.toFixed(3)).join(', ')}`,
      ).toEqual([true, true, true]);
      expect(reported).toBeCloseTo(P ** k, 2);
    });
  }
});
