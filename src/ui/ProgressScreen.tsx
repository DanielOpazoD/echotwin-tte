import { useSimStore } from '@/app/store';
import { exportProgressJson, summarizeProgress } from '@/education/progress';
import { VIEW_TARGETS } from '@/simulator/windows/viewDefinitions';

/** Local learning analytics (proposal 7): everything stays in this browser; export is a file the learner downloads. */
export function ProgressScreen() {
  const s = useSimStore();
  const sum = summarizeProgress(s.progress);
  const exportJson = () => {
    const blob = new Blob([exportProgressJson(s.progress, '0.1.0')], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `echotwin-progreso-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className="screen progress">
      <h2>Progreso (local)</h2>
      <p className="small">
        Los datos viven sólo en este navegador (localStorage); no se envían a ningún servidor.
        Puedes exportarlos como JSON anónimo para el protocolo de validación o borrarlos.
      </p>
      <div className="row">
        <span className="pill">{sum.completedTasks} tareas</span>
        <span className="pill">{sum.measurementsCount} mediciones</span>
        <span className="pill">{sum.casesOpened.length} casos abiertos</span>
        <span className="pill" data-mean-technique={sum.meanTechniqueScore ?? ''}>
          técnica media{' '}
          {sum.meanTechniqueScore !== null ? Math.round(sum.meanTechniqueScore * 100) : '—'}/100
        </span>
      </div>
      <h3>Mejor puntuación por vista</h3>
      <table>
        <thead>
          <tr>
            <th>Vista</th>
            <th>Mejor score</th>
            <th>Intentos registrados</th>
          </tr>
        </thead>
        <tbody>
          {VIEW_TARGETS.map((v) => (
            <tr key={v.id} data-progress-view={v.id}>
              <td>{v.name}</td>
              <td>{sum.bestViewScores[v.id] ?? '—'}</td>
              <td>{sum.viewAttempts[v.id] ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Exámenes</h3>
      {sum.exams.length === 0 ? (
        <p className="small">Sin exámenes finalizados.</p>
      ) : (
        <ul>
          {sum.exams.map((e, i) => (
            <li key={i}>
              {new Date(e.t).toLocaleString()} · {e.caseId} · {e.total}/100
            </li>
          ))}
        </ul>
      )}
      <h3>Tendencia de técnica</h3>
      {sum.techniqueTrend.length === 0 ? (
        <p className="small">Todavía no hay mediciones del protocolo.</p>
      ) : (
        <svg width="360" height="80" role="img" aria-label="Tendencia de la puntuación de técnica">
          <rect x="0" y="0" width="360" height="80" fill="#0f151d" />
          {sum.techniqueTrend.map((p, i) => (
            <circle
              key={i}
              cx={10 + (i * 340) / Math.max(1, sum.techniqueTrend.length - 1)}
              cy={70 - p.score * 60}
              r="3"
              fill={p.score >= 0.75 ? '#57d38c' : p.score >= 0.5 ? '#ffc857' : '#ff7b7b'}
            />
          ))}
        </svg>
      )}
      <div className="row" style={{ marginTop: 12 }}>
        <button onClick={exportJson}>Exportar JSON anónimo</button>
        <button
          onClick={() => {
            if (window.confirm('¿Borrar todo el progreso local?')) s.resetLearningProgress();
          }}
        >
          Borrar progreso
        </button>
      </div>
    </div>
  );
}
