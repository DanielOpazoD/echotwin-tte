import { buildEducationalReport } from '@/education/report';
import type { Measurement } from '@/simulator/measurements/types';
import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { computeGroundTruth } from '@/simulator/hemodynamics/groundTruth';
import { annularRelaxationLimits, rangeFlag, rangeText } from './normalRanges';

describe('age-adjusted relaxation limits: ASE 2025 Table 6', () => {
  it('uses each published age band with strict lower bounds', () => {
    for (const [age, septal, lateral, average] of [
      [20, 7, 10, 9],
      [39, 7, 10, 9],
      [40, 6, 8, 7],
      [65, 6, 8, 7],
      [66, 6, 7, 6.5],
      [90, 6, 7, 6.5],
    ] as const) {
      expect(annularRelaxationLimits(age)).toEqual({ septal, lateral, average });
      expect(rangeFlag('e-prime-septal', 'male', septal, age)).toBe('normal');
      expect(rangeFlag('e-prime-septal', 'male', septal - 0.01, age)).toBe('low');
      expect(rangeFlag('e-prime-lateral', 'female', lateral, age)).toBe('normal');
      expect(rangeFlag('e-prime-lateral', 'female', lateral - 0.01, age)).toBe('low');
    }
  });
  it('does not silently apply young-adult limits to older cases or missing age', () => {
    const t = computeGroundTruth(loadCaseById('aortic-stenosis-moderate'));
    expect(t.ageYears).toBe(70);
    expect(rangeFlag('e-prime-lateral', t.sex, t.mitral.ePrimeLateralCmps, t.ageYears)).toBe(
      'normal',
    );
    const m: Measurement = {
      id: 'age-regression',
      sourceViewId: 'a4c',
      measurementId: 'e-prime-lateral',
      value: 8,
      units: 'cm/s',
      kind: 'velocity',
      label: 'e′ lateral',
      modality: 'tdi',
      geometry: [],
      referenceGuidelineIds: [],
      phase: 0,
      timeS: 0,
      frameId: 1,
      viewScore: 90,
      imageQualityScore: 90,
      userAssisted: false,
      createdAt: '2026-10-04T00:00:00Z',
    };
    const row = buildEducationalReport([m], t, false).rows[0]!;
    expect(row.range).toBe('≥ 7');
    expect(row.rangeFlag).toBe('normal');
    expect(rangeText('e-prime-lateral', t.sex, t.ageYears)).toBe('≥ 7');
    expect(rangeText('e-prime-lateral', t.sex, 32)).toBe('≥ 10');
    expect(annularRelaxationLimits()).toEqual({ septal: 6, lateral: 7, average: 6.5 });
  });
});
