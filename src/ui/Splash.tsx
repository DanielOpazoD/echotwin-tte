import { useEffect, useState } from 'react';
import { useHudStore, useSimStore } from '@/app/store';

/**
 * The start screen (decision 203): the mark and what is being readied — the simulation engine, the 3D navigator and
 * the first image — instead of a black canvas and «Iniciando…» in a corner. It leaves when the first frame arrives,
 * fading over 350 ms; the navigator may still be loading then, and its own placeholder says so in the rail.
 */
export function Splash() {
  const hud = useHudStore((h) => h.hud);
  const workerMode = useSimStore((s) => s.workerMode);
  const navigatorReady = useSimStore((s) => s.navigatorReady);
  const showTorso = useSimStore((s) => s.ui.showTorso && !s.ui.minimal);
  const error = useSimStore((s) => s.error);
  const [gone, setGone] = useState(false);
  const [waitedTooLong, setWaitedTooLong] = useState(false);
  // an error banner must never sit under the splash (decision 206): it leaves on the first frame, on an error, and
  // after 15 s whatever happens
  useEffect(() => {
    const id = window.setTimeout(() => setWaitedTooLong(true), 15_000);
    return () => window.clearTimeout(id);
  }, []);
  const leaving = hud !== null || error !== null || waitedTooLong;
  useEffect(() => {
    if (!leaving || gone) return;
    const id = window.setTimeout(() => setGone(true), 380);
    return () => window.clearTimeout(id);
  }, [leaving, gone]);
  if (gone) return null;
  const gpu = hud ? (hud.stats['gpu'] === 'ok' ? 'trazado en la GPU' : 'trazado en la CPU') : '';
  const rows: { label: string; done: boolean; detail?: string }[] = [
    {
      label: 'Motor de simulación',
      done: workerMode !== 'starting',
      detail: workerMode === 'inline' ? 'en el hilo de la interfaz' : undefined,
    },
    ...(showTorso ? [{ label: 'Navegador 3D', done: navigatorReady }] : []),
    { label: 'Primera imagen', done: hud !== null, detail: gpu || undefined },
  ];
  return (
    <div
      className={`splash${leaving ? ' leaving' : ''}`}
      role="status"
      aria-label="Arrancando"
      aria-hidden={leaving || undefined}
    >
      <div className="splash-card">
        <div className="splash-brand">
          <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
            <path
              d="M12 3 L20.5 18.5 A10 10 0 0 1 3.5 18.5 Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
            <path d="M12 3 v13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          EchoTwin <span className="splash-sub">TTE</span>
        </div>
        <ul className="splash-steps">
          {rows.map((r) => (
            <li key={r.label} className={r.done ? 'done' : ''}>
              <i aria-hidden="true" />
              <span>{r.label}</span>
              {r.detail && <span className="splash-detail">{r.detail}</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
