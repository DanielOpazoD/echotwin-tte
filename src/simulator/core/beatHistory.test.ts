import { describe, expect, it } from 'vitest';
import { BeatHistory } from './beatHistory';
const clock = (index: number, start: number, rr: number, time: number) => ({
  timeS: time,
  beatIndex: index,
  timeInBeatS: time - start,
  rrS: rr,
  phase: (time - start) / rr,
  previousRrS: 0.8,
});
describe('bounded retrospective beat context', () => {
  it('resolves both sides of QRS using the original RR and table identity', () => {
    const history = new BeatHistory<{ volume: number }>(),
      a = { volume: 120 },
      b = { volume: 85 };
    history.remember(clock(0, 0, 0.6, 0.59), a);
    history.remember(clock(1, 0.6, 0.9, 0.65), b);
    expect(history.at(0.57).phase).toBeCloseTo(0.95, 12);
    expect(history.at(0.57).context).toBe(a);
    expect(history.at(0.6).context).toBe(b);
    expect(history.at(0.645).phase).toBeCloseTo(0.05, 12);
  });
  it('replaces the current context without growing memory and rejects timestamps older than retained beats', () => {
    const history = new BeatHistory<number>();
    for (let i = 0; i < 10; i++) history.remember(clock(i, i, 1, i + 0.1), i);
    history.remember(clock(9, 9, 1, 9.5), 99);
    expect(history.at(7.9).context).toBe(7);
    expect(history.at(9.4).context).toBe(99);
    expect(() => history.at(6.99)).toThrow(RangeError);
  });
});
