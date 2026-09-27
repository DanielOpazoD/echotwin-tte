// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ReportScreen } from './ReportScreen';
import { useSimStore } from '@/app/store';
import { loadCaseById } from '@/cases';
import { computeGroundTruth } from '@/simulator/hemodynamics/groundTruth';
import { expectedFindings } from '@/education/impression';
import type { Measurement } from '@/simulator/measurements/types';

/**
 * The teacher reads the exam in the learner's record; the learner reads it in the report. They were two computations: with
 * no impression marked the report weighed acquisition and measurements 50/50 and the record scored the empty impression
 * as 0 (40/40/20), 60 on the screen and 48 in the record (decision 236).
 */
const initialSim = useSimStore.getState();
const CASE = 'aortic-stenosis-severe';

beforeEach(() => {
  cleanup();
  localStorage.clear();
  useSimStore.setState(initialSim, true);
});

function protocol(measurementId: string, value: number): Measurement {
  return {
    id: measurementId,
    measurementId,
    kind: 'linear',
    label: measurementId,
    value,
    units: 'cm',
    modality: '2d',
    sourceViewId: 'plax',
    viewScore: 85,
    frameId: 1,
    phase: 0,
    timeS: 0,
    geometry: [],
    imageQualityScore: 90,
    userAssisted: false,
    referenceGuidelineIds: [],
    createdAt: '2026-09-27T00:00:00Z',
  };
}

function shownTotal(): number {
  const { container } = render(<ReportScreen />);
  const m = /Puntuación del examen: (\d+)\/100/.exec(container.textContent ?? '');
  expect(m).not.toBeNull();
  return Number(m![1]);
}

describe('the exam total the teacher reads is the one the learner saw (decision 236)', () => {
  for (const impression of [[], ['ef-normal']])
    it(`with ${impression.length ? 'an' : 'no'} impression marked`, () => {
      const truth = computeGroundTruth(loadCaseById(CASE));
      useSimStore.getState().setMode('exam');
      useSimStore.setState({
        caseId: CASE,
        truth,
        viewProgress: { plax: 85, a5c: 70 },
        measurements: [protocol('lvot-diameter', truth.lvot.diameterCm * 1.04)],
        impressionSelection: impression,
      });
      useSimStore.getState().finishExam();
      const recorded = useSimStore.getState().progress.events.at(-1);
      expect(recorded).toMatchObject({ kind: 'exam', caseId: CASE });
      expect(shownTotal()).toBe((recorded as { total: number }).total);
    });

  it('after finishing, ticking the revealed findings or measuring again changes neither (decision 236)', () => {
    const truth = computeGroundTruth(loadCaseById(CASE));
    useSimStore.getState().setMode('exam');
    useSimStore.setState({ caseId: CASE, truth, viewProgress: { plax: 85 } });
    useSimStore.getState().finishExam();
    const recorded = (useSimStore.getState().progress.events.at(-1) as { total: number }).total;
    // the report reveals the expected findings; ticking them all used to lift the report to 60 over a record of 19
    for (const f of expectedFindings(truth)) useSimStore.getState().toggleFinding(f);
    useSimStore.setState({
      measurements: [protocol('lvot-diameter', truth.lvot.diameterCm)],
    });
    expect(useSimStore.getState().impressionSelection).toEqual([]);
    expect(shownTotal()).toBe(recorded);
    const boxes = document.querySelectorAll<HTMLInputElement>(
      '.impression-form input[type="checkbox"]',
    );
    expect(boxes.length).toBeGreaterThan(0);
    expect([...boxes].every((b) => b.disabled)).toBe(true);
  });
});
