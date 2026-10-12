// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ReportScreen } from './ReportScreen';
import { useSimStore } from '@/app/store';
import { correctedImpressionScore, examSummaryOf } from '@/app/examSummary';
import { expectedFindings, FINDINGS } from '@/education/impression';
import { computeGroundTruth } from '@/simulator/hemodynamics/groundTruth';
import { CASE_INPUTS, loadCaseById } from '@/cases';

/**
 * What an exam can be gamed with: a blank impression that lifted the total, a case the learner picked before its name was
 * hidden, a finish one click away, and a curriculum impression completed by copying the key «Corregir» revealed.
 */
const initialSim = useSimStore.getState();
const CASE = 'aortic-stenosis-severe';
const truth = computeGroundTruth(loadCaseById(CASE));
const expected = expectedFindings(truth);

beforeEach(() => {
  cleanup();
  useSimStore.setState(initialSim, true);
});
afterEach(() => vi.restoreAllMocks());

describe('the exam', () => {
  it('scores a blank impression as 0 of its 20 %, so leaving it blank never pays', () => {
    useSimStore.getState().setMode('exam', CASE);
    useSimStore.setState({ truth, viewProgress: { plax: 90, 'psax-av': 80, a5c: 80 } });
    const blank = examSummaryOf({ ...useSimStore.getState(), impressionSelection: [] })!;
    const wrong = examSummaryOf({
      ...useSimStore.getState(),
      impressionSelection: [FINDINGS.find((f) => !expected.includes(f.id))!.id],
    })!;
    expect(blank.impression).toBe(0);
    expect(blank.total).toBe(
      Math.round(blank.acquisition.total * 0.4 + blank.measurements.total * 0.4),
    );
    expect(blank.total).toBeLessThanOrEqual(wrong.total);
    expect(blank.mainErrors.join(' ')).toMatch(/no entregada/);
    // practice keeps grading the impression only when the learner asks for it
    useSimStore.getState().setMode('guided');
    expect(examSummaryOf({ ...useSimStore.getState(), truth })!.impression).toBeNull();
  });

  it('draws its case at random and records when it started', () => {
    const ids = new Set(CASE_INPUTS.map((c) => c.id));
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    useSimStore.setState({ caseId: 'normal-excellent-window' });
    useSimStore.getState().setMode('exam');
    const drawn = useSimStore.getState().caseId;
    expect(ids.has(drawn)).toBe(true);
    expect(drawn).toBe(CASE_INPUTS.at(-1)!.id);
    expect(useSimStore.getState().progress.events.at(-1)).toMatchObject({
      kind: 'exam-start',
      caseId: drawn,
    });
    // practice keeps the learner's case
    useSimStore.getState().loadCase('hocm-sam');
    useSimStore.getState().setMode('guided');
    expect(useSimStore.getState().caseId).toBe('hocm-sam');
  });

  it('asks before finishing, and names a blank impression', () => {
    useSimStore.getState().setMode('exam', CASE);
    useSimStore.setState({ truth });
    render(<ReportScreen />);
    fireEvent.click(screen.getByRole('button', { name: /Finalizar examen/ }));
    expect(useSimStore.getState().examFinished).toBe(false);
    expect(screen.getByRole('alertdialog').textContent).toMatch(/cuenta 0/);
    fireEvent.click(screen.getByRole('button', { name: 'Seguir con el examen' }));
    expect(useSimStore.getState().examFinished).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /Finalizar examen/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Sí, finalizar' }));
    expect(useSimStore.getState().examFinished).toBe(true);
  });
});

describe('the curriculum impression', () => {
  it('counts the first corrected attempt on a case, not one that copied the revealed key', () => {
    useSimStore.setState({ caseId: CASE, mode: 'guided', truth });
    const st = () => useSimStore.getState();
    // a poor first attempt
    st().toggleFinding(FINDINGS.find((f) => !expected.includes(f.id))!.id);
    st().checkImpression();
    const first = correctedImpressionScore(st());
    expect(first).not.toBeNull();
    expect(first!).toBeLessThan(70);
    // «Rehacer», then every finding the key revealed
    st().redoImpression();
    for (const f of expected) st().toggleFinding(f);
    st().checkImpression();
    expect(correctedImpressionScore(st())).toBe(first);
    // reloading the case does not reset it either
    st().loadCase(CASE);
    useSimStore.setState({ truth });
    for (const f of expected) st().toggleFinding(f);
    st().checkImpression();
    expect(correctedImpressionScore(st())).toBe(first);
    // a case never attempted counts its own first attempt
    st().loadCase('hocm-sam');
    const hocm = computeGroundTruth(loadCaseById('hocm-sam'));
    useSimStore.setState({ truth: hocm });
    for (const f of expectedFindings(hocm)) st().toggleFinding(f);
    st().checkImpression();
    expect(correctedImpressionScore(st())).toBe(100);
  });
});
