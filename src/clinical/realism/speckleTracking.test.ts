import { describe, expect, it } from 'vitest';
import {
  matchBlock,
  parabolicOffset,
  peakStrain,
  polylineLength,
  resamplePolyline,
  strainPercent,
  tissueDecorrelation,
  trackPoints,
  type GreyFrame,
} from './speckleTracking';
import { seededRandom } from './turing';

const W = 160,
  H = 260;
const rand = seededRandom(5);
/** Speckle-like texture: random-signed Gaussian blobs (cell 3 × 1.5 px), rectified. */
const blobs = Array.from({ length: 5000 }, () => ({
  x: rand() * W,
  y: rand() * H,
  a: rand() * 2 - 1,
}));
/** The texture with every blob moved by `map`. */
function frame(map: (x: number, y: number) => [number, number]): GreyFrame {
  const g = new Float32Array(W * H);
  for (const b of blobs) {
    const [bx, by] = map(b.x, b.y);
    for (let dy = -5; dy <= 5; dy++)
      for (let dx = -8; dx <= 8; dx++) {
        const xx = Math.round(bx) + dx,
          yy = Math.round(by) + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const ex = (xx - bx) / 3,
          ey = (yy - by) / 1.5;
        g[xx + yy * W]! += b.a * Math.exp(-(ex * ex + ey * ey) / 2);
      }
  }
  for (let i = 0; i < g.length; i++) g[i] = Math.abs(g[i]!) * 60;
  return { width: W, height: H, grey: g };
}

describe('block matching', () => {
  // the parabolic peak has a known bias of about a tenth of a pixel on a speckle peak this narrow
  it('recovers a sub-pixel translation within 0.2 px', () => {
    const a = frame((x, y) => [x, y]);
    const b = frame((x, y) => [x + 1.3, y - 2.6]);
    const m = matchBlock(a, b, 80, 130, { halfKernel: 7, search: 5 })!;
    expect(Math.abs(m.dx - 1.3)).toBeLessThan(0.2);
    expect(Math.abs(m.dy + 2.6)).toBeLessThan(0.2);
    expect(m.peak).toBeGreaterThan(0.9);
    expect(m.zeroShift).toBeLessThan(m.peak);
  });
  it('places a parabola vertex and refuses blocks off the frame', () => {
    expect(parabolicOffset(0.5, 1, 0.5)).toBeCloseTo(0, 12);
    expect(parabolicOffset(0.9, 1, 0.5)).toBeLessThan(0);
    expect(
      matchBlock(
        frame((x, y) => [x, y]),
        frame((x, y) => [x, y]),
        2,
        2,
        { halfKernel: 7, search: 3 },
      ),
    ).toBeNull();
  });
});

describe('strain of a tracked line', () => {
  it('recovers a uniform −20 % shortening along the line', () => {
    const n = 21;
    const frames = Array.from({ length: n }, (_, k) => {
      const s = 1 - (0.2 * k) / (n - 1);
      return frame((x, y) => [x, 30 + (y - 30) * s]);
    });
    const start = Array.from({ length: 18 }, (_, k) => ({ x: 80, y: 50 + 10 * k }));
    const t = trackPoints(frames, start, { halfKernel: 7, search: 4 });
    const lengths = t.positions.map((p) => polylineLength(p));
    const e = peakStrain(lengths);
    expect(e.strain).toBeGreaterThan(-23);
    expect(e.strain).toBeLessThan(-17);
    expect(e.frame).toBe(n - 1);
  });
  it('lengths, strain and resampling', () => {
    expect(
      polylineLength([
        { x: 0, y: 0 },
        { x: 3, y: 4 },
        { x: 3, y: 10 },
      ]),
    ).toBe(11);
    expect(
      polylineLength(
        [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        2,
        1,
      ),
    ).toBeCloseTo(Math.sqrt(5), 12);
    expect(strainPercent(10, 8)).toBe(-20);
    const r = resamplePolyline(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      5,
    );
    expect(r.map((p) => [p.x, p.y])).toEqual([
      [0, 0],
      [5, 0],
      [10, 0],
      [10, 5],
      [10, 10],
    ]);
  });
});

describe('tissueDecorrelation', () => {
  it('reads 1 between identical frames and less across a decorrelating one', () => {
    const a = frame((x, y) => [x, y]);
    const same = tissueDecorrelation([a, a], {
      halfKernel: 4,
      search: 2,
      points: 30,
      minGrey: 10,
      marginPx: 2,
      rand: seededRandom(1),
    });
    expect(same.peak).toBeCloseTo(1, 6);
    const other = { ...a, grey: frame((x, y) => [x * 1.7 + 13, y * 0.6 + 40]).grey };
    const diff = tissueDecorrelation([a, other], {
      halfKernel: 4,
      search: 2,
      points: 30,
      minGrey: 10,
      marginPx: 2,
      rand: seededRandom(1),
    });
    expect(diff.peak).toBeLessThan(0.8);
  });
});
