// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ImageHud } from './ImageHud';
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

describe('ImageHud', () => {
  it('prints the case, vitals, acquisition params and view score on the image', () => {
    seed('sandbox');
    render(<ImageHud />);
    expect(screen.getByText(/FC 72 lpm/)).toBeTruthy();
    expect(screen.getByText(/16 cm · \d\.\d MHz/)).toBeTruthy();
    expect(screen.getByText(/FR 30 Hz/)).toBeTruthy();
    expect(screen.getByText(/PLAX 91/)).toBeTruthy();
  });

  it('disappears when the HUD preference is off', () => {
    useSimStore.setState({ ui: { ...useSimStore.getState().ui, showHud: false } });
    seed('sandbox');
    const { container } = render(<ImageHud />);
    expect(container.firstChild).toBeNull();
  });

  it('hides the recognised view and its score in exam, keeping the acquisition data', () => {
    // the exam asks the learner to recognise the view (decision 154)
    seed('exam');
    render(<ImageHud />);
    expect(screen.queryByText(/PLAX/)).toBeNull();
    expect(screen.queryByText(/Vista/)).toBeNull();
    expect(screen.getByText(/FR 30 Hz/)).toBeTruthy();
  });
});
