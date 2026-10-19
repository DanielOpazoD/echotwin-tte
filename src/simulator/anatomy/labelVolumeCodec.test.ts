/** Run-length code of the shipped label volume (decision 352). */
import { describe, expect, it } from 'vitest';
import { decodeLabelRuns, encodeLabelRuns } from './labelVolumeCodec';

describe('label volume run-length code (decision 352)', () => {
  it('gives back the volume it coded, runs longer than one varint byte included', () => {
    const v = new Uint8Array(70_000);
    v.fill(31, 10, 300);
    v.fill(1, 300, 300 + 20_000);
    v[50_000] = 7;
    for (let i = 60_000; i < 60_050; i++) v[i] = i % 3;
    const runs = encodeLabelRuns(v);
    expect(runs.length).toBeLessThan(400);
    expect(decodeLabelRuns(runs, v.length)).toEqual(v);
  });

  it('refuses a code that is cut short, runs past the volume or falls short of it', () => {
    const runs = encodeLabelRuns(new Uint8Array(1000).fill(4));
    expect(() => decodeLabelRuns(runs.subarray(0, runs.length - 1), 1000)).toThrow();
    expect(() => decodeLabelRuns(runs, 999)).toThrow();
    expect(() => decodeLabelRuns(runs, 1001)).toThrow();
    // a run of no labels is not a code the encoder writes
    expect(() => decodeLabelRuns(Uint8Array.from([4, 0, 4, 10]), 10)).toThrow(/empty/);
  });
});
