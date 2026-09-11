import { GUIDELINE_REFERENCES } from '@/clinical/guidelines/references';
import { SHORTCUTS } from '@/app/shortcuts';

export function ReferencesScreen() {
  return (
    <div className="screen">
      <h2>Referencias clínicas y técnicas</h2>
      <p className="small">
        Cada regla clínica del simulador apunta a una de estas fuentes (id, sociedad, año, módulo que la usa, fecha de última revisión). Los valores de corte
        viven en <code>src/clinical/reference-values</code> como datos versionados; no se copian tablas completas de las guías.
      </p>
      <table>
        <thead>
          <tr>
            <th>Id</th>
            <th>Documento</th>
            <th>Sociedad</th>
            <th>Año</th>
            <th>Usado por</th>
            <th>Revisado</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>
          {GUIDELINE_REFERENCES.map((r) => (
            <tr key={r.id}>
              <td>
                <code>{r.id}</code>
              </td>
              <td>
                <a href={r.url} target="_blank" rel="noreferrer">
                  {r.title}
                </a>
                {r.notes ? <div className="small">{r.notes}</div> : null}
              </td>
              <td>{r.society}</td>
              <td>{r.year}</td>
              <td>{r.usedBy.join(', ')}</td>
              <td>{r.accessedAt}</td>
              <td>
                <span className={`pill ${r.verification === 'verified-online' ? 'ok' : 'warn'}`}>{r.verification}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2 style={{ marginTop: 28 }}>Atajos de teclado</h2>
      <table>
        <tbody>
          {SHORTCUTS.map((s) => (
            <tr key={s.keys}>
              <td>
                <code>{s.keys}</code>
              </td>
              <td>{s.action}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
