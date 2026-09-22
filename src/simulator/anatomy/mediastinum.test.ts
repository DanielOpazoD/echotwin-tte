import { describe, expect, it } from 'vitest';
import { classifyThorax, createThoraxModel, mediastinumDistance } from './thoraxModel';
import { makeSample, Tissue } from './tissue';
import { loadCaseById } from '@/cases';

/**
 * The mediastinum around the heart (decision 150): beside the heart the lungs meet the pericardial fat pad; the
 * mediastinum proper is a rounded posterior column (oesophagus, descending aorta, front of the spine) and a superior one
 * around the great vessels that grows above the heart's base. Until then it was a slab 5 cm wide with flat faces at every
 * height, and its pleural faces crossed the parasternal and apical sectors as straight bright lines.
 */
describe('mediastinum', () => {
  it('holds the posterior column at every height and the superior one only above the base of the heart', () => {
    // behind the left atrium, at heart level and above it
    for (const y of [-4, 0, 4, 8]) expect(mediastinumDistance(-0.5, y, -15.5)).toBeLessThan(0);
    // beside the heart at its own level: no mediastinum, the lung reaches the pericardial fat pad
    for (const x of [-3.5, 2.5]) expect(mediastinumDistance(x, 0, -8)).toBeGreaterThan(0);
    // around the great vessels above the base
    expect(mediastinumDistance(-0.5, 6, -8)).toBeLessThan(0);
    expect(mediastinumDistance(-0.5, 0, -8)).toBeGreaterThan(0);
  });

  it('has curved faces: the width of each column changes with depth and the superior one with height', () => {
    const halfWidth = (y: number, z: number): number => {
      let x = -0.5;
      while (x < 6 && mediastinumDistance(x, y, z) < 0) x += 0.01;
      return x + 0.5;
    };
    const posterior = [-12.5, -14, -15.5, -17, -18.5].map((z) => halfWidth(0, z));
    // widest at the centre of the column, narrowing smoothly toward its front and back (a flat face keeps one width)
    expect(posterior[2]!).toBeGreaterThan(posterior[0]! + 0.5);
    expect(posterior[2]!).toBeGreaterThan(posterior[4]! + 0.5);
    const superior = [3, 4, 5, 6].map((y) => halfWidth(y, -8));
    for (let i = 1; i < superior.length; i++)
      expect(superior[i]!).toBeGreaterThan(superior[i - 1]!);
  });

  it('makes lung of a point beside the heart at its own level and keeps soft tissue behind the left atrium', () => {
    const c = loadCaseById('normal-excellent-window');
    const thorax = createThoraxModel(c.bodyHabitus, c.acousticWindow, {
      position: 'left-lateral',
      respiration: 'expiration',
      headElevationDeg: 0,
    });
    const s = makeSample();
    // 2 cm outside the pericardial sac, 8 cm deep, 1.5 cm left of the midline: inside the old slab (fat), lung now
    expect(classifyThorax(thorax, 1.5, 0, -8, s, 2)).toBe(true);
    expect(s.tissue).toBe(Tissue.Lung);
    // the oesophageal column behind the left atrium stays soft tissue
    expect(classifyThorax(thorax, -0.5, 0, -12, s, 1)).toBe(true);
    expect(s.tissue).toBe(Tissue.Fat);
    // within the pericardial fat pad it is never lung
    expect(classifyThorax(thorax, 1.5, 0, -8, s, 0.1)).toBe(true);
    expect(s.tissue).not.toBe(Tissue.Lung);
  });
});
