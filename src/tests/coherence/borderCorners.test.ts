// @tier slow
import { describe, expect, it } from 'vitest';
import { CASE_INPUTS } from '@/cases';
import { BORDERS, borderCorners } from './borderCorners';

/**
 * Corners of the anatomy's borders in the drawn planes (decision 382), a ratchet: for each view and border, the corners
 * of the twelve cases at end-diastole and mid-systole together may not grow by more than RISE (the noise of a border
 * moved by a decision elsewhere), and once they fall by more than FALL the declaration is lowered to the new count. The
 * printout of `tools/offline/review/border-corners.ts --where` says where each one lies.
 */
const VIEWS = ['a4c', 'a2c', 'plax', 'psax-mv', 'subcostal-4c'];
const PHASES = [0, 0.35];
const RISE = 2;
const FALL = 5;

/**
 * Declared, from the first measurement (decision 382): 2498 corners in 120 planes. The outer edge of the sac (775) is
 * the visceral surface pushed out by the fat, the pericardium and the effusion, and far from the walls it shows the
 * planes the atria are built from; the atria's blood (733 the left, with the mouths of its veins and its appendage; 574
 * the right, along its septal face and its venae cavae) is cut by those planes too. The left ventricle's profile has the
 * fewest (128), at the shoulders of its apical cap. A border with none is not declared. Decision 383: over the
 * tamponade's effusion the parietal layer is a smooth envelope, and the sac loses 45 (730).
 */
const KNOWN_BORDER_CORNERS: ReadonlyMap<string, number> = new Map([
  ['a4c sac', 173],
  ['a4c lv', 33],
  ['a4c rv', 33],
  ['a4c la', 214],
  ['a4c ra', 191],
  ['a2c sac', 166],
  ['a2c lv', 52],
  ['a2c rv', 10],
  ['a2c la', 162],
  ['a2c ra', 122],
  ['plax sac', 59],
  ['plax lv', 26],
  ['plax rv', 64],
  ['plax la', 115],
  ['psax-mv sac', 109],
  ['psax-mv lv', 4],
  ['psax-mv rv', 111],
  ['psax-mv la', 3],
  ['psax-mv ra', 53],
  ['subcostal-4c sac', 223],
  ['subcostal-4c lv', 13],
  ['subcostal-4c rv', 70],
  ['subcostal-4c la', 239],
  ['subcostal-4c ra', 208],
]);

describe('the borders of the drawn planes turn no sharper than declared (decision 382)', () => {
  for (const viewId of VIEWS)
    it(viewId, () => {
      const counts = new Map<string, number>();
      for (const { id } of CASE_INPUTS)
        for (const phase of PHASES)
          for (const c of borderCorners(id, viewId, phase)) {
            const key = `${viewId} ${c.border}`;
            counts.set(key, (counts.get(key) ?? 0) + 1);
          }
      const problems: string[] = [];
      for (const border of BORDERS) {
        const key = `${viewId} ${border}`;
        const n = counts.get(key) ?? 0,
          declared = KNOWN_BORDER_CORNERS.get(key) ?? 0;
        if (n > declared + RISE) problems.push(`${key}: ${n} corners against ${declared} declared`);
        if (n < declared - FALL)
          problems.push(`${key}: ${n} corners, lower the declaration from ${declared}`);
      }
      expect(problems).toEqual([]);
    });
});
