// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { TopBar } from './TopBar';
import { ReportSections } from './ReportSections';
import { useHudStore, useSimStore } from '@/app/store';
import type { ProductMode } from '@/app/modePolicy';

const initialSim = useSimStore.getState();
const initialHud = useHudStore.getState();

function seed(mode: ProductMode) {
  useSimStore.setState({ mode });
  useHudStore.setState({
    hud: {
      heartRateBpm: 72,
      simulatedFps: 30,
      colorFps: 0,
      view: { bestViewId: 'plax', score: 91 },
    } as never,
  });
}

beforeEach(() => {
  cleanup();
  useSimStore.setState(initialSim, true);
  useHudStore.setState(initialHud, true);
});

describe('TopBar', () => {
  it('shows run state and enables the screens in sandbox', () => {
    seed('sandbox');
    render(<TopBar />);
    expect(screen.getByText('LIVE')).toBeTruthy();
    for (const name of ['Simulador', 'Informe', 'Referencias']) {
      expect(screen.getByRole('button', { name })).toHaveProperty('disabled', false);
    }
  });

  it('disables the references in exam and keeps the report open', () => {
    seed('exam');
    render(<TopBar />);
    expect(screen.getByRole('button', { name: 'Referencias' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Informe' })).toHaveProperty('disabled', false);
  });

  it('holds the case report, the curriculum and the progress in one tab (decision 244)', () => {
    seed('sandbox');
    render(<TopBar />);
    const nav = within(screen.getByRole('navigation', { name: 'Pantallas' }));
    expect(nav.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Simulador',
      'Informe',
      'Referencias',
    ]);
    act(() => useSimStore.getState().setUi({ screen: 'curriculum' }));
    expect(nav.getByRole('button', { name: 'Informe' }).getAttribute('aria-current')).toBe('page');
    // the tab of the section already shown does not send it back to the case report
    act(() => nav.getByRole('button', { name: 'Informe' }).click());
    expect(useSimStore.getState().ui.screen).toBe('curriculum');
    act(() => nav.getByRole('button', { name: 'Simulador' }).click());
    act(() => nav.getByRole('button', { name: 'Informe' }).click());
    expect(useSimStore.getState().ui.screen).toBe('report');
  });
});

describe('ReportSections', () => {
  it('switches between the case, the curriculum and the progress', () => {
    seed('sandbox');
    useSimStore.getState().setUi({ screen: 'report' });
    render(<ReportSections>contenido</ReportSections>);
    const nav = within(screen.getByRole('navigation', { name: 'Secciones del informe' }));
    expect(nav.getByRole('button', { name: 'Caso' }).getAttribute('aria-current')).toBe('page');
    act(() => nav.getByRole('button', { name: 'Progreso' }).click());
    expect(useSimStore.getState().ui.screen).toBe('progress');
    act(() => nav.getByRole('button', { name: 'Currículo' }).click());
    expect(useSimStore.getState().ui.screen).toBe('curriculum');
    expect(screen.getByText('contenido')).toBeTruthy();
  });

  it('keeps the curriculum and the progress closed in exam mode', () => {
    seed('exam');
    render(<ReportSections>contenido</ReportSections>);
    expect(screen.getByRole('button', { name: 'Caso' })).toHaveProperty('disabled', false);
    for (const name of ['Currículo', 'Progreso']) {
      expect(screen.getByRole('button', { name })).toHaveProperty('disabled', true);
    }
  });
});
