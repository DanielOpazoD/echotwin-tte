import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Keeps a failing part of the interface from taking the whole app down (decision 154). React unmounts the entire root
 * on an error no boundary catches: until then a browser without WebGL lost the ultrasound image too, because the 3D
 * navigator failed to create its context. The boundary shows what failed, in words, and lets the learner retry; the
 * detail goes to the console, not to the screen.
 */
export class ErrorBoundary extends Component<
  { label: string; children: ReactNode },
  { error: Error | null }
> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`${this.props.label}: fallo de la interfaz`, error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="panel-error" role="alert">
        <b>{this.props.label} no está disponible.</b>
        <span>{firstLine(error.message)}</span>
        <span className="small">El resto del simulador sigue funcionando.</span>
        <button onClick={() => this.setState({ error: null })}>Reintentar</button>
      </div>
    );
  }
}

/** The first line of a message, without a stack trace or a wall of detail. */
export function firstLine(message: string): string {
  const line = message.split('\n')[0]?.trim() ?? '';
  return line.length > 180 ? `${line.slice(0, 177)}…` : line;
}
