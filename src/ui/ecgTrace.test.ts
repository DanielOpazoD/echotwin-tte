import { describe, expect, it } from 'vitest';
import { ecgPoint, ecgTracePoints, type EcgLayout } from './ecgTrace';

const layout: EcgLayout = { x0: 8, width: 84, y: 100, height: 34, spanS: 3, headS: 10 };

describe('ecgTrace', () => {
  it('drops samples older than headS - spanS and keeps the boundary sample', () => {
    expect(ecgPoint({ t: 6.99, v: 0.5 }, layout)).toBeNull();
    expect(ecgPoint({ t: 7, v: 0.5 }, layout)).not.toBeNull();
  });

  it('maps the window edges to the trace edges', () => {
    expect(ecgPoint({ t: 10, v: 0 }, layout)?.x).toBeCloseTo(8 + 84);
    expect(ecgPoint({ t: 7, v: 0 }, layout)?.x).toBeCloseTo(8);
  });

  it('maps v into the strip with the fixed paddings', () => {
    expect(ecgPoint({ t: 8, v: 0 }, layout)?.y).toBeCloseTo(100 + 34 - 6);
    expect(ecgPoint({ t: 8, v: 1 }, layout)?.y).toBeCloseTo(100 + 34 - 6 - (34 - 10));
  });

  it('returns points in input order, skipping dropped samples', () => {
    const ecg = [
      { t: 6.5, v: 0 },
      { t: 8, v: 0.2 },
      { t: 9, v: 0.8 },
      { t: 10, v: 0.4 },
    ];
    const pts = ecgTracePoints(ecg, layout);
    expect(pts).toHaveLength(3);
    expect(pts.map((p) => p.x)).toEqual([...pts.map((p) => p.x)].sort((a, b) => a - b));
    expect(pts[0]?.x).toBeCloseTo(ecgPoint({ t: 8, v: 0.2 }, layout)!.x);
  });
});
