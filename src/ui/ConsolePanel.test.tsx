// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { ConsolePanel } from './ConsolePanel';
import { useSimStore } from '@/app/store';

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
});
