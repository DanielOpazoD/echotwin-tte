// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { TorsoView } from './TorsoView';

beforeAll(() => {
  // jsdom has neither WebGL nor ResizeObserver: the navigator must survive the first and the cut map needs the second
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Without WebGL the 3D navigator gives way to a notice instead of taking the app down (decision 154). */
describe('TorsoView without WebGL', () => {
  it('renders a notice in place of the 3D view and does not throw', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<TorsoView />)).not.toThrow();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('El navegador 3D necesita WebGL');
    expect(alert.textContent).toContain('La imagen ecográfica');
    // the rest of the navigator (tools, cut map caption) is still there
    expect(screen.getByRole('button', { name: 'Acercar' })).toBeTruthy();
  });
});
