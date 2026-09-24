// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { useSimStore } from '@/app/store';
import { Tutorial } from './Tutorial';

const initial = useSimStore.getState();

/** The spotlight tour (decision 204): frames the step's control, sits beside it, opens the tab the control lives in. */
describe('the controls tour', () => {
  beforeEach(() => {
    useSimStore.setState({ ...initial, ui: { ...initial.ui, tutorialDone: false } }, true);
    Object.defineProperty(window, 'innerWidth', { value: 1400, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true });
  });
  afterEach(() => cleanup());

  const anchored = (
    tour: string,
    r: { left: number; top: number; width: number; height: number },
  ) => {
    const el = document.createElement('div');
    el.setAttribute('data-tour', tour);
    el.getBoundingClientRect = () => ({
      ...r,
      right: r.left + r.width,
      bottom: r.top + r.height,
      x: r.left,
      y: r.top,
      toJSON: () => ({}),
    });
    document.body.appendChild(el);
    return el;
  };

  it('frames the torso on the first step and puts the card beside it', async () => {
    const el = anchored('torso', { left: 10, top: 40, width: 300, height: 250 });
    render(<Tutorial />);
    // the first measure waits a frame
    await act(() => new Promise((r) => setTimeout(r, 30)));
    const hole = document.querySelector<HTMLElement>('.tour-hole')!;
    expect(hole.style.left).toBe('4px');
    expect(hole.style.width).toBe('312px');
    const card = screen.getByRole('dialog', { name: 'Tutorial de controles' });
    expect(card.className).toContain('arrow-left');
    expect(card.style.left).toBe('326px');
    el.remove();
  });

  it('opens the Imagen tab for the depth step and centres the card when the anchor is missing', () => {
    render(<Tutorial />);
    expect(screen.getByRole('dialog').className).toContain('centered');
    for (let i = 0; i < 3; i++)
      act(() => screen.getByRole('button', { name: 'Siguiente' }).click());
    expect(screen.getByRole('heading', { name: 'Profundidad' })).toBeTruthy();
    expect(useSimStore.getState().ui.consoleTab).toBe('imagen');
    expect(document.querySelector('.tour-hole')).toBeNull();
  });

  it('Saltar ends it and remembers it', () => {
    render(<Tutorial />);
    act(() => screen.getByRole('button', { name: 'Saltar' }).click());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useSimStore.getState().ui.tutorialDone).toBe(true);
  });
});
