// @tier slow
import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { buildCaseModels, REST_PATIENT } from './caseModels';
import { classifyHeart, computeHeartPose } from './heartModel';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { makeSample, Structure } from './tissue';
import { measureModel } from './measureModel';

// Independent full-classifier integration, with a larger domain and 20 times the
// normalization quadrature. Includes annular continuity, excludes appendage/PV.
function radicalInverse(i: number, base: number): number {
  let fraction = 1,
    value = 0;
  while (i > 0) {
    fraction /= base;
    value += fraction * (i % base);
    i = Math.floor(i / base);
  }
  return value;
}

describe('declared atrial volume survives changes of nominal annular excursion', () => {
  for (const mapseCm of [0.4, 0.6, 1.4]) {
    it(`HFrEF atrium at MAPSE ${mapseCm} cm`, () => {
      const c = structuredClone(loadCaseById('hfref-severe-mr'));
      c.physiology.mapseCm = mapseCm;
      const { heart, tables } = buildCaseModels(c, REST_PATIENT);
      const hp = computeHeartPose(heart, cycleStateAt(tables, tables.endSystoleS / tables.rrS));
      const sample = makeSample();
      const n = 160000;
      let inside = 0;
      for (let i = 1; i <= n; i++) {
        const x = -4 + 10 * radicalInverse(i, 2);
        const y = -7 + 11 * radicalInverse(i, 3);
        const z = -7 + 10 * radicalInverse(i, 5);
        if (classifyHeart(heart, hp, x, y, z, sample) && sample.structure === Structure.LaCavity)
          inside++;
      }
      const volumeMl = (inside * 1100) / n;
      expect(Math.abs(volumeMl / c.anatomy.la.volumeMl - 1)).toBeLessThan(0.05);
    });
  }
});

it('radial akinesia does not move the ventricular basal plane into the atrium', () => {
  const c = loadCaseById('inferior-rwma');
  const { heart, tables } = buildCaseModels(c, REST_PATIENT);
  const hp = computeHeartPose(heart, cycleStateAt(tables, tables.endSystoleS / tables.rrS));
  const sample = makeSample();
  // Blood 2–3 mm basal to the annular plane was labelled LV after subtracting
  // radial deformation from an already clipped SDF. Its anatomy belongs to LA.
  for (const [x, y, distance] of [
    [-0.22, -0.41, 0.318],
    [-0.014, -1.39, 0.256],
    [-0.571, -0.9, 0.218],
  ]) {
    expect(classifyHeart(heart, hp, x!, y!, hp.zAnn - distance!, sample)).toBe(true);
    expect(sample.structure).toBe(Structure.LaCavity);
  }
});

it('declared AP dimension changes the measured shape while preserving the same maximal volume', () => {
  const measured: number[] = [];
  for (const apDiameterCm of [4.2, 4.5, 4.8]) {
    const c = structuredClone(loadCaseById('mvp-primary-mr'));
    c.anatomy.la.apDiameterCm = apDiameterCm;
    const m = measureModel(c, undefined, 90000);
    const ap = m.rows.find((r) => r.id === 'la-ap')!.value;
    const volume = m.rows.find((r) => r.id === 'lavi')!.value * m.bsaM2;
    expect(Math.abs(ap / apDiameterCm - 1)).toBeLessThan(0.1);
    expect(Math.abs(volume / c.anatomy.la.volumeMl - 1)).toBeLessThan(0.05);
    measured.push(ap);
  }
  expect(measured[2]! - measured[0]!).toBeGreaterThan(0.4);
});
