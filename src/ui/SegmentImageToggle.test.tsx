// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { imageSegmentsOn, useSegmentHover, useSimStore } from '@/app/store';
import { SegmentImageToggle } from './SegmentImageToggle';

const initialSim = useSimStore.getState();

beforeEach(() => {
  cleanup();
  useSimStore.setState(initialSim, true);
  useSegmentHover.setState({ id: null, source: null });
});

/** The segment button of the ultrasound image and the shared hover (decision 153). */
describe('segment layer of the image', () => {
  it('turns the layer on and off and offers the model while it shows', () => {
    render(<SegmentImageToggle />);
    const button = screen.getByRole('button', { name: /Segmentos VI/ });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByRole('group', { name: /Modelo/ })).toBeNull();
    fireEvent.click(button);
    expect(imageSegmentsOn(useSimStore.getState())).toBe(true);
    expect(screen.getByRole('button', { name: /Segmentos VI/ }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    useSimStore.setState({ ui: { ...useSimStore.getState().ui, selectedSegment: 17 } });
    fireEvent.click(screen.getByRole('button', { name: '16' }));
    expect(useSimStore.getState().ui.segmentModel).toBe('LV_16');
    // segment 17 does not exist in the 16-segment model
    expect(useSimStore.getState().ui.selectedSegment).toBeNull();
  });

  it('is not offered in exam mode, where the layer is off whatever was saved', () => {
    useSimStore.setState({
      mode: 'exam',
      ui: { ...useSimStore.getState().ui, imageSegments: true },
    });
    const { container } = render(<SegmentImageToggle />);
    expect(container.textContent).toBe('');
    expect(imageSegmentsOn(useSimStore.getState())).toBe(false);
  });

  it('shares the hovered segment between views; leaving one view does not clear another view’s hover', () => {
    const h = useSegmentHover.getState();
    h.setHover(9, 'image');
    expect(useSegmentHover.getState()).toMatchObject({ id: 9, source: 'image' });
    h.setHover(12, 'heart');
    // a late leave of the image must not undo the heart's hover
    h.setHover(null, 'image');
    expect(useSegmentHover.getState()).toMatchObject({ id: 12, source: 'heart' });
    h.setHover(null, 'heart');
    expect(useSegmentHover.getState()).toMatchObject({ id: null, source: null });
  });
});
