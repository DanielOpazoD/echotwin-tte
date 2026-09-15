import { describe, expect, it } from 'vitest';
import { computeSectorMapping } from '../renderer/scanConvert';
import { DEFAULT_ACQUISITION, polarSpecFor } from '../renderer/types';
import { reprojectGeometry } from './geometry';
import { discProfileFromContour, volumeFromProfileMl } from './simpson';

const spec = polarSpecFor(DEFAULT_ACQUISITION, 'medium');
const source = computeSectorMapping(spec, 640, 560, false);
const points = [
  { x: -1.5, y: 3.5 },
  { x: 0.5, y: 5 },
].map((p) => ({
  x: source.apexX + p.x * source.pxPerCm,
  y: source.apexY + p.y * source.pxPerCm,
}));

describe('measurement geometry calibration', () => {
  it.each([
    ['unchanged', 640, 560, false, 1],
    ['zoom', 640, 560, false, 2],
    ['inverted', 640, 560, true, 1],
    ['resized', 900, 660, false, 1],
    ['combined', 900, 660, true, 1.5],
  ] as const)('preserves physical points when %s', (_name, width, height, invert, zoom) => {
    const target = computeSectorMapping(spec, width, height, invert, zoom);
    const saved = structuredClone({ points, source, target });
    const projected = reprojectGeometry(points, source, target);
    for (let i = 0; i < points.length; i++) {
      const p = points[i]!;
      expect(projected[i]!.x).toBeCloseTo(
        target.apexX +
          ((p.x - source.apexX) / source.pxPerCm) *
            target.pxPerCm *
            (source.invertLR !== target.invertLR ? -1 : 1),
        10,
      );
      expect(projected[i]!.y).toBeCloseTo(
        target.apexY + ((p.y - source.apexY) / source.pxPerCm) * target.pxPerCm,
        10,
      );
    }
    expect(
      Math.hypot(projected[1]!.x - projected[0]!.x, projected[1]!.y - projected[0]!.y) /
        target.pxPerCm,
    ).toBeCloseTo(2.5, 10);
    expect({ points, source, target }).toEqual(saved);
    const roundTrip = reprojectGeometry(projected, target, source);
    for (let i = 0; i < points.length; i++) {
      expect(roundTrip[i]!.x).toBeCloseTo(points[i]!.x, 10);
      expect(roundTrip[i]!.y).toBeCloseTo(points[i]!.y, 10);
    }
  });

  it('keeps legacy and strip pixel coordinates without a sector calibration', () => {
    expect(reprojectGeometry(points, undefined, source)).toBe(points);
  });

  it('preserves the physical disc profile of a reprojected sector contour', () => {
    const contour = [
      { x: -1, y: 8 },
      { x: -2, y: 6 },
      { x: 0, y: 2 },
      { x: 2, y: 6 },
      { x: 1, y: 8 },
    ].map((p) => ({
      x: source.apexX + p.x * source.pxPerCm,
      y: source.apexY + p.y * source.pxPerCm,
    }));
    const target = computeSectorMapping(spec, 900, 660, true, 1.5);
    const before = discProfileFromContour(contour, source.pxPerCm);
    const after = discProfileFromContour(
      reprojectGeometry(contour, source, target),
      target.pxPerCm,
    );
    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    expect(after!.longAxisCm).toBeCloseTo(before!.longAxisCm, 10);
    for (let i = 0; i < before!.diametersCm.length; i++)
      expect(after!.diametersCm[i]).toBeCloseTo(before!.diametersCm[i]!, 10);
    expect(volumeFromProfileMl(after!)).toBeCloseTo(volumeFromProfileMl(before!), 10);
  });

  it('handles an empty drawing', () => {
    expect(reprojectGeometry([], source, source)).toEqual([]);
  });
});
