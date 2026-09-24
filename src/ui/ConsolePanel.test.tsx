// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { ConsolePanel } from './ConsolePanel';
import { useSimStore } from '@/app/store';
import type { Measurement } from '@/simulator/measurements/types';

const initialSim = useSimStore.getState();

beforeEach(() => {
  cleanup();
  useSimStore.setState(initialSim, true);
});

describe('ConsolePanel tabs', () => {
  it('shows the tab bar with Adquirir active by default', () => {
    render(<ConsolePanel />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual([
      'Adquirir',
      'Imagen',
      'Doppler',
      'Medir',
      'Lab',
    ]);
    expect(screen.getByRole('tab', { name: 'Adquirir' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    // Adquirir content: preset views are visible
    expect(screen.getByRole('button', { name: 'PLAX' })).toBeTruthy();
  });

  it('switches panels when a tab is clicked and persists the choice', () => {
    render(<ConsolePanel />);
    act(() => screen.getByRole('tab', { name: 'Imagen' }).click());
    expect(screen.getByRole('slider', { name: 'Ganancia' })).toBeTruthy();
    expect(useSimStore.getState().ui.consoleTab).toBe('imagen');
    act(() => screen.getByRole('tab', { name: 'Medir' }).click());
    expect(screen.getByRole('group', { name: 'Herramienta de medición' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Caliper' })).toBeTruthy();
  });

  it('Doppler shows an empty state in 2D with quick activators', () => {
    render(<ConsolePanel />);
    act(() => screen.getByRole('tab', { name: 'Doppler' }).click());
    expect(screen.queryByRole('slider', { name: 'Escala (Nyquist)' })).toBeNull();
    act(() => screen.getByRole('button', { name: 'Color' }).click());
    // quick activator changes the modality, and the console stays on the Doppler tab
    expect(useSimStore.getState().modality).toBe('color');
    expect(screen.getByRole('slider', { name: 'Escala (Nyquist)' })).toBeTruthy();
  });

  it('follows the modality: enabling a Doppler mode selects the Doppler tab', () => {
    render(<ConsolePanel />);
    act(() => screen.getByRole('tab', { name: 'Imagen' }).click());
    act(() => useSimStore.setState({ modality: 'pw' }));
    expect(useSimStore.getState().ui.consoleTab).toBe('doppler');
    expect(screen.getByRole('slider', { name: 'Escala' })).toBeTruthy();
  });

  it('returns from the Doppler tab to Imagen when the modality goes back to 2D', () => {
    act(() => useSimStore.setState({ modality: 'color' }));
    render(<ConsolePanel />);
    expect(useSimStore.getState().ui.consoleTab).toBe('doppler');
    act(() => useSimStore.setState({ modality: '2d' }));
    expect(useSimStore.getState().ui.consoleTab).toBe('imagen');
  });

  it('hides the Lab tab in exam mode', () => {
    act(() => useSimStore.setState({ mode: 'exam' }));
    render(<ConsolePanel />);
    expect(screen.queryByRole('tab', { name: 'Lab' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Medir' })).toBeTruthy();
  });

  it('badges the Medir tab with the measurement count', () => {
    act(() =>
      useSimStore.setState({
        measurements: [
          {
            id: 'm1',
            kind: 'linear',
            label: 'x',
            value: 1,
            units: 'cm',
            modality: '2d',
            measurementId: null,
            technique: null,
            sourceViewId: null,
            geometry: [],
          } as never,
        ],
      }),
    );
    render(<ConsolePanel />);
    const tab = screen.getByRole('tab', { name: 'Medir' });
    expect(tab.textContent).toContain('1');
    expect(tab.querySelector('.tab-badge')?.textContent).toBe('1');
  });

  it('focuses the Medir tab on the capture card while a free tool is armed', () => {
    render(<ConsolePanel />);
    act(() => screen.getByRole('tab', { name: 'Medir' }).click());
    act(() => screen.getByRole('button', { name: 'Caliper' }).click());
    // capture mode: catalogue and tool grid are tucked away
    expect(screen.getByRole('heading', { name: 'Midiendo' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Herramienta de medición' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Caliper' })).toBeNull();
    expect(screen.getByRole('button', { name: /Cancelar/ })).toBeTruthy();
  });

  it('Cancelar disarms the free tool and restores the catalogue', () => {
    act(() => useSimStore.setState({ activeTool: 'caliper' }));
    render(<ConsolePanel />);
    act(() => screen.getByRole('tab', { name: 'Medir' }).click());
    act(() => screen.getByRole('button', { name: /Cancelar/ }).click());
    expect(useSimStore.getState().activeTool).toBe('none');
    expect(screen.getByRole('group', { name: 'Herramienta de medición' })).toBeTruthy();
  });

  it('names no view and grades no technique in the Medir tab during an exam (decision 154)', () => {
    const taken: Measurement = {
      id: 'm1',
      kind: 'linear',
      measurementId: 'lvot-diameter',
      technique: {
        score: 0.2,
        findings: [{ code: 'view', level: 'invalid', message: 'Vista A4C: se mide en PLAX.' }],
      },
      label: 'Diámetro del TSVI',
      value: 2,
      units: 'cm',
      modality: '2d',
      sourceViewId: 'a4c',
      viewScore: 35,
      frameId: 1,
      phase: 0.1,
      timeS: 1,
      geometry: [],
      imageQualityScore: 90,
      userAssisted: false,
      referenceGuidelineIds: [],
      createdAt: '2026-09-23T00:00:00Z',
    };
    for (const mode of ['sandbox', 'exam'] as const) {
      cleanup();
      act(() => useSimStore.setState({ mode, measurements: [taken] }));
      const { container } = render(<ConsolePanel />);
      act(() => screen.getByRole('tab', { name: 'Medir' }).click());
      const shown = container.textContent ?? '';
      const learning = mode === 'sandbox';
      expect(shown.includes('2d · a4c'), `${mode}: view in the list`).toBe(learning);
      expect(shown.includes('inválida'), `${mode}: technique grade`).toBe(learning);
      expect(shown.includes('2.00 cm'), `${mode}: the value itself`).toBe(true);
    }
  });
});

describe('the measurement list (decision 200)', () => {
  it('shows each figure in its own column and copies the list as text', () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    act(() =>
      useSimStore.setState({
        ui: { ...useSimStore.getState().ui, consoleTab: 'medir' },
        measurements: [
          {
            id: 'm1',
            kind: 'linear',
            label: 'TSVI ⌀',
            value: 2.034,
            units: 'cm',
            modality: '2d',
            measurementId: null,
            technique: null,
            sourceViewId: 'plax',
            geometry: [],
          } as never,
          {
            id: 'm2',
            kind: 'velocity',
            label: 'Vmax Ao',
            value: 1.2,
            units: 'm/s',
            modality: 'cw',
            measurementId: null,
            technique: null,
            sourceViewId: null,
            geometry: [],
            derived: { gradientMmHg: 5.76 },
          } as never,
        ],
      }),
    );
    render(<ConsolePanel />);
    const values = [...document.querySelectorAll('.measure-row .m-value')].map(
      (e) => e.textContent,
    );
    expect(values).toEqual(['2.03 cm', '1.20 m/s · 6 mmHg']);
    act(() => screen.getByRole('button', { name: 'Copiar mediciones' }).click());
    expect(writeText).toHaveBeenCalledWith('TSVI ⌀: 2.03 cm\nVmax Ao: 1.20 m/s · 6 mmHg');
  });
});
