// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { segmentLayerOn, useHudStore, useSimStore } from '@/app/store';
import type { SegmentCoverage } from '@/simulator/view-recognition/segmentCoverage';
import { SegmentPanel } from './SegmentPanel';

const initialSim = useSimStore.getState();
const initialHud = useHudStore.getState();

const cov = (model: 'LV_AHA17' | 'LV_16', n: number, shown: number[], partial: number[] = []) =>
  Array.from({ length: n }, (_, i): SegmentCoverage => ({
    model,
    segmentId: i + 1,
    inPlane: shown.includes(i + 1) || partial.includes(i + 1),
    insonified: shown.includes(i + 1) || partial.includes(i + 1),
    assessable: shown.includes(i + 1),
    reason: shown.includes(i + 1)
      ? null
      : partial.includes(i + 1)
        ? 'insufficient_extent'
        : 'not_in_plane',
    areaCm2: shown.includes(i + 1) ? 2.5 : 0,
    insonifiedFraction: 1,
    lengthCm: 3,
    borderContrast: shown.includes(i + 1) ? 40 : null,
  }));

function seed() {
  useHudStore.setState({
    hud: {
      view: {
        segments: {
          aha17: cov('LV_AHA17', 17, [3, 6, 9, 12, 14, 16, 17], [13]),
          lv16: cov('LV_16', 16, [3, 6, 9, 12, 14, 16], [13]),
        },
      },
    } as never,
  });
}

beforeEach(() => {
  cleanup();
  useSimStore.setState(initialSim, true);
  useHudStore.setState(initialHud, true);
});

describe('SegmentPanel', () => {
  it('names every segment with its state in words, not by colour alone', () => {
    seed();
    render(<SegmentPanel />);
    expect(
      screen.getByRole('button', {
        name: /Segmento 9, Medio inferoseptal: evaluable en este corte/,
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: /Segmento 13, Apical anterior: en el plano, corte demasiado/,
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /Segmento 1, Basal anterior: fuera del plano/ }),
    ).toBeTruthy();
    expect(screen.getByText(/evaluables 3, 6, 9, 12, 14, 16, 17/)).toBeTruthy();
  });

  it('draws 17 segments in the anatomical model and 16 in the wall-motion model, whose apex has no 17', () => {
    seed();
    render(<SegmentPanel />);
    expect(screen.getAllByRole('button', { name: /^Segmento \d+,/ })).toHaveLength(17);
    fireEvent.click(screen.getByRole('button', { name: '16 · motilidad' }));
    expect(screen.getAllByRole('button', { name: /^Segmento \d+,/ })).toHaveLength(16);
    expect(screen.queryByRole('button', { name: /^Segmento 17,/ })).toBeNull();
    expect(
      screen.getByRole('button', { name: /Segmento 14, Apical septal \(incluye el ápex\)/ }),
    ).toBeTruthy();
  });

  it('selects with the keyboard, shares the selection and shows the inspector', () => {
    seed();
    render(<SegmentPanel />);
    const s9 = screen.getByRole('button', { name: /Segmento 9,/ });
    fireEvent.keyDown(s9, { key: 'Enter' });
    expect(useSimStore.getState().ui.selectedSegment).toBe(9);
    expect(screen.getByText('Mid inferoseptal', { exact: false })).toBeTruthy();
    expect(screen.getByText(/Apical cuatro cámaras/)).toBeTruthy();
    expect(screen.getByText(/orientativo/)).toBeTruthy();
    fireEvent.keyDown(s9, { key: 'Escape' });
    expect(useSimStore.getState().ui.selectedSegment).toBeNull();
  });

  it('is not shown in exam mode, and the saved segment layer of the cut map and 3D heart goes off with it', () => {
    seed();
    useSimStore.setState({ ui: { ...useSimStore.getState().ui, navSegments: true } });
    expect(segmentLayerOn(useSimStore.getState())).toBe(true);
    useSimStore.setState({ mode: 'exam' });
    const { container } = render(<SegmentPanel />);
    expect(container.textContent).toBe('');
    expect(segmentLayerOn(useSimStore.getState())).toBe(false);
  });
});
