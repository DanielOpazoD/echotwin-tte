// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { focusOwnsKey, useShortcuts } from '@/app/shortcuts';
import { useSimStore } from '@/app/store';
import { RotationDial } from './RotationDial';

function Harness(): React.JSX.Element {
  useShortcuts();
  return (
    <div>
      <div role="tablist">
        <button role="tab">Adquirir</button>
      </div>
      <button>Congelar</button>
      <RotationDial />
    </div>
  );
}

/**
 * The keyboard reaches the focused control before the global shortcuts (decision 176): with focus on a tab ArrowRight
 * moved the probe and Space froze the image while it pressed the button; the rotation dial, a slider for assistive
 * technology, could not be focused or moved from the keyboard.
 */
describe('keyboard access', () => {
  afterEach(() => cleanup());

  it('the arrows and Space belong to the focused tab or button, and act as shortcuts elsewhere', () => {
    render(<Harness />);
    const probe = () => useSimStore.getState().probe;
    const u0 = probe().u;
    fireEvent.keyDown(screen.getByRole('tab'), { key: 'ArrowRight' });
    expect(probe().u).toBe(u0);
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(probe().u).not.toBe(u0);
    const frozen = useSimStore.getState().frozen;
    fireEvent.keyDown(screen.getByRole('button', { name: 'Congelar' }), { key: ' ' });
    expect(useSimStore.getState().frozen).toBe(frozen);
    fireEvent.keyDown(document.body, { key: ' ' });
    expect(useSimStore.getState().frozen).toBe(!frozen);
    // letters stay shortcuts on a button: they are not what a button does
    expect(focusOwnsKey(screen.getByRole('button', { name: 'Congelar' }), 'c')).toBe(false);
    if (useSimStore.getState().frozen) useSimStore.getState().toggleFreeze();
  });

  it('the rotation dial takes focus and turns with the arrows, Page keys and Shift', () => {
    render(<Harness />);
    const dial = screen.getByRole('slider', { name: /Rotación de la sonda/ });
    expect(dial.getAttribute('tabindex')).toBe('0');
    const rot = () => useSimStore.getState().probe.rotationDeg;
    const u0 = useSimStore.getState().probe.u;
    const r0 = rot();
    fireEvent.keyDown(dial, { key: 'ArrowRight' });
    expect(rot()).toBeCloseTo(r0 + 3, 6);
    fireEvent.keyDown(dial, { key: 'ArrowLeft', shiftKey: true });
    expect(rot()).toBeCloseTo(r0 - 12, 6);
    fireEvent.keyDown(dial, { key: 'PageUp' });
    expect(rot()).toBeCloseTo(r0 + 3, 6);
    // the probe did not slide: the arrows were the dial's
    expect(useSimStore.getState().probe.u).toBe(u0);
  });
});
