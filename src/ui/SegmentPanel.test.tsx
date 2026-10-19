// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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

  it('the colour key lists the segments of each state, with the reasons in its tip, and the short switch keeps its full name (decision 242)', () => {
    seed();
    render(<SegmentPanel />);
    const partial = screen.getByText(/parciales 13/);
    expect(partial.getAttribute('data-tip')).toBe(
      'En el plano, sin evaluar: 13 (corte demasiado pequeño o tangencial)',
    );
    expect(screen.getByText(/^fuera del plano$/)).toBeTruthy();
    const sw = screen.getByRole('button', {
      name: 'Colorear segmentos en el corte y el corazón 3D',
    });
    fireEvent.click(sw);
    expect(useSimStore.getState().ui.navSegments).toBe(true);
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

  it('holds its colours and lists in a window while the frames change with the beat (decision 342)', () => {
    const frame = (t: number, shown: number[], partial: number[]) =>
      useHudStore.setState({
        hud: {
          timeS: t,
          rrS: 1,
          view: {
            segments: {
              aha17: cov('LV_AHA17', 17, shown, partial),
              lv16: cov('LV_16', 16, shown, partial),
            },
          },
        } as never,
      });
    frame(0, [2, 4, 5, 8, 10], [9]);
    render(<SegmentPanel />);
    const legend = () => screen.getByText(/^evaluables/).textContent;
    expect(legend()).toBe(' evaluables 2, 4, 5, 8, 10');
    // the off-axis plane: within the beat the frames name other segments; the panel keeps the first frame
    act(() => frame(0.3, [2, 3, 4, 8, 9], [5, 10]));
    expect(legend()).toBe(' evaluables 2, 4, 5, 8, 10');
    act(() => frame(0.6, [2, 3, 4, 8, 9], [5, 10]));
    expect(legend()).toBe(' evaluables 2, 4, 5, 8, 10');
    // the beat is in: what is evaluable over two thirds of it (3 and 9 in three frames of four, 5 and 10 in one)
    act(() => frame(1.0, [2, 3, 4, 8, 9], [5, 10]));
    expect(legend()).toBe(' evaluables 2, 3, 4, 8, 9');
    expect(screen.getByText(/parciales/).textContent).toBe(' parciales 5, 10');
    for (const t of [1.3, 1.6, 2.2]) act(() => frame(t, [2, 4, 5, 8, 10], [9]));
    expect(legend()).toBe(' evaluables 2, 3, 4, 8, 9');
    // another window starts again
    act(() => useSimStore.getState().setProbe({ rotationDeg: 40 }));
    act(() => frame(2.3, [2, 4, 5, 8, 10], [9]));
    expect(legend()).toBe(' evaluables 2, 4, 5, 8, 10');
  });
});
