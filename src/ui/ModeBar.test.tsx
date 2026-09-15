// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
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
