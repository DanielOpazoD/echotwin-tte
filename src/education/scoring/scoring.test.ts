import { describe, expect, it } from 'vitest';
import { buildExamSummary, scoreAcquisition, scoreMeasurements } from './scoring';
import { loadCaseById } from '@/cases';
import { modePolicy } from '@/app/modePolicy';
import { computeGroundTruth } from '@/simulator/hemodynamics/groundTruth';
import type { Measurement } from '@/simulator/measurements/types';

const c = loadCaseById('normal-excellent-window');
const truth = computeGroundTruth(c);
const m = (over: Partial<Measurement>): Measurement => ({
  id: 'x',
  kind: 'linear',
  label: 'Distancia',
  value: 1,
  units: 'cm',
  modality: '2d',
  sourceViewId: 'plax',
  viewScore: 80,
  frameId: 1,
  phase: 0.1,
  timeS: 1,
  geometry: [],
  imageQualityScore: 90,
  userAssisted: false,
  referenceGuidelineIds: [],
  createdAt: '2026-09-10T00:00:00Z',
  ...over,
});

describe('scoring (spec 28)', () => {
  it('acquisition score is 100 when all required views reach their threshold, partial otherwise', () => {
    const full = scoreAcquisition(c, { plax: 90, 'psax-mv': 70, 'psax-pm': 80, a4c: 85 });
    expect(full.total).toBe(100);
    const half = scoreAcquisition(c, { plax: 90, a4c: 35 });
    expect(half.total).toBeLessThan(70);
    expect(half.perView.find((v) => v.viewId === 'a4c')?.ok).toBe(false);
  });
  it('a correct number measured on a bad view is penalised as technically invalid', () => {
    const good = scoreMeasurements(c, truth, [
      m({ kind: 'linear', value: truth.lvot.diameterCm * 1.03, viewScore: 80 }),
    ]);
    const bad = scoreMeasurements(c, truth, [
      m({ kind: 'linear', value: truth.lvot.diameterCm * 1.03, viewScore: 20 }),
    ]);
    const rowGood = good.rows.find((r) => r.measurementId === 'lvot-diameter')!;
    const rowBad = bad.rows.find((r) => r.measurementId === 'lvot-diameter')!;
    expect(rowGood.points).toBe(100);
    expect(rowBad.technicallyValid).toBe(false);
    expect(rowBad.points).toBeLessThan(50);
  });
  it('errors beyond tolerance lose points progressively and missing measurements score 0', () => {
    const r = scoreMeasurements(c, truth, [
      m({ kind: 'vti', value: truth.lvot.vtiCm * 1.4, units: 'cm', modality: 'pw' }),
    ]);
    const vti = r.rows.find((x) => x.measurementId === 'lvot-vti')!;
    expect(vti.points).toBeLessThan(100);
    expect(vti.points).toBeGreaterThan(0);
    expect(r.rows.find((x) => x.measurementId === 'mitral-e')!.points).toBe(0);
  });
  it('a volley of free measurements scores nothing in exam; the protocol list still does (decision 235)', () => {
    const as = loadCaseById('aortic-stenosis-severe');
    const asTruth = computeGroundTruth(as);
    // 40 values of each kind spread geometrically over 0.1–100: one lands within 10 % of any true value
    const volley: Measurement[] = [];
    for (const kind of ['linear', 'vti', 'velocity'] as const)
      for (let i = 0; i < 40; i++)
        volley.push(m({ id: `${kind}-${i}`, kind, value: 0.1 * 1000 ** (i / 39) }));
    const practice = modePolicy('sandbox').freeMeasurementsScored;
    const exam = modePolicy('exam').freeMeasurementsScored;
    // outside the exam the closest free value stands for each required one: the volley passes
    expect(scoreMeasurements(as, asTruth, volley, { freeMeasurements: practice }).total).toBe(100);
    // in the exam only a measurement chosen from the protocol list counts
    const inExam = scoreMeasurements(as, asTruth, volley, { freeMeasurements: exam });
    expect(inExam.total).toBe(0);
    expect(inExam.rows.every((r) => r.measured === null)).toBe(true);
    const chosen = scoreMeasurements(
      as,
      asTruth,
      [
        ...volley,
        m({ kind: 'linear', value: asTruth.lvot.diameterCm, measurementId: 'lvot-diameter' }),
      ],
      { freeMeasurements: exam },
    );
    expect(chosen.rows.find((r) => r.measurementId === 'lvot-diameter')!.points).toBe(100);
    expect(chosen.rows.find((r) => r.measurementId === 'av-vmax')!.measured).toBeNull();
  });
  it('exam summary is reproducible and lists omissions and recommendations', () => {
    const a = buildExamSummary(c, truth, { plax: 88 }, []);
    const b = buildExamSummary(c, truth, { plax: 88 }, []);
    expect(a).toEqual(b);
    expect(a.omittedViews).toContain('a4c');
    expect(a.recommendations.length).toBeGreaterThan(0);
    expect(a.total).toBeLessThan(60);
  });
});
