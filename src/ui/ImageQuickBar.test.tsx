// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { useSimStore } from '@/app/store';
import { ImageQuickBar } from './ImageQuickBar';

const initial = useSimStore.getState();

/** Depth and gain on the image (decision 187): the same steps as their keys, clamped by the store. */
describe('the quick bar on the image', () => {
  beforeEach(() => useSimStore.setState(initial, true));
  afterEach(() => cleanup());

  it('steps depth by 1 cm and gain by 2 dB, and shows the values', () => {
    render(<ImageQuickBar />);
    const d0 = useSimStore.getState().settings.depthCm;
    const g0 = useSimStore.getState().settings.gainDb;
    act(() => screen.getByRole('button', { name: 'Más profundidad' }).click());
    expect(useSimStore.getState().settings.depthCm).toBe(d0 + 1);
    act(() => screen.getByRole('button', { name: 'Menos ganancia' }).click());
    expect(useSimStore.getState().settings.gainDb).toBe(g0 - 2);
    expect(screen.getByText(`${d0 + 1} cm`)).toBeTruthy();
  });

  it('stops at the ends of each range', () => {
    useSimStore.getState().setSettings({ depthCm: 30, gainDb: -30 });
    render(<ImageQuickBar />);
    act(() => screen.getByRole('button', { name: 'Más profundidad' }).click());
    act(() => screen.getByRole('button', { name: 'Menos ganancia' }).click());
    expect(useSimStore.getState().settings.depthCm).toBe(30);
    expect(useSimStore.getState().settings.gainDb).toBe(-30);
  });
});
