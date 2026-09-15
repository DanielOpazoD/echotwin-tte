// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { TopBar } from './TopBar';
import { useHudStore, useSimStore } from '@/app/store';
import type { SimOutput } from '@/simulator/core/protocol';
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
    } as never as SimOutput,
  });
}

beforeEach(() => {
  cleanup();
  useSimStore.setState(initialSim, true);
  useHudStore.setState(initialHud, true);
});

describe('TopBar', () => {
  it('shows the live view and enables learning screens in sandbox', () => {
    seed('sandbox');
    render(<TopBar />);
    expect(screen.getByText('PLAX 91')).toBeTruthy();
    for (const name of ['Currículo', 'Progreso', 'Referencias']) {
      expect(screen.getByRole('button', { name })).toHaveProperty('disabled', false);
    }
  });

  it('disables learning screens in exam', () => {
    seed('exam');
    render(<TopBar />);
    for (const name of ['Currículo', 'Progreso', 'Referencias']) {
      expect(screen.getByRole('button', { name })).toHaveProperty('disabled', true);
    }
  });

  it('still shows the live view score in exam', () => {
    // Pinned current defect: the score IS visible in exam; a later clinical PR hides it.
    seed('exam');
    render(<TopBar />);
    expect(screen.getByText('PLAX 91')).toBeTruthy();
  });
});
