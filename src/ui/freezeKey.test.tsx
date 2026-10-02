// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { typesText, useShortcuts } from '@/app/shortcuts';
import { useSimStore } from '@/app/store';
import { RotationDial } from './RotationDial';

const initialSim = useSimStore.getState();

/** A side panel, a tab, a cine slider, a checkbox, the dial and the fields where Space is typed. */
function Harness({ onSegment }: { onSegment: () => void }): React.JSX.Element {
  useShortcuts();
  return (
    <div>
      <aside className="right">
        <div role="tablist">
          <button role="tab">Adquirir</button>
        </div>
        <button onClick={() => useSimStore.getState().setUi({ showTorso: false })}>Torso 3D</button>
        <input type="range" aria-label="Cine" />
        <input type="checkbox" aria-label="Hallazgo" />
        <svg>
          <g
            role="button"
            tabIndex={0}
            aria-label="Segmento 1"
            onKeyDown={(e) => {
              if (e.key === ' ' || e.key === 'Enter') onSegment();
            }}
          />
        </svg>
      </aside>
      <RotationDial />
      <input type="text" aria-label="Nota" />
      <input type="search" aria-label="Buscar" />
      <textarea aria-label="Informe" />
      <div contentEditable aria-label="Editable" role="textbox" />
      <select aria-label="Modo">
        <option>Sandbox</option>
      </select>
    </div>
  );
}

const frozen = () => useSimStore.getState().frozen;
/** Space pressed on an element: whether the browser's default action was left to run. */
const space = (el: Element | Document, init: Partial<KeyboardEventInit> = {}) =>
  fireEvent.keyDown(el, { key: ' ', code: 'Space', ...init });

beforeEach(() => useSimStore.setState(initialSim, true));
afterEach(() => cleanup());

/**
 * Space freezes and resumes the scanner from anywhere in the program (decision 244), once, and takes the key: the
 * focused button is not pressed by it and the page does not scroll. Only a field where text is typed keeps it.
 */
describe('the freeze key', () => {
  it('toggles from the body, a panel button, a tab, the cine slider, a checkbox and the dial', () => {
    const onSegment = vi.fn();
    render(<Harness onSegment={onSegment} />);
    const targets: [string, Element][] = [
      ['the body', document.body],
      ['a side-panel button', screen.getByRole('button', { name: 'Torso 3D' })],
      ['a tab', screen.getByRole('tab')],
      ['the cine slider', screen.getByRole('slider', { name: 'Cine' })],
      ['a checkbox', screen.getByRole('checkbox')],
      ['the rotation dial', screen.getByRole('slider', { name: /Rotación de la sonda/ })],
      ['a segment of the polar map', screen.getByRole('button', { name: 'Segmento 1' })],
    ];
    for (const [where, el] of targets) {
      const before = frozen();
      const defaultRan = space(el);
      expect(frozen(), where).toBe(!before);
      expect(defaultRan, `${where}: the key's default is taken`).toBe(false);
    }
    // one handler: no widget saw the key, and the button was not pressed by it
    expect(onSegment).not.toHaveBeenCalled();
    expect(useSimStore.getState().ui.showTorso).toBe(initialSim.ui.showTorso);
  });

  it('toggles on any screen, not only the simulator', () => {
    render(<Harness onSegment={() => {}} />);
    for (const screenId of ['report', 'curriculum', 'progress', 'references'] as const) {
      useSimStore.getState().setUi({ screen: screenId });
      const before = frozen();
      space(document.body);
      expect(frozen(), screenId).toBe(!before);
    }
  });

  it('types a space in a text field, a text area, an editable element and leaves a select alone', () => {
    render(<Harness onSegment={() => {}} />);
    for (const name of ['Nota', 'Buscar', 'Informe']) {
      const el = screen.getByRole(name === 'Buscar' ? 'searchbox' : 'textbox', { name });
      expect(space(el), name).toBe(true);
    }
    const editable = screen.getByRole('textbox', { name: 'Editable' });
    // jsdom does not implement isContentEditable
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    expect(space(editable)).toBe(true);
    expect(space(screen.getByRole('combobox', { name: 'Modo' }))).toBe(true);
    expect(frozen()).toBe(initialSim.frozen);
    expect(typesText(screen.getByRole('slider', { name: 'Cine' }))).toBe(false);
    expect(typesText(screen.getByRole('textbox', { name: 'Nota' }))).toBe(true);
  });

  it('toggles once while the key is held, and leaves Space with a modifier alone', () => {
    render(<Harness onSegment={() => {}} />);
    const before = frozen();
    space(document.body);
    space(document.body, { repeat: true });
    space(document.body, { repeat: true });
    expect(frozen()).toBe(!before);
    expect(fireEvent.keyUp(document.body, { key: ' ', code: 'Space' })).toBe(false);
    space(document.body, { ctrlKey: true });
    space(document.body, { metaKey: true });
    expect(frozen()).toBe(!before);
  });
});
