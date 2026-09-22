import { describe, expect, it } from 'vitest';
import {
  aha17Info,
  LV_18,
  LV_AHA17,
  polarPoint,
  RV_4CH_6,
  RV_FREE_WALL_3,
  segmentKey,
  VIEW_WALLS,
  WALL_MOTION_IDS,
} from './catalog';
import { getReference } from '@/clinical/guidelines/references';

/** The segmentation catalogues against the standards they cite (decision 152). */
describe('LV AHA 17-segment catalogue', () => {
  it('has 17 unique ids in order: six basal, six mid, four apical and the apex', () => {
    expect(LV_AHA17.map((s) => s.id)).toEqual(Array.from({ length: 17 }, (_, i) => i + 1));
    const levels = LV_AHA17.map((s) => s.level);
    expect(levels.filter((l) => l === 'basal')).toHaveLength(6);
    expect(levels.filter((l) => l === 'mid')).toHaveLength(6);
    expect(levels.filter((l) => l === 'apical')).toHaveLength(4);
    expect(levels.filter((l) => l === 'cap')).toHaveLength(1);
    expect(new Set(LV_AHA17.map((s) => s.snomed)).size).toBe(17);
    expect(new Set(LV_AHA17.map((s) => s.nameEn)).size).toBe(17);
  });

  it('names the walls in AHA order and carries the DICOM SNOMED codes', () => {
    const walls = [
      'anterior',
      'anteroseptal',
      'inferoseptal',
      'inferior',
      'inferolateral',
      'anterolateral',
    ];
    expect(LV_AHA17.slice(0, 6).map((s) => s.wall)).toEqual(walls);
    expect(LV_AHA17.slice(6, 12).map((s) => s.wall)).toEqual(walls);
    expect(LV_AHA17.slice(12, 16).map((s) => s.wall)).toEqual([
      'anterior',
      'septal',
      'inferior',
      'lateral',
    ]);
    expect(aha17Info(9)!.nameEn).toBe('Mid inferoseptal');
    expect(aha17Info(9)!.nameEs).toBe('Medio inferoseptal');
    expect(aha17Info(16)!.nameEn).toBe('Apical lateral');
    // DICOM PS3.16 CID 3782–3784 and 3717
    expect(aha17Info(1)!.snomed).toBe('264850008');
    expect(aha17Info(17)!.snomed).toBe('128564006');
    expect(aha17Info(0)).toBeNull();
    expect(aha17Info(18)).toBeNull();
  });

  it('scores 16 segments in wall motion: every one except the apex', () => {
    expect(WALL_MOTION_IDS).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
    expect(LV_AHA17.filter((s) => s.wallMotionEligible).map((s) => s.id)).toEqual([
      ...WALL_MOTION_IDS,
    ]);
  });

  it('draws the polar map with anterior up and the septum on the left, wedges covering the circle once', () => {
    for (const level of ['basal', 'mid', 'apical'] as const) {
      const ring = LV_AHA17.filter((s) => s.level === level);
      expect(ring.reduce((a, s) => a + s.polarWidthDeg!, 0)).toBe(360);
    }
    const [ax, ay] = polarPoint(0, 0, 1, aha17Info(1)!.polarCentreDeg!);
    expect(ax).toBeCloseTo(0, 9);
    expect(ay).toBeCloseTo(-1, 9); // up on screen
    const [sx] = polarPoint(0, 0, 1, aha17Info(14)!.polarCentreDeg!);
    expect(sx).toBeCloseTo(-1, 9); // septum on the left
    const [lx] = polarPoint(0, 0, 1, aha17Info(16)!.polarCentreDeg!);
    expect(lx).toBeCloseTo(1, 9); // lateral on the right
    const [, iy] = polarPoint(0, 0, 1, aha17Info(4)!.polarCentreDeg!);
    expect(iy).toBeCloseTo(1, 9); // inferior down
    expect(aha17Info(17)!.polarCentreDeg).toBeNull();
  });

  it('lists the walls of the reference views and keeps them consistent with each segment', () => {
    expect(VIEW_WALLS.a4c).toEqual([
      [3, 9, 14],
      [6, 12, 16],
    ]);
    expect(VIEW_WALLS.a2c).toEqual([
      [4, 10, 15],
      [1, 7, 13],
    ]);
    expect(VIEW_WALLS.a3c).toEqual([
      [2, 8, 14],
      [5, 11, 16],
    ]);
    for (const [view, walls] of Object.entries(VIEW_WALLS))
      for (const id of walls.flat())
        expect(aha17Info(id)!.canonicalViews, `${id} in ${view}`).toContain(view);
    // the PLAX does not show the true apex
    expect(VIEW_WALLS.plax.flat().some((id) => id >= 13)).toBe(false);
    for (const s of LV_AHA17.filter((x) => x.level === 'basal'))
      expect(s.canonicalViews).toContain('psax-mv');
    for (const s of LV_AHA17.filter((x) => x.level === 'mid'))
      expect(s.canonicalViews).toContain('psax-pm');
    for (const s of LV_AHA17.filter((x) => x.level === 'apical'))
      expect(s.canonicalViews).toContain('psax-apex');
  });
});

describe('sources', () => {
  it('cites references that are in the registry, with a verified record', () => {
    for (const id of [
      'aha-segmentation-2002',
      'ase-eacvi-chamber-2015',
      'eacvi-ase-ste-2015',
      'dicom-cid-3717',
      'ase-right-heart-2025',
      'ase-eacvi-strain-2025',
    ])
      expect(getReference(id).id).toBe(id);
    for (const id of ['aha-segmentation-2002', 'eacvi-ase-ste-2015', 'dicom-cid-3717'])
      expect(getReference(id).verification).toBe('verified-online');
  });
});

describe('separate schemes', () => {
  it('keeps the 18-segment topology and the RV schemes apart from the AHA ids', () => {
    expect(LV_18).toHaveLength(18);
    expect(LV_18.filter((s) => s.level === 'apical')).toHaveLength(6);
    expect(LV_18.map((s) => s.nameEn)).not.toContain('Apex / apical cap');
    expect(RV_FREE_WALL_3).toHaveLength(3);
    expect(RV_4CH_6).toHaveLength(6);
    expect(segmentKey('LV_AHA17', 9)).not.toBe(segmentKey('LV_16', 9));
    expect(segmentKey('RV_4CH_6', 'septal_mid')).toBe('RV_4CH_6:septal_mid');
  });
});
