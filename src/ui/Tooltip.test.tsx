// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TooltipLayer } from './Tooltip';

/** The one tooltip of the interface (decision 199): pointer, keyboard focus, keys as chips, Escape. */
describe('the tooltip layer', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });
  const mount = () =>
    render(
      <div>
        <TooltipLayer />
        <button data-tip="Congelar la imagen" data-tip-key="Espacio">
          Freeze
        </button>
        <button>sin ayuda</button>
      </div>,
    );

  it('shows after 350 ms under the pointer, with the key as a chip, and describes the element', () => {
    vi.useFakeTimers();
    mount();
    const btn = screen.getByRole('button', { name: 'Freeze' });
    fireEvent.pointerOver(btn);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.queryByRole('tooltip')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(60);
    });
    const tip = screen.getByRole('tooltip');
    expect(tip.textContent).toContain('Congelar la imagen');
    expect(tip.querySelector('kbd')?.textContent).toBe('Espacio');
    expect(btn.getAttribute('aria-describedby')).toBe('app-tooltip');
    fireEvent.pointerOut(btn);
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(btn.getAttribute('aria-describedby')).toBeNull();
  });

  it('shows sooner on keyboard focus and leaves with Escape', () => {
    vi.useFakeTimers();
    mount();
    const btn = screen.getByRole('button', { name: 'Freeze' });
    fireEvent.focusIn(btn);
    act(() => {
      vi.advanceTimersByTime(130);
    });
    expect(screen.getByRole('tooltip')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('ignores elements without a tip and a pointer that leaves before the delay', () => {
    vi.useFakeTimers();
    mount();
    fireEvent.pointerOver(screen.getByRole('button', { name: 'sin ayuda' }));
    const btn = screen.getByRole('button', { name: 'Freeze' });
    fireEvent.pointerOver(btn);
    fireEvent.pointerOut(btn);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
