import { describe, expect, it } from 'vitest';
import { compareGaps, toBaseline, type GapScore } from './verdict';

const g = (id: string, score: number, sim = score): GapScore => ({
  id,
  metric: `métrica ${id}`,
  sim,
  ref: 0,
  score,
});

describe('compareGaps', () => {
  it('a change that lowers one gap and keeps the rest brings the simulator closer', () => {
    const c = compareGaps([g('a', 1.4), g('b', 0.5)], [g('a', 0.9), g('b', 0.55)]);
    expect(c.verdict).toBe('acerca');
    expect([c.improved, c.worsened, c.unchanged]).toEqual([1, 0, 1]);
    expect(c.rows.find((r) => r.id === 'a')!.verdict).toBe('mejora');
    expect(c.rows.find((r) => r.id === 'b')!.verdict).toBe('igual');
  });
  it('one gap worse is enough to move it away, and both together are mixed', () => {
    expect(compareGaps([g('a', 1)], [g('a', 1.2)]).verdict).toBe('aleja');
    expect(compareGaps([g('a', 1), g('b', 1)], [g('a', 0.5), g('b', 1.5)]).verdict).toBe('mixto');
    expect(compareGaps([g('a', 1)], [g('a', 1)]).verdict).toBe('igual');
  });
  it('lists the worst change first, and marks gaps new or no longer measured', () => {
    const c = compareGaps(
      [g('a', 1), g('b', 1), g('gone', 2)],
      [g('a', 0.2), g('b', 1.8), g('new', 3)],
    );
    expect(c.rows[0]!.id).toBe('b');
    expect(c.rows.find((r) => r.id === 'gone')!.verdict).toBe('sin medir');
    expect(c.rows.find((r) => r.id === 'new')!.verdict).toBe('nueva');
    expect(c.verdict).toBe('mixto');
  });
  it('the tolerance decides what counts as a change; a NaN score is not measured', () => {
    expect(compareGaps([g('a', 1)], [g('a', 1.05)]).verdict).toBe('igual');
    expect(compareGaps([g('a', 1)], [g('a', 1.05)], 0.01).verdict).toBe('aleja');
    expect(compareGaps([g('a', 1)], [g('a', NaN)]).rows[0]!.verdict).toBe('sin medir');
  });
  it('leaves out a gap whose reference changed: its scores do not compare', () => {
    const before = { ...g('a', 1.5), ref: 19.64 };
    const c = compareGaps([before, g('b', 1)], [{ ...g('a', 0.2), ref: 20.1 }, g('b', 1)]);
    expect(c.rows.find((r) => r.id === 'a')!.verdict).toBe('referencia distinta');
    expect(c.verdict).toBe('igual');
    expect(compareGaps([before], [{ ...before, ref: 19.64 + 1e-12 }]).rows[0]!.verdict).toBe(
      'igual',
    );
  });
  it('leaves out a gap whose instrument the run marks as not validated', () => {
    const c = compareGaps(
      [g('a', 1), g('b', 3.8)],
      [g('a', 1), { ...g('b', 4.5), caveat: 'rastreador' }],
    );
    expect(c.rows.find((r) => r.id === 'b')!.verdict).toBe('sin validar');
    expect(c.verdict).toBe('igual');
    expect(c.worsened).toBe(0);
  });
  it('a baseline keeps only the gap fields', () => {
    const b = toBaseline('actual', 'abc', '2026-10-18', [
      { ...g('a', 1), extra: '/Users/x' } as GapScore,
    ]);
    expect(b.gaps[0]).toEqual(g('a', 1));
    expect(JSON.stringify(b)).not.toContain('/Users/');
  });
});
