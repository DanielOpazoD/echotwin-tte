// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { useHudStore, useSimStore } from '@/app/store';
import { Splash } from './Splash';

const initialSim = useSimStore.getState();
const initialHud = useHudStore.getState();

/** The start screen (decision 203): lists what is readied, ticks it off, leaves after the first frame. */
describe('the start screen', () => {
  beforeEach(() => {
    useSimStore.setState(initialSim, true);
    useHudStore.setState(initialHud, true);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('shows the engine, the navigator and the first image as pending, then ticks them off', () => {
    render(<Splash />);
    const items = () => screen.getAllByRole('listitem').map((li) => [li.textContent, li.className]);
    expect(items()).toEqual([
      ['Motor de simulación', ''],
      ['Navegador 3D', ''],
      ['Primera imagen', ''],
    ]);
    act(() => {
      useSimStore.getState().setWorkerMode('worker');
      useSimStore.getState().setNavigatorReady(true);
    });
    expect(items().map((i) => i[1])).toEqual(['done', 'done', '']);
  });

  it('says when the engine runs without a worker, and hides the navigator row when the rail is hidden', () => {
    useSimStore.setState({ workerMode: 'inline', ui: { ...initialSim.ui, showTorso: false } });
    render(<Splash />);
    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toEqual(['Motor de simulaciónen el hilo de la interfaz', 'Primera imagen']);
  });

  it('leaves on an error, so the banner is never under it, and after 15 s whatever happens', () => {
    vi.useFakeTimers();
    render(<Splash />);
    act(() => useSimStore.getState().setError('el worker no arrancó'));
    expect(document.querySelector('.splash')?.className).toContain('leaving');
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(document.querySelector('.splash')).toBeNull();
    cleanup();
    useSimStore.setState(initialSim, true);
    render(<Splash />);
    act(() => {
      vi.advanceTimersByTime(14_000);
    });
    expect(document.querySelector('.splash')?.className).not.toContain('leaving');
    act(() => {
      vi.advanceTimersByTime(1_500);
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(document.querySelector('.splash')).toBeNull();
  });

  it('fades out once the first frame arrives and is gone 380 ms later', () => {
    vi.useFakeTimers();
    render(<Splash />);
    act(() => {
      useHudStore.setState({ hud: { stats: { gpu: 'ok' } } as never });
    });
    expect(document.querySelector('.splash')?.className).toContain('leaving');
    expect(document.querySelector('.splash')?.textContent).toContain('trazado en la GPU');
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(document.querySelector('.splash')).toBeNull();
  });
});
