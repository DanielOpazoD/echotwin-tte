// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ModeBar } from './ModeBar';
import { useHudStore, useSimStore } from '@/app/store';
import type { ProductMode } from '@/app/modePolicy';

const initialSim = useSimStore.getState();
const initialHud = useHudStore.getState();

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
    expect(screen.getByRole('button', { name: 'Ayudas' })).toHaveProperty('disabled', disabled);
  });

  it(`physics and dev toggles are ${disabled ? 'disabled' : 'enabled'}`, () => {
    useSimStore.setState({ mode });
    render(<ModeBar />);
    for (const name of ['Física', 'Dev']) {
      expect(screen.getByRole('button', { name })).toHaveProperty('disabled', disabled);
    }
  });
});
