// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { PresetViews } from './PresetViews';
import { useSimStore } from '@/app/store';
import type { ProductMode } from '@/app/modePolicy';

const initialSim = useSimStore.getState();

function presetButtons() {
  return screen.getAllByRole('button').filter((b) => b.closest('.preset-grid') !== null);
}

beforeEach(() => {
  cleanup();
  useSimStore.setState(initialSim, true);
});

describe.each<[ProductMode, boolean]>([
  ['sandbox', false],
  ['guided', false],
  ['exam', true],
])('PresetViews in %s', (mode, disabled) => {
  it(`preset buttons are ${disabled ? 'disabled' : 'enabled'}`, () => {
    useSimStore.setState({ mode });
    render(<PresetViews />);
    const buttons = presetButtons();
    expect(buttons.length).toBe(12);
    for (const b of buttons) expect(b).toHaveProperty('disabled', disabled);
    if (disabled) {
      expect(screen.getByText(/Deshabilitadas en examen/)).toBeTruthy();
    }
  });
});
