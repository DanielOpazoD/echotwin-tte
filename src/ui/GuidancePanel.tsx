import { useHudStore, useSimStore } from '@/app/store';
import { modePolicy } from '@/app/modePolicy';
import { getViewTarget } from '@/simulator/windows/viewDefinitions';
import { explainAnalysis } from '@/education/causes';

/**
 * Left-bottom guidance (spec 27.2, 52), layered by how actionable each part is: the score, the
 * recognised view and the hints stay visible; the component breakdown and landmark lists collapse
 * under «Detalles», the causal explanations under «Por qué».
 */
/** What replaces the guidance in exam mode. Rendered by the app where the learner can see it, rail or no rail. */
export function ExamNotice() {
  return (
    <div className="guidance exam-notice">
      <div className="small">
        Modo examen: sin ayudas de vista ni verdad de terreno. Adquiere, mide e informa; la
        puntuación se entrega al final.
      </div>
    </div>
  );
}

export function GuidancePanel() {
  const hud = useHudStore((h) => h.hud);
  const ui = useSimStore((s) => s.ui);
  const mode = useSimStore((s) => s.mode);
  const targetId = useSimStore((s) => s.targetViewId);
  const settings = useSimStore((s) => s.settings);
  const v = hud?.view;
  if (!modePolicy(mode).hintsEnabled) return <ExamNotice />;
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
  const targetHints = targetId ? getViewTarget(targetId).hints : [];
  return (
    <div className="guidance" aria-live="polite">
      <div className="score">
        <span className="score-ring" style={{ color }} aria-hidden="true">
          <svg viewBox="0 0 46 46" width="46" height="46">
            <circle className="track" cx="23" cy="23" r="19" />
            <circle
              className="fill"
              cx="23"
              cy="23"
              r="19"
              strokeDasharray={2 * Math.PI * 19}
              strokeDashoffset={2 * Math.PI * 19 * (1 - Math.max(0, Math.min(100, v.score)) / 100)}
            />
          </svg>
          <b style={{ color }}>{v.score}</b>
        </span>
        <span>
          {v.bestViewName}
          <br />
          <span className="small">
            ventana: {v.window}
            {v.foreshorteningDeg > 0.5 ? ` · acort. ${v.foreshorteningDeg.toFixed(0)}°` : ''}
          </span>
        </span>
      </div>
      <div className="bar scorebar">
        <i style={{ width: `${v.score}%`, background: color }} />
      </div>
      {targetId && (
        <div className="small target">
          Objetivo: {getViewTarget(targetId).name} · {targetScore ?? '—'}/100
        </div>
      )}
      {ui.showHints && (
        <>
          {v.hints.length + targetHints.length > 0 && (
            <ul className="hints">
              {v.hints.map((h, i) => (
                <li key={i}>{h}</li>
              ))}
              {targetHints.map((h, i) => (
                <li key={'t' + i}>{h}</li>
              ))}
            </ul>
          )}
          <details className="adv">
            <summary>Detalles</summary>
            <div className="comp">
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
          </details>
          {causes.length > 0 && (
            <details className="adv causes">
              <summary>Por qué ({causes.length})</summary>
              {causes.map((c) => (
                <div key={c.code} className="small cause" data-cause={c.code}>
                  <b>Causa:</b> {c.cause} <b>Efecto:</b> {c.effect} <b>Remedio:</b> {c.remedy}
                </div>
              ))}
            </details>
          )}
        </>
      )}
    </div>
  );
}
