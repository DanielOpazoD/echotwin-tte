import { describe, expect, it } from 'vitest';

import { Structure } from '@/simulator/anatomy/tissue';
import { computeSectorMapping } from '@/simulator/renderer/scanConvert';
import {
  nearestSampleLut,
  paintCutMap,
  placeLabels,
  type PolarGeometry,
  withoutOverlaps,
  CUT_MAP_RGB,
  ACCENT_RGB,
  paintStructureOutline,
} from './cutMap';

const polar: PolarGeometry = { lines: 64, samples: 128, sectorRad: Math.PI / 2, depthCm: 16 };
const spec = { ...polar, elevationSamples: 1, focusCm: 8 };

describe('cut map: nearest-sample lookup', () => {
  it('maps the beam axis to the middle line and the depth to the sample, and mirrors with invertLR', () => {
    const m = computeSectorMapping(spec, 200, 200, false);
    const lut = nearestSampleLut(polar, m);
    // a point straight below the apex, 8 cm deep
    const x = Math.floor(m.apexX),
      y = Math.floor(m.apexY + 8 * m.pxPerCm);
    const k = lut[y * m.width + x]!;
    expect(Math.floor(k / polar.samples)).toBeCloseTo(polar.lines / 2, -1);
    expect(k % polar.samples).toBeCloseTo(polar.samples / 2, -1);
    // above the apex and beyond the sector's edge there is nothing
    expect(lut[0]).toBe(-1);
    expect(lut[Math.floor(m.apexY + 2) * m.width]).toBe(-1);
    // a point to the screen-right is a late line normally and an early one when the image is mirrored
    const xr = Math.floor(m.apexX + 4 * m.pxPerCm),
      yr = Math.floor(m.apexY + 8 * m.pxPerCm);
    const lineRight = Math.floor(lut[yr * m.width + xr]! / polar.samples);
    const mirrored = nearestSampleLut(polar, computeSectorMapping(spec, 200, 200, true));
    const lineRightMirrored = Math.floor(mirrored[yr * m.width + xr]! / polar.samples);
    expect(lineRight).toBeGreaterThan(polar.lines / 2);
    expect(lineRightMirrored).toBeLessThan(polar.lines / 2);
    expect(lineRight + lineRightMirrored).toBeCloseTo(polar.lines - 1, -1);
  });
});

describe('cut map: painting and labels', () => {
  const m = computeSectorMapping(spec, 240, 240, false);
  const lut = nearestSampleLut(polar, m);
  // left half of the sector: LV cavity; right half: RV cavity; a thin ring of septum around 8 cm on the left
  const structure = new Uint8Array(polar.lines * polar.samples);
  for (let l = 0; l < polar.lines; l++)
    for (let s = 0; s < polar.samples; s++) {
      const depth = (s / polar.samples) * polar.depthCm;
      let id: Structure = l < polar.lines / 2 ? Structure.LvCavity : Structure.RvCavity;
      if (l < polar.lines / 2 && Math.abs(depth - 8) < 0.4) id = Structure.LvWallSeptal;
      structure[l * polar.samples + s] = id;
    }

  it('paints each sample with its structure colour and leaves the outside transparent', () => {
    const rgba = new Uint8ClampedArray(m.width * m.height * 4);
    const stats = paintCutMap(rgba, lut, structure, m.width);
    const at = (x: number, y: number) =>
      Array.from(rgba.subarray((y * m.width + x) * 4, (y * m.width + x) * 4 + 4));
    const yMid = Math.floor(m.apexY + 12 * m.pxPerCm);
    expect(at(Math.floor(m.apexX - 3 * m.pxPerCm), yMid)).toEqual([
      ...CUT_MAP_RGB[Structure.LvCavity]!,
      255,
    ]);
    expect(at(Math.floor(m.apexX + 3 * m.pxPerCm), yMid)).toEqual([
      ...CUT_MAP_RGB[Structure.RvCavity]!,
      255,
    ]);
    expect(at(0, 0)[3]).toBe(0);
    const ids = stats.map((s) => s.id).sort();
    expect(ids).toEqual([Structure.LvCavity, Structure.LvWallSeptal, Structure.RvCavity].sort());
    const lv = stats.find((s) => s.id === Structure.LvCavity)!;
    const rv = stats.find((s) => s.id === Structure.RvCavity)!;
    expect(lv.cx).toBeLessThan(m.apexX);
    expect(rv.cx).toBeGreaterThan(m.apexX);
  });

  it('puts every label on a pixel of its own region, largest first, without overlaps', () => {
    const rgba = new Uint8ClampedArray(m.width * m.height * 4);
    const stats = paintCutMap(rgba, lut, structure, m.width);
    const labels = placeLabels(stats, lut, structure, m.width, 40, (t) => ({
      w: t.length * 7,
      h: 12,
    }));
    expect(labels.map((l) => l.text)).toContain('VI');
    expect(labels.map((l) => l.text)).toContain('VD');
    for (const l of labels) {
      const k = lut[Math.round(l.y) * m.width + Math.round(l.x)]!;
      expect(k).toBeGreaterThanOrEqual(0);
      expect(structure[k]).toBe(l.id);
    }
    // the septum is a thin arc: its centroid lies in the LV cavity, its label does not
    const septum = labels.find((l) => l.id === Structure.LvWallSeptal);
    expect(septum).toBeDefined();
    // a region smaller than the threshold gets no label
    expect(placeLabels(stats, lut, structure, m.width, 1e9, () => ({ w: 10, h: 12 }))).toEqual([]);
  });
});

describe('cut map: labels once averaged over a beat (decision 188)', () => {
  it('drops a label that would cover one kept before it, keeps the ones that do not touch', () => {
    const measure = (t: string) => ({ w: t.length * 6, h: 12 });
    const kept = withoutOverlaps(
      [
        { text: 'VI', x: 50, y: 50 },
        { text: 'pared inferior e inferolateral', x: 60, y: 52 },
        { text: 'Ao', x: 200, y: 50 },
        { text: 'AI', x: 50, y: 80 },
      ],
      measure,
    );
    expect(kept.map((l) => l.text)).toEqual(['VI', 'Ao', 'AI']);
  });
});

describe('cut map: outlines and the structure under the pointer (decision 202)', () => {
  const m = { apexX: 40, apexY: 2, pxPerCm: 3, width: 80, height: 60, invertLR: false };
  const polar = { lines: 40, samples: 40, sectorRad: 1.4, depthCm: 16 };
  const lut = nearestSampleLut(polar, m as never);
  const structure = new Uint8Array(polar.lines * polar.samples);
  for (let l = 0; l < polar.lines; l++)
    for (let s = 0; s < polar.samples; s++)
      structure[l * polar.samples + s] =
        l < polar.lines / 2 ? Structure.LvCavity : Structure.RvCavity;
  const at = (rgba: Uint8ClampedArray, x: number, y: number) =>
    Array.from(rgba.subarray((y * m.width + x) * 4, (y * m.width + x) * 4 + 4));
  const y = 40;
  // the LV/RV boundary runs down the middle: the last LV pixel of the row is the outline
  const xEdge = (rgba: Uint8ClampedArray): number => {
    let x = 0;
    while (x < m.width - 1 && at(rgba, x + 1, y)[3] === 0) x++;
    while (x < m.width - 1 && at(rgba, x, y)[0] !== at(rgba, x + 1, y)[0]) x++;
    return Math.floor(m.apexX) - 1;
  };

  it('darkens the pixels on the boundary between two structures', () => {
    const rgba = new Uint8ClampedArray(m.width * m.height * 4);
    paintCutMap(rgba, lut, structure, m.width);
    const lv = CUT_MAP_RGB[Structure.LvCavity]!;
    const inside = at(rgba, Math.floor(m.apexX) - 6, y);
    const edge = at(rgba, xEdge(rgba), y);
    expect(inside.slice(0, 3)).toEqual([...lv]);
    expect(edge[0]! + edge[1]! + edge[2]!).toBeLessThan(inside[0]! + inside[1]! + inside[2]!);
  });

  it('lights the hovered structure and gives its outline the accent', () => {
    const rgba = new Uint8ClampedArray(m.width * m.height * 4);
    paintCutMap(rgba, lut, structure, m.width, Structure.LvCavity);
    const lv = CUT_MAP_RGB[Structure.LvCavity]!;
    const inside = at(rgba, Math.floor(m.apexX) - 6, y);
    expect(inside[0]! + inside[1]! + inside[2]!).toBeGreaterThan(lv[0] + lv[1] + lv[2]);
    expect(at(rgba, xEdge(rgba), y).slice(0, 3)).toEqual([...ACCENT_RGB]);
    // the other structure keeps its colour
    expect(at(rgba, Math.floor(m.apexX) + 6, y).slice(0, 3)).toEqual([
      ...CUT_MAP_RGB[Structure.RvCavity]!,
    ]);
  });

  it('paints only the outline of one structure on a transparent layer for the image', () => {
    const rgba = new Uint8ClampedArray(m.width * m.height * 4);
    const drawn = paintStructureOutline(rgba, lut, structure, m.width, Structure.RvCavity);
    expect(drawn).toBeGreaterThan(10);
    expect(at(rgba, Math.floor(m.apexX) + 6, y)[3]).toBe(0); // inside the RV: nothing
    expect(at(rgba, Math.floor(m.apexX) - 6, y)[3]).toBe(0); // inside the LV: nothing
    expect(at(rgba, Math.floor(m.apexX), y)).toEqual([...ACCENT_RGB, 235]); // the boundary
  });
});
