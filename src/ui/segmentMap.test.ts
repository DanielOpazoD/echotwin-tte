import { describe, expect, it } from 'vitest';
import { computeSectorMapping } from '@/simulator/renderer/scanConvert';
import { nearestSampleLut, placeLabels, type PolarGeometry } from './cutMap';
import { paintSegmentMap, SEGMENT_RGB, segmentIdOf, segmentIds, segmentNames } from './segmentMap';

/** Segment layer of the cut map (decision 152). */
describe('segment map', () => {
  it('reads the frame codes in the chosen model: the cap is 17 or the apical segment of its quadrant', () => {
    expect([1, 12, 16, 17, 18, 19, 20].map((c) => segmentIdOf(c, 'LV_AHA17'))).toEqual([
      1, 12, 16, 17, 17, 17, 17,
    ]);
    expect([1, 12, 16, 17, 18, 19, 20].map((c) => segmentIdOf(c, 'LV_16'))).toEqual([
      1, 12, 16, 13, 14, 15, 16,
    ]);
    expect(Array.from(segmentIds(Uint8Array.from([0, 3, 18]), 'LV_16'))).toEqual([0, 3, 14]);
    expect(segmentNames(14, 'LV_16').es).toMatch(/incluye el ápex/);
    expect(segmentNames(14, 'LV_AHA17').es).toBe('Apical septal');
  });

  it('gives each of the 17 segments its own colour, lighter from base to apex', () => {
    const keys = new Set(SEGMENT_RGB.slice(1).map((c) => c.join(',')));
    expect(keys.size).toBe(17);
    const lum = (id: number) => {
      const c = SEGMENT_RGB[id]!;
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    for (const [b, m] of [
      [1, 7],
      [4, 10],
    ])
      expect(lum(m!)).toBeGreaterThan(lum(b!));
  });

  it('paints the segments, outlines the selected one and numbers each region on its own pixels', () => {
    const polar: PolarGeometry = { lines: 64, samples: 128, sectorRad: Math.PI / 2, depthCm: 16 };
    const m = computeSectorMapping({ ...polar, elevationSamples: 1, focusCm: 8 }, 200, 200, false);
    const lut = nearestSampleLut(polar, m);
    const n = polar.lines * polar.samples;
    const structure = new Uint8Array(n);
    const ids = new Uint8Array(n);
    // segment 9 on the left lines, 12 on the right lines, 6–10 cm deep
    for (let l = 0; l < polar.lines; l++)
      for (let s = 48; s < 80; s++) ids[l * polar.samples + s] = l < 32 ? 9 : 12;
    const rgba = new Uint8ClampedArray(200 * 200 * 4);
    const stats = paintSegmentMap(rgba, lut, structure, ids, 200, 9);
    expect(stats.map((s) => s.id).sort((a, b) => a - b)).toEqual([9, 12]);
    // the selected segment keeps its colour or its white outline; the other one is faded
    const pixelOf = (id: number) => {
      for (let i = 0; i < lut.length; i++) {
        const k = lut[i]!;
        if (k >= 0 && ids[k] === id) {
          const x = i % 200,
            y = (i / 200) | 0;
          const inner = [lut[i - 1], lut[i + 1], lut[i - 200], lut[i + 200]].every(
            (q) => q !== undefined && q >= 0 && ids[q] === id,
          );
          if (inner && x > 2 && y > 2) return [rgba[i * 4]!, rgba[i * 4 + 1]!, rgba[i * 4 + 2]!];
        }
      }
      return null;
    };
    expect(pixelOf(9)).toEqual([...SEGMENT_RGB[9]!]);
    const faded = pixelOf(12)!;
    expect(faded).not.toEqual([...SEGMENT_RGB[12]!]);
    let outline = 0;
    for (let i = 0; i < lut.length; i++)
      if (rgba[i * 4] === 255 && rgba[i * 4 + 1] === 255 && rgba[i * 4 + 2] === 255) outline++;
    expect(outline).toBeGreaterThan(50);
    const labels = placeLabels(
      stats,
      lut,
      ids,
      200,
      10,
      () => ({ w: 10, h: 10 }),
      new Set(),
      (id) => String(id),
    );
    expect(labels.map((l) => l.text).sort()).toEqual(['12', '9']);
    for (const l of labels) {
      const k = lut[Math.round(l.y) * 200 + Math.round(l.x)]!;
      expect(ids[k]).toBe(Number(l.text));
    }
  });
});
