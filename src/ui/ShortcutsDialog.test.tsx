// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useShortcuts } from '@/app/shortcuts';
import { useSimStore } from '@/app/store';
import { ShortcutsDialog } from './ShortcutsDialog';
import { ModeBar } from './ModeBar';

const initial = useSimStore.getState();

function Harness(): React.JSX.Element {
  useShortcuts();
  return (
    <div>
      <input aria-label="campo" />
      <ShortcutsDialog />
    </div>
  );
}

/** The keyboard shortcuts sheet (decision 185): «?» toggles it, Escape and its button close it, the ⋯ menu opens it. */
describe('the shortcuts sheet', () => {
  beforeEach(() => useSimStore.setState(initial, true));
  afterEach(() => cleanup());

  it('opens with «?» outside a field, closes with Escape and with its button', () => {
    render(<Harness />);
    expect(screen.queryByRole('dialog', { name: 'Atajos de teclado' })).toBeNull();
    fireEvent.keyDown(document.body, { key: '?' });
    expect(screen.getByRole('dialog', { name: 'Atajos de teclado' })).toBeTruthy();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Atajos de teclado' })).toBeNull();
    // a «?» typed into a field is text, not the shortcut
    fireEvent.keyDown(screen.getByLabelText('campo'), { key: '?' });
    expect(screen.queryByRole('dialog', { name: 'Atajos de teclado' })).toBeNull();
    fireEvent.keyDown(document.body, { key: '?' });
    act(() => screen.getByRole('button', { name: 'Cerrar' }).click());
    expect(screen.queryByRole('dialog', { name: 'Atajos de teclado' })).toBeNull();
  });

  it('lists every shortcut with its keys', () => {
    useSimStore.setState({ ui: { ...initial.ui, shortcutsOpen: true } });
    render(<ShortcutsDialog />);
    expect(screen.getByText('Freeze / Live')).toBeTruthy();
    expect(screen.getByText('Espacio')).toBeTruthy();
    expect(screen.getByText('Mostrar u ocultar esta lista de atajos')).toBeTruthy();
    // the pointer gestures on the 3D navigator (decision 188), each phrase in its chip
    expect(screen.getByText('Orbitar la cámara')).toBeTruthy();
    expect(screen.getByText('Botón derecho')).toBeTruthy();
    expect(screen.getAllByText('arrastrar', { selector: 'kbd' })).toHaveLength(3);
    // «+» between two keys joins them, but in «- / +» it is the key that raises the gain
    expect(screen.getByText('+', { selector: 'kbd' })).toBeTruthy();
    expect(screen.getAllByText('+', { selector: '.sheet-sep' }).length).toBeGreaterThan(0);
  });

  it('is offered as an action of the ⋯ menu', () => {
    render(<ModeBar />);
    act(() => screen.getByRole('button', { name: 'Más opciones' }).click());
    act(() => screen.getByRole('menuitem', { name: 'Atajos de teclado' }).click());
    expect(useSimStore.getState().ui.shortcutsOpen).toBe(true);
  });
});
