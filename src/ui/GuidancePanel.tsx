import { useHudStore, useSimStore } from '@/app/store';
import { modePolicy } from '@/app/modePolicy';
import { getViewTarget } from '@/simulator/windows/viewTargets';
import { explainAnalysis } from '@/education/causes';

/** Left-bottom guidance: recognised view, score components and deterministic hints (spec 27.2, 52). */
export function GuidancePanel() {
  const hud = useHudStore((h) => h.hud);
  const ui = useSimStore((s) => s.ui);
  const mode = useSimStore((s) => s.mode);
  const targetId = useSimStore((s) => s.targetViewId);
  const settings = useSimStore((s) => s.settings);
  const v = hud?.view;
  if (!modePolicy(mode).hintsEnabled) {
    return (
      <div className="guidance">
        <div className="small">
          Modo examen: sin ayudas de vista ni verdad de terreno. Adquiere, mide e informa; la
          puntuación se entrega al final.
        </div>
      </div>
    );
  }
  if (!v) return <div className="guidance small">Analizando vista…</div>;
  const targetScore = targetId ? v.perView.find((p) => p.id === targetId)?.score : undefined;
  const comps = v.components;
  const bars: [string, number][] = [
    ['Plano', comps.plane],
    ['Referencias', comps.landmarks],
    ['Geometría', comps.geometry],
    ['Centrado', comps.centering],
    ['Profundidad', comps.depth],
    ['Ganancia', comps.gain],
    ['Artefactos', comps.artifacts],
  ];
  const color = v.score >= 75 ? 'var(--ok)' : v.score >= 50 ? 'var(--warn)' : 'var(--bad)';
  const causes = ui.showHints ? explainAnalysis(v, settings) : [];
  return (
    <div className="guidance" aria-live="polite">
      <div className="score">
        <b style={{ color }}>{v.score}</b>
        <span>
          {v.bestViewName}
          <br />
          <span className="small">
            ventana: {v.window}
            {v.foreshorteningDeg > 0.5 ? ` · acortamiento ${v.foreshorteningDeg.toFixed(0)}°` : ''}
          </span>
        </span>
      </div>
      {targetId && (
        <div className="small" style={{ marginTop: 4 }}>
          Objetivo: {getViewTarget(targetId).name} — {targetScore ?? '—'} / 100
        </div>
      )}
      {ui.showHints && (
        <>
          <div className="comp" style={{ marginTop: 6 }}>
            {bars.map(([label, val]) => (
              <div key={label} style={{ gridColumn: '1 / -1' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>{label}</span>
                  <span>{Math.round(val * 100)}</span>
                </div>
                <div className="bar">
                  <i style={{ width: `${Math.round(val * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
          <div className="small">
            Visibles: {v.visibleLandmarks.length ? v.visibleLandmarks.join(', ') : '—'}
            {v.missingLandmarks.length ? ` · faltan: ${v.missingLandmarks.join(', ')}` : ''}
          </div>
          <ul>
            {v.hints.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ul>
          {causes.length > 0 && (
            <details className="causes" open={false}>
              <summary className="small">Por qué ({causes.length})</summary>
              {causes.map((c) => (
                <div key={c.code} className="small cause" data-cause={c.code}>
                  <b>Causa:</b> {c.cause} <b>Efecto:</b> {c.effect} <b>Remedio:</b> {c.remedy}
                </div>
              ))}
            </details>
          )}
          {targetId && (
            <ul>
              {getViewTarget(targetId).hints.map((h, i) => (
                <li key={'t' + i} className="small">
                  {h}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
