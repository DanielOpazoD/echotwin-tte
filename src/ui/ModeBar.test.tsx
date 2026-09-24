// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { ModeBar } from './ModeBar';
import { useHudStore, useSimStore } from '@/app/store';
import type { ProductMode } from '@/app/modePolicy';

const initialSim = useSimStore.getState();
const initialHud = useHudStore.getState();

function openMenu() {
  act(() => {
    screen.getByRole('button', { name: 'Más opciones' }).click();
  });
}

beforeEach(() => {
  cleanup();
  useSimStore.setState(initialSim, true);
  useHudStore.setState(initialHud, true);
});

describe.each<[ProductMode, boolean]>([
  ['sandbox', false],
  ['guided', false],
  ['exam', true],
])('ModeBar in %s', (mode, disabled) => {
  it(`hints toggle is ${disabled ? 'disabled' : 'enabled'}`, () => {
    useSimStore.setState({ mode });
    render(<ModeBar />);
    openMenu();
    expect(screen.getByRole('menuitemcheckbox', { name: 'Ayudas de vista' })).toHaveProperty(
      'disabled',
      disabled,
    );
  });

  it(`physics and dev toggles are ${disabled ? 'disabled' : 'enabled'}`, () => {
    useSimStore.setState({ mode });
    render(<ModeBar />);
    openMenu();
    for (const name of ['Superposición física', 'Panel Dev']) {
      expect(screen.getByRole('menuitemcheckbox', { name })).toHaveProperty('disabled', disabled);
    }
  });
});

describe('ModeBar overflow menu', () => {
  it('hides secondary controls behind the ⋯ menu and lists actions', () => {
    render(<ModeBar />);
    expect(screen.queryByRole('menuitemcheckbox', { name: 'ECG' })).toBeNull();
    openMenu();
    for (const name of ['Ayudas de vista', 'Superposición física', 'ECG', 'Panel Dev']) {
      expect(screen.getByRole('menuitemcheckbox', { name })).toBeTruthy();
    }
    expect(screen.getByRole('menuitem', { name: 'Guardar imagen PNG' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Reiniciar tutorial' })).toBeTruthy();
  });

  it('keeps modality keys, freeze and torso in the first row', () => {
    render(<ModeBar />);
    for (const name of ['2D', 'Color', 'M', 'CMM', 'PW', 'CW', 'TDI', 'Freeze', 'Torso 3D']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
  });
});

describe('ModeBar context chip', () => {
  it('shows nothing in 2D', () => {
    render(<ModeBar />);
    expect(document.querySelector('.ctx-chip')).toBeNull();
  });

  it('shows the colour Nyquist scale in colour mode', () => {
    useSimStore.setState({ modality: 'color' });
    render(<ModeBar />);
    expect(document.querySelector('.ctx-chip')?.textContent).toContain('m/s');
  });

  it('shows the gate depth in PW and the sweep in M-mode', () => {
    useSimStore.setState({ modality: 'pw', gateDepthCm: 9 });
    render(<ModeBar />);
    expect(document.querySelector('.ctx-chip')?.textContent).toContain('Gate 9.0 cm');
    cleanup();
    useSimStore.setState({ modality: 'm-mode', spectral: { sweepSpeedMmPerS: 50 } as never });
    render(<ModeBar />);
    expect(document.querySelector('.ctx-chip')?.textContent).toContain('50 mm/s');
  });
});

describe('ModeBar clean interface', () => {
  it('offers an Interfaz limpia toggle that disables the torso button while on', () => {
    render(<ModeBar />);
    openMenu();
    act(() => screen.getByRole('menuitemcheckbox', { name: 'Interfaz limpia' }).click());
    expect(useSimStore.getState().ui.minimal).toBe(true);
    expect(screen.getByRole('button', { name: 'Torso 3D' })).toHaveProperty('disabled', true);
  });

  it('forces clean interface on in exam mode (toggle locked on)', () => {
    useSimStore.setState({ mode: 'exam' });
    render(<ModeBar />);
    openMenu();
    const item = screen.getByRole('menuitemcheckbox', { name: 'Interfaz limpia' });
    expect(item).toHaveProperty('disabled', true);
    expect(item.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('button', { name: 'Torso 3D' })).toHaveProperty('disabled', true);
  });
});

describe('the cine loop (decisions 191 and 197)', () => {
  const frozenCine = () => {
    // 96 frames over 1.9 s: one every 20 ms
    useHudStore.setState({
      hud: {
        ...initialHud.hud,
        cineLength: 96,
        cineFramePhase: 0,
        cineWindow: { startS: 8.1, endS: 10, frameS: 10 },
      } as never,
    });
    useSimStore.setState({ frozen: true, cineOffset: -2 });
  };
  const play = () => screen.getByRole('button', { name: 'Reproducir el cine' });
  const advance = (ms: number) =>
    act(() => {
      vi.advanceTimersByTime(ms);
    });

  it('replays the frozen frames at their pace, wraps from the newest to the oldest and pauses', () => {
    vi.useFakeTimers();
    try {
      frozenCine();
      render(<ModeBar />);
      act(() => play().click());
      expect(play().getAttribute('aria-pressed')).toBe('true');
      advance(20);
      expect(useSimStore.getState().cineOffset).toBe(-1);
      advance(40);
      expect(useSimStore.getState().cineOffset).toBe(-95);
      act(() => play().click());
      expect(play().getAttribute('aria-pressed')).toBe('false');
      advance(200);
      expect(useSimStore.getState().cineOffset).toBe(-95);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops when the learner picks a frame, arms a tool, enters review mode or unfreezes', () => {
    vi.useFakeTimers();
    try {
      frozenCine();
      render(<ModeBar />);
      const stops: [string, () => void][] = [
        ['a frame by hand', () => useSimStore.getState().setCineOffset(-40)],
        ['a tool', () => useSimStore.getState().setActiveTool('caliper')],
        ['review mode', () => useSimStore.getState().setUi({ reviewMode: true })],
        ['the freeze', () => useSimStore.getState().toggleFreeze()],
      ];
      for (const [what, stop] of stops) {
        useSimStore.setState({ frozen: true, activeTool: 'none' });
        act(() => useSimStore.getState().setCinePlaying(true));
        act(stop);
        expect(useSimStore.getState().cinePlaying, what).toBe(false);
        const offset = useSimStore.getState().cineOffset;
        advance(100);
        expect(useSimStore.getState().cineOffset, what).toBe(offset);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('has nothing to play with a single frame', () => {
    useHudStore.setState({
      hud: {
        ...initialHud.hud,
        cineLength: 1,
        cineFramePhase: 0,
        cineWindow: { startS: 10, endS: 10, frameS: 10 },
      } as never,
    });
    useSimStore.setState({ frozen: true, cineOffset: 0 });
    render(<ModeBar />);
    expect(play()).toHaveProperty('disabled', true);
  });
});
