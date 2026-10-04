import { describe, expect, it } from 'vitest';
import { StripTimeGrid } from './stripTimeGrid';

function acquire(width: number, sweep: number, steps: number[]) {
  const grid = new StripTimeGrid();
  const cps = (width * sweep) / 100;
  const times: number[] = [];
  let time = 0,
    i = 0,
    peak = 0,
    vti = 0,
    maxEstimates = 0;
  while (time < 2 - 1e-10) {
    const dt = Math.min(steps[i++ % steps.length]!, 2 - time);
    time += dt;
    const due = grid.advance(time, dt, cps);
    for (const t of due) {
      times.push(t);
      // Independent analytic half-sine, 0.8 m/s over 300 ms, integral 2*0.8*0.3/pi m.
      const v = t >= 0.5 && t <= 0.8 ? 0.8 * Math.sin((Math.PI * (t - 0.5)) / 0.3) : 0;
      peak = Math.max(peak, v);
      vti += (v / cps) * 100;
    }
    maxEstimates = Math.max(maxEstimates, due.length);
  }
  return { times, peak, vti, maxEstimates, cps };
}

describe('physical strip time survives changes in width, sweep and worker cadence', () => {
  it('preserves analytic Vmax/VTI, regular timestamps and bounded estimator work', () => {
    for (const width of [320, 1024])
      for (const sweep of [25, 50, 100])
        for (const steps of [[0.02], [0.05], [0.1], [0.003, 0.017, 0.047, 0.009]]) {
          const r = acquire(width, sweep, steps);
          expect(r.times).toHaveLength(2 * r.cps);
          for (let i = 0; i < r.times.length; i++) {
            expect(r.times[i]).toBeCloseTo((i + 0.5) / r.cps, 10);
          }
          expect(r.peak).toBeGreaterThan(0.8 * 0.995);
          expect(Math.abs(r.vti / (((2 * 0.8 * 0.3) / Math.PI) * 100) - 1)).toBeLessThan(0.01);
          expect(r.maxEstimates).toBeLessThanOrEqual(103);
        }
  });

  it('starts a new grid after reset without inheriting fractional columns', () => {
    const grid = new StripTimeGrid();
    grid.advance(0.013, 0.013, 512);
    grid.reset();
    expect(grid.advance(10.02, 0.02, 160)).toEqual([10.003125, 10.009375, 10.015625]);
  });
});
