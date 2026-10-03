// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { narrowPanelFovDeg, TorsoView } from './TorsoView';
import { ModeBar } from './ModeBar';
import { navigatorLayers, useSimStore } from '@/app/store';

/**
 * The torso stays in the exam with its skin and ribs (decision 256): where the probe sits on the chest is the learner's
 * own reference, while the heart cut by the plane, the canonical windows and the axes would name the view.
 */
const initialSim = useSimStore.getState();
const EVERY_LAYER = {
  navSkin: true,
  showSkeleton: true,
  navHeart: true,
  navChambers: true,
  navValves: true,
  navVessels: true,
  navCut: true,
  navSplit: true,
  navWindows: true,
  navAxes: true,
};

beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});
beforeEach(() => {
  cleanup();
  useSimStore.setState(initialSim, true);
});
afterEach(() => vi.restoreAllMocks());

describe('the 3D navigator in the exam', () => {
  it('draws only the skin and the ribs, whatever layers were saved', () => {
    const ui = { ...initialSim.ui, ...EVERY_LAYER };
    expect(navigatorLayers({ mode: 'exam', ui })).toEqual({
      skin: true,
      skeleton: true,
      heart: false,
      chambers: false,
      valves: false,
      vessels: false,
      cut: false,
      split: false,
      windows: false,
      axes: false,
    });
    // even with the skin and the bones switched off in practice
    expect(
      navigatorLayers({ mode: 'exam', ui: { ...ui, navSkin: false, showSkeleton: false } }),
    ).toMatchObject({
      skin: true,
      skeleton: true,
    });
  });

  it('outside the exam the saved layers rule', () => {
    const ui = { ...initialSim.ui, ...EVERY_LAYER, navHeart: false, navAxes: false };
    for (const mode of ['sandbox', 'guided'] as const) {
      const l = navigatorLayers({ mode, ui });
      expect(l.heart).toBe(false);
      expect(l.axes).toBe(false);
      expect(l.chambers && l.valves && l.vessels && l.cut && l.split && l.windows).toBe(true);
    }
  });

  it('the exam has no layers menu and no cut map', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    useSimStore.getState().setUi({ navSplit: true });
    const { unmount } = render(<TorsoView />);
    expect(screen.getByRole('button', { name: 'Capas del navegador 3D' })).toBeTruthy();
    expect(screen.queryByText('Sonda y tórax')).toBeTruthy();
    unmount();
    useSimStore.setState({ mode: 'exam' });
    render(<TorsoView />);
    expect(screen.queryByRole('button', { name: 'Capas del navegador 3D' })).toBeNull();
    expect(screen.queryByText('Sonda y tórax')).toBeNull();
    // the probe is still steered from here
    expect(screen.getByRole('button', { name: 'Centrar la cámara en la sonda' })).toBeTruthy();
  });

  it('the torso button works in the exam', () => {
    useSimStore.setState({ mode: 'exam' });
    render(<ModeBar />);
    expect(screen.getByRole('button', { name: 'Torso 3D' })).toHaveProperty('disabled', false);
  });

  it('a tall rail keeps the width of the chest in view', () => {
    expect(narrowPanelFovDeg(0.6)).toBe(35);
    const hfov = (a: number) =>
      (2 * Math.atan(Math.tan((narrowPanelFovDeg(a) * Math.PI) / 360) * a) * 180) / Math.PI;
    expect(hfov(0.37)).toBeCloseTo(hfov(0.5), 6);
  });
});
