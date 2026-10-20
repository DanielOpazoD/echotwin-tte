// @vitest-environment jsdom
/**
 * The Dev panel (decision 357): the experimental choices come first, where they are seen without scrolling past the
 * runtime table, and the chosen button of each says so.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { DevPanel } from './DevPanel';
import { useHudStore, useSimStore } from '@/app/store';

const initialSim = useSimStore.getState();
const initialHud = useHudStore.getState();

beforeEach(() => {
  cleanup();
  useSimStore.setState(initialSim, true);
  useHudStore.setState(initialHud, true);
  useSimStore.setState((s) => ({ ui: { ...s.ui, devPanel: true } }));
});

describe('Dev panel (decision 357)', () => {
  it('shows the anatomy and image choices before anything else', () => {
    render(<DevPanel />);
    const headings = screen.getAllByRole('heading').map((h) => h.textContent);
    expect(headings.slice(0, 3)).toEqual(['Anatomía', 'Imagen', 'Backend']);
    expect(headings.indexOf('Runtime')).toBeGreaterThan(2);
  });

  it('marks the chosen anatomy and image, and follows a change', () => {
    render(<DevPanel />);
    const pressed = (name: string) =>
      screen.getByRole('button', { name }).getAttribute('aria-pressed');
    expect(pressed('analítica')).toBe('true');
    expect(pressed('Rodero (experimental)')).toBe('false');
    expect(pressed('red')).toBe('true');
    expect(pressed('convolución (experimental)')).toBe('false');
    act(() => screen.getByRole('button', { name: 'Rodero (experimental)' }).click());
    act(() => screen.getByRole('button', { name: 'convolución (experimental)' }).click());
    expect(useSimStore.getState().anatomy).toBe('rodero');
    expect(useSimStore.getState().imageFormation).toBe('cole');
    expect(pressed('Rodero (experimental)')).toBe('true');
    expect(pressed('analítica')).toBe('false');
    expect(pressed('convolución (experimental)')).toBe('true');
  });
});
