// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { CurriculumScreen } from './CurriculumScreen';
import { ConsolePanel } from './ConsolePanel';
import { caseBrief } from './CaseCard';
import { useSimStore } from '@/app/store';
import { allTasks } from '@/education/curriculum';
import { CASE_INPUTS } from '@/cases';
import type { Measurement } from '@/simulator/measurements/types';

/**
 * The case card and «Abrir tarea» (decision 248): the learner reads the history of the patient on the simulator, and a
 * curriculum task opens in its case with its view as the target, instead of leaving the learner on the case alone.
 */
const initialSim = useSimStore.getState();

beforeEach(() => {
  cleanup();
  localStorage.clear();
  useSimStore.setState(initialSim, true);
});

describe('«Abrir tarea»', () => {
  it('every task with a case or a view has the button, and none of the old «Abrir caso» ones is left', () => {
    const { container } = render(<CurriculumScreen />);
    const withTarget = allTasks().filter((t) => t.caseId || t.viewId);
    expect(withTarget.length).toBeGreaterThan(20);
    for (const t of withTarget) {
      const b = container.querySelector(`[data-open-task="${t.id}"]`);
      expect(b?.textContent, t.id).toBe('Abrir tarea');
    }
    expect(container.textContent).not.toContain('Abrir caso');
  });

  it('opens the task in its case, in the guided mode, with its view as the target and the guide open', () => {
    useSimStore.setState({ caseId: 'hfref-severe-mr', mode: 'sandbox' });
    useSimStore.getState().setUi({ screen: 'curriculum', guidanceOpen: false });
    const { container } = render(<CurriculumScreen />);
    fireEvent.click(container.querySelector('[data-open-task="a2c-55"]')!);
    const s = useSimStore.getState();
    expect(s.caseId).toBe('normal-excellent-window');
    expect(s.mode).toBe('guided');
    expect(s.targetViewId).toBe('a2c');
    expect(s.ui.screen).toBe('simulator');
    expect(s.ui.guidanceOpen).toBe(true);
  });

  it('a task of the current case keeps the session: its measurements and its pose are not thrown away', () => {
    const m = { id: 'm1', measurementId: 'lv-edd' } as Measurement;
    useSimStore.setState({ caseId: 'normal-excellent-window', mode: 'guided', measurements: [m] });
    useSimStore.getState().setProbe({ rotationDeg: 40 });
    useSimStore.getState().openTask({ caseId: 'normal-excellent-window', viewId: 'psax-pm' });
    const s = useSimStore.getState();
    expect(s.measurements).toEqual([m]);
    expect(s.probe.rotationDeg).toBe(40);
    expect(s.targetViewId).toBe('psax-pm');
  });

  it('a task without a view clears the previous target', () => {
    useSimStore.setState({ targetViewId: 'a4c' });
    useSimStore.getState().openTask({ caseId: 'aortic-stenosis-severe' });
    expect(useSimStore.getState().targetViewId).toBeNull();
    expect(useSimStore.getState().caseId).toBe('aortic-stenosis-severe');
  });
});

describe('the case card', () => {
  it('every case has a history, and the card drops the notice every history ends with', () => {
    for (const c of CASE_INPUTS) {
      const { history } = caseBrief(c.id, 'guided', false);
      expect(history.length, c.id).toBeGreaterThan(30);
      expect(history, c.id).not.toMatch(/Sin datos reales/);
    }
  });

  it('shows the history on the simulator, with the objectives folded', () => {
    useSimStore.setState({ caseId: 'normal-excellent-window', mode: 'guided' });
    const { container } = render(<ConsolePanel />);
    const card = container.querySelector('[data-case-card]');
    expect(card?.textContent).toContain('Paciente sintético de 32 años');
    const details = card?.querySelector('details');
    expect(details?.open).toBe(false);
    expect(details?.querySelectorAll('li').length).toBe(
      CASE_INPUTS.find((c) => c.id === 'normal-excellent-window')!.learningObjectives.length,
    );
  });

  it('the exam keeps the history and holds the objectives back until it is finished', () => {
    const as = CASE_INPUTS.find((c) => c.id === 'aortic-stenosis-severe')!;
    useSimStore.setState({ caseId: as.id, mode: 'exam', examFinished: false });
    const { container, rerender } = render(<ConsolePanel />);
    const card = () => container.querySelector('[data-case-card]');
    expect(card()?.textContent).toContain('soplo sistólico eyectivo');
    expect(card()?.querySelector('details')).toBeNull();
    for (const o of as.learningObjectives) expect(container.textContent).not.toContain(o);
    useSimStore.setState({ examFinished: true });
    rerender(<ConsolePanel />);
    expect(card()?.querySelectorAll('details li').length).toBe(as.learningObjectives.length);
  });
});
