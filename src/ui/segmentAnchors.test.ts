import { describe, expect, it } from 'vitest';
import { aha17Info } from '@/clinical/segmentation/catalog';
import type { RegionStat } from './cutMap';
import { imageUpOnPolarMap, rvInsertionPoints, SegmentAnchors } from './segmentAnchors';

/**
 * The places of the segment numbers and of the RV insertions on the image (decision 181): still while the layout holds,
 * the insertions at the outer end of the septal boundaries, and the rotation between a short-axis image and the polar map.
 */

/** A ring of myocardium on a 100×100 image, centred at (50, 50), radii 20–30 px, numbered like the map rotated. */
function ring(rotDeg: number, mirrored = false) {
  const w = 100;
  const lut = new Int32Array(w * w);
  const ids = new Uint8Array(w * w);
  for (let i = 0; i < lut.length; i++) {
    lut[i] = i; // one polar sample per pixel
    const x = i % w,
      y = (i / w) | 0;
    const r = Math.hypot(x - 50, y - 50);
    if (r < 20 || r > 30) continue;
    // image angle from up, counter-clockwise toward the screen left, as the map draws its segments
    let phi = (Math.atan2(-(x - 50), -(y - 50)) * 180) / Math.PI;
    if (mirrored) phi = -phi;
    const mapDeg = (((phi - rotDeg) % 360) + 360) % 360;
    // mid ring: 7 at 0° (±30°), 8 at 60°, …, 12 at 300°
    ids[i] = 7 + (Math.floor(((mapDeg + 30) % 360) / 60) % 6);
  }
  const stats: RegionStat[] = [];
  for (let id = 7; id <= 12; id++) {
    let n = 0,
      sx = 0,
      sy = 0;
    for (let i = 0; i < ids.length; i++)
      if (ids[i] === id) {
        n++;
        sx += i % w;
        sy += (i / w) | 0;
      }
    stats.push({ id, count: n, cx: sx / n, cy: sy / n, minY: 0, maxY: 99 });
  }
  return { lut, ids, stats, w };
}

/** The label of each segment at its centroid (the pixel of its region nearest to it is close enough here). */
const labelsOf = (stats: RegionStat[]) =>
  stats.map((s) => ({ id: s.id, text: String(s.id), x: s.cx, y: s.cy }));

describe('the RV insertions of a short-axis cut', () => {
  it('sit at the outer end of the boundaries 8|7 and 9|10, where the map puts them', () => {
    for (const rot of [0, 60, -45]) {
      const { lut, ids, stats, w } = ring(rot);
      const ins = rvInsertionPoints(lut, ids, w, stats)!;
      expect(ins).not.toBeNull();
      // on the map the anterior insertion (8|7) is at 30° and the inferior one (9|10) at 150°
      for (const [p, mapDeg] of [
        [ins.anterior, 30],
        [ins.inferior, 150],
      ] as const) {
        const r = Math.hypot(p.x - 50, p.y - 50);
        expect(r).toBeGreaterThan(28.5); // the epicardial end
        const phi = (Math.atan2(-(p.x - 50), -(p.y - 50)) * 180) / Math.PI;
        const off = ((((phi - rot - mapDeg + 180) % 360) + 360) % 360) - 180;
        expect(Math.abs(off)).toBeLessThan(5);
      }
    }
  });

  it('are not drawn on a cut without both septal boundaries', () => {
    const { lut, ids, stats, w } = ring(0);
    for (let i = 0; i < ids.length; i++) if (ids[i] === 10 || ids[i] === 9) ids[i] = 0;
    expect(rvInsertionPoints(lut, ids, w, stats)).toBeNull();
  });
});

describe('the top of a short-axis image on the polar map', () => {
  it('is the rotation of the numbers against the map: 0 when anterior is up, the anteroseptal wall at +60°', () => {
    expect(imageUpOnPolarMap(labelsOf(ring(0).stats))).toBeCloseTo(0, 0);
    // the image of the model's parasternal short axis: segment 8 at the top, the others rotated with it
    const up = imageUpOnPolarMap(labelsOf(ring(-60).stats))!;
    expect(up).toBeCloseTo(60, 0);
    expect(aha17Info(8)!.polarCentreDeg).toBe(60);
    expect(imageUpOnPolarMap(labelsOf(ring(45).stats))).toBeCloseTo(315, 0);
  });

  it('is unknown for a mirrored image or too few numbers of one ring', () => {
    expect(imageUpOnPolarMap(labelsOf(ring(0, true).stats))).toBeNull();
    expect(imageUpOnPolarMap(labelsOf(ring(0).stats).slice(0, 3))).toBeNull();
  });
});

describe('the numbers hold still', () => {
  const frame = (frameId: number, timeS: number, frozen = false) => ({
    frameId,
    timeS,
    rrS: 1,
    frozen,
  });
  const label = (id: number, x: number) => [{ id, text: String(id), x, y: 10 }];

  it('are the mean of one beat and then do not move while the layout holds', () => {
    const a = new SegmentAnchors();
    // the wall moves 10 px back and forth with the beat
    const xAt = (t: number) => 50 + 5 * Math.sin(2 * Math.PI * t);
    let t = 0,
      id = 0;
    for (; t < 1; t += 1 / 30) a.add('k', frame(id++, t), label(7, xAt(t)), null);
    expect(a.view().settled).toBe(false);
    a.add('k', frame(id++, 1.0), label(7, xAt(1)), null);
    const settled = a.view();
    expect(settled.settled).toBe(true);
    expect(settled.labels[0]!.x).toBeCloseTo(50, 0);
    // later beats change nothing, and the same frame drawn twice counts once
    for (t = 1; t < 3; t += 1 / 30) {
      expect(a.wants('k', id)).toBe(false);
      a.add('k', frame(id++, t), label(7, xAt(t) + 20), null);
    }
    expect(a.view().labels).toEqual(settled.labels);
  });

  it('start again when the probe, the geometry or the model changes, and settle at once on a still image', () => {
    const a = new SegmentAnchors();
    a.add('k', frame(1, 0), label(7, 10), null);
    a.add('k', frame(2, 2), label(7, 12), null);
    expect(a.view().labels[0]!.x).toBe(11);
    expect(a.wants('moved', 3)).toBe(true);
    a.add('moved', frame(3, 2.1), label(7, 40), null);
    expect(a.view().labels[0]!.x).toBe(40);
    const b = new SegmentAnchors();
    b.add('k', frame(1, 5, true), label(7, 30), null);
    expect(b.view().settled).toBe(true);
  });

  it('keep a number seen in at least half of the frames and drop one that flickers', () => {
    const a = new SegmentAnchors();
    for (let i = 0; i < 10; i++)
      a.add(
        'k',
        frame(i, i / 10),
        [...label(7, 10), ...(i < 3 ? label(13, 50) : []), ...(i < 6 ? label(12, 70) : [])],
        null,
      );
    expect(
      a
        .view()
        .labels.map((l) => l.id)
        .sort((x, y) => x - y),
    ).toEqual([7, 12]);
  });
});
