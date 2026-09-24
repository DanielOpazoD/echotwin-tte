import { describe, expect, it } from 'vitest';
import type { SimOutput } from '@/simulator/core/protocol';
import type { SimStore } from '@/app/store';
import {
  cineOffsetAtX,
  cineOffsetOnEcg,
  ecgLayoutOf,
  ecgPoint,
  ecgTracePoints,
  ecgX,
  type EcgLayout,
} from './ecgTrace';

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
    // interleaved (time, amplitude) pairs, as the simulator sends them
    const ecg = Float64Array.of(6.5, 0, 8, 0.2, 9, 0.8, 10, 0.4);
    const pts = ecgTracePoints(ecg, layout);
    expect(pts).toHaveLength(3);
    expect(pts.map((p) => p.x)).toEqual([...pts.map((p) => p.x)].sort((a, b) => a - b));
    expect(pts[0]?.x).toBeCloseTo(ecgPoint({ t: 8, v: 0.2 }, layout)!.x);
  });
});

describe('the cine on the ECG strip (decision 190)', () => {
  const win = { startS: 8.5, endS: 10 };
  it('places a time on the strip and clamps what falls outside the window', () => {
    expect(ecgX(10, layout)).toBeCloseTo(92);
    expect(ecgX(8.5, layout)).toBeCloseTo(8 + 84 / 2);
    expect(ecgX(5, layout)).toBeCloseTo(8);
  });
  it('reads the nearest cine frame under a point, from the newest (0) to the oldest', () => {
    expect(cineOffsetAtX(ecgX(10, layout), layout, win, 96)).toBe(0);
    expect(cineOffsetAtX(ecgX(8.5, layout), layout, win, 96)).toBe(-95);
    expect(cineOffsetAtX(ecgX(9, layout), layout, win, 96)).toBe(-63); // two thirds of 95 frames back
    // beyond either end of the buffer the offset stays at its limit
    expect(cineOffsetAtX(8, layout, win, 96)).toBe(-95);
    expect(cineOffsetAtX(200, layout, win, 96)).toBe(0);
    // an empty or one-frame buffer has only the newest frame
    expect(cineOffsetAtX(50, layout, { startS: 10, endS: 10 }, 1)).toBe(0);
  });
});

describe('scrubbing the cine on the ECG strip (decision 190)', () => {
  const hud = {
    width: 800,
    height: 600,
    sector: { height: 600 },
    ecg: Float64Array.of(7, 0, 8, 0.5, 9, 0.2, 10, 0.1),
    ecgHead: 10,
    frozen: true,
    cineLength: 96,
    cineWindow: { startS: 8.5, endS: 10, frameS: 10 },
  } as unknown as SimOutput;
  const store = (
    over: Partial<Pick<SimStore, 'activeTool' | 'modality'>> & { reviewMode?: boolean },
  ) =>
    ({
      modality: over.modality ?? '2d',
      activeTool: over.activeTool ?? 'none',
      ui: { showEcg: true, reviewMode: over.reviewMode ?? false },
    }) as unknown as SimStore;
  const l = ecgLayoutOf(hud, '2d');
  const onStrip = { x: ecgX(9, l), y: l.y + l.height / 2 };

  it('lies along the bottom of the sector in 2D and of the whole display with a strip', () => {
    expect(l.y + l.height).toBe(600 - 6);
    expect(ecgLayoutOf({ ...hud, sector: { height: 400 } } as SimOutput, '2d').y).toBe(400 - 36);
    expect(ecgLayoutOf({ ...hud, sector: { height: 400 } } as SimOutput, 'pw').y).toBe(600 - 36);
  });
  it('picks the frame under a press on the strip of a frozen image', () => {
    expect(cineOffsetOnEcg(onStrip, hud, store({}))).toBe(-63);
  });
  it('leaves the press alone off the strip, live, with a tool armed or in review mode', () => {
    expect(cineOffsetOnEcg({ x: onStrip.x, y: l.y - 40 }, hud, store({}))).toBeNull();
    expect(cineOffsetOnEcg(onStrip, { ...hud, frozen: false }, store({}))).toBeNull();
    expect(cineOffsetOnEcg(onStrip, hud, store({ activeTool: 'caliper' }))).toBeNull();
    expect(cineOffsetOnEcg(onStrip, hud, store({ reviewMode: true }))).toBeNull();
  });
});
