// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ReportScreen } from './ReportScreen';
import { useSimStore } from '@/app/store';
import { correctedImpressionScore, examSummaryOf } from '@/app/examSummary';
import { expectedFindings, FINDINGS } from '@/education/impression';
import { computeGroundTruth } from '@/simulator/hemodynamics/groundTruth';
import { loadCaseById } from '@/cases';

/**
 * The impression does not give the answers away before «Corregir» (decision 257). In practice the report coloured every
 * finding right, wrong or missed as soon as one was ticked, printed the score, and listed the model's own impression
 * («Criterios hemodinámicos de estenosis aórtica severa…») under the sheet: the learner could read the answer, or toggle
 * findings until the score reached 100 and the curriculum task completed.
 */
const initialSim = useSimStore.getState();
const CASE = 'aortic-stenosis-severe';
const truth = computeGroundTruth(loadCaseById(CASE));
const expected = expectedFindings(truth);
const notExpected = FINDINGS.map((f) => f.id).filter((id) => !expected.includes(id));

beforeEach(() => {
  cleanup();
  useSimStore.setState(initialSim, true);
  useSimStore.setState({ caseId: CASE, mode: 'guided', truth });
});

/** Everything the label of a finding says about it, but its own id and text. */
const looks = (c: HTMLElement, id: string) => {
  const label = c.querySelector(`[data-finding="${id}"]`) as HTMLElement;
  return {
    cls: label.className,
    disabled: (label.querySelector('input') as HTMLInputElement).disabled,
  };
};

describe('the impression before «Corregir»', () => {
  it('a right finding, a wrong one and a missed one look the same, and nothing scores them', () => {
    const toggle = useSimStore.getState().toggleFinding;
    toggle(expected[0]!); // right
    toggle(notExpected.find((id) => id !== 'normal-study')!); // wrong
    const { container } = render(<ReportScreen />);
    const ticked = [expected[0]!, notExpected.find((id) => id !== 'normal-study')!];
    const shapes = new Set(
      [...ticked, expected[1]!, notExpected[0]!].map((id) => JSON.stringify(looks(container, id))),
    );
    expect(shapes.size, 'right, wrong, missed and neutral findings look alike').toBe(1);
    expect(container.querySelector('[data-impression-result]')).toBeNull();
    expect(container.querySelector('.impression-form')?.getAttribute('data-impression-score')).toBe(
      '',
    );
    // the answer key stays folded: the model's impression and its summary
    expect(container.querySelector('[data-model-impression]')).toBeNull();
    expect(container.textContent).not.toContain('Resumen del modelo');
    expect(container.textContent).not.toMatch(/estenosis aórtica severa \(Vmax/i);
    // the progress score leaves the impression out, and the curriculum sees no score
    expect(examSummaryOf(useSimStore.getState())?.impression).toBeNull();
    expect(correctedImpressionScore(useSimStore.getState())).toBeNull();
  });

  it('«Corregir» needs a finding, then shows the colours, the score and the model, and closes the sheet', () => {
    const { container, rerender } = render(<ReportScreen />);
    expect(screen.getByRole('button', { name: 'Corregir' })).toHaveProperty('disabled', true);
    for (const id of expected) useSimStore.getState().toggleFinding(id);
    rerender(<ReportScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Corregir' }));
    rerender(<ReportScreen />);
    expect(container.querySelector('[data-impression-result]')?.textContent).toContain('100/100');
    expect(looks(container, expected[0]!).cls).toContain('ok');
    expect(container.querySelector('[data-model-impression]')?.textContent).toMatch(
      /estenosis aórtica severa/i,
    );
    expect(container.textContent).toContain('Resumen del modelo');
    expect(examSummaryOf(useSimStore.getState())?.impression).toBe(100);
    expect(correctedImpressionScore(useSimStore.getState())).toBe(100);
    // closed: a finding cannot be changed after seeing the answer
    expect(looks(container, expected[0]!).disabled).toBe(true);
    useSimStore.getState().toggleFinding(expected[0]!);
    expect(useSimStore.getState().impressionSelection).toEqual(expected);
  });

  it('«Rehacer» starts an empty sheet, not corrected', () => {
    useSimStore.getState().toggleFinding(expected[0]!);
    useSimStore.getState().checkImpression();
    render(<ReportScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Rehacer' }));
    const s = useSimStore.getState();
    expect(s.impressionSelection).toEqual([]);
    expect(s.impressionChecked).toBe(false);
  });

  it('the exam has no «Corregir»: finishing it is the correction', () => {
    useSimStore.setState({ mode: 'exam', examFinished: false });
    useSimStore.getState().toggleFinding(expected[0]!);
    useSimStore.getState().checkImpression();
    expect(useSimStore.getState().impressionChecked).toBe(false);
    render(<ReportScreen />);
    expect(screen.queryByRole('button', { name: 'Corregir' })).toBeNull();
    expect(correctedImpressionScore(useSimStore.getState())).toBeNull();
    useSimStore.setState({ examFinished: true });
    expect(correctedImpressionScore(useSimStore.getState())).not.toBeNull();
  });
});
