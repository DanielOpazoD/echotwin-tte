// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ErrorBoundary, firstLine } from './ErrorBoundary';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

let explode = true;
function Fragile() {
  if (explode)
    throw new Error('THREE.WebGLRenderer: Error creating WebGL context.\n    at stack line');
  return <p>recuperado</p>;
}

/** A failing part of the interface stays contained (decision 154). */
describe('ErrorBoundary', () => {
  it('shows what failed in words, keeps its siblings and can retry', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    explode = true;
    render(
      <div>
        <ErrorBoundary label="El navegador 3D">
          <Fragile />
        </ErrorBoundary>
        <p>imagen ecográfica</p>
      </div>,
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('El navegador 3D no está disponible.');
    expect(alert.textContent).toContain('Error creating WebGL context.');
    expect(alert.textContent).not.toContain('stack line');
    expect(screen.getByText('imagen ecográfica')).toBeTruthy();
    explode = false;
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(screen.getByText('recuperado')).toBeTruthy();
  });

  it('contains a thrown value that is not an Error', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const Throws = () => {
      throw 'sin contexto'; // eslint-disable-line @typescript-eslint/only-throw-error
    };
    render(
      <ErrorBoundary label="El informe">
        <Throws />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert').textContent).toContain('sin contexto');
  });

  it('keeps only the first line of a message, and not too long', () => {
    expect(firstLine('uno\ndos')).toBe('uno');
    expect(firstLine('x'.repeat(400)).length).toBe(178);
  });
});
