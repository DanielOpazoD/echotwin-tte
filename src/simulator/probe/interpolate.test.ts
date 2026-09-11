import { describe, expect, it } from 'vitest';
import { easeInOut, lerpControl, presetDurationMs, shortestArcDeg } from './interpolate';

const a = { u: 3, v: 0, rotationDeg: 170, tiltDeg: 0, rockDeg: 0, pressure: 0.5 };
const b = { u: 6, v: -4, rotationDeg: -170, tiltDeg: 30, rockDeg: -20, pressure: 0.6 };

describe('probe control interpolation (preset views move the probe continuously)', () => {
  it('endpoints are exact and the rotation takes the shortest arc through ±180', () => {
    expect(lerpControl(a, b, 0)).toEqual(a);
    const end = lerpControl(a, b, 1);
    expect(end.u).toBe(b.u);
    expect(((end.rotationDeg % 360) + 360) % 360).toBeCloseTo(190, 6);
    const mid = lerpControl(a, b, 0.5);
    expect(mid.rotationDeg).toBeCloseTo(180, 6); // 170 → 190 (= −170), not through 0
    expect(shortestArcDeg(170, -170)).toBe(20);
  });
  it('ease is monotonic with zero slope at both ends', () => {
    let prev = -1;
    for (let i = 0; i <= 20; i++) {
      const e = easeInOut(i / 20);
      expect(e).toBeGreaterThanOrEqual(prev);
      prev = e;
    }
    expect(easeInOut(0.05)).toBeLessThan(0.05);
    expect(easeInOut(0.95)).toBeGreaterThan(0.95);
  });
  it('duration grows with the manipulation and stays within bounds', () => {
    expect(presetDurationMs(a, a)).toBe(800);
    expect(presetDurationMs(a, b)).toBeGreaterThan(1500);
    expect(presetDurationMs(a, { ...b, u: 40, v: -40 })).toBe(3500);
  });
});
