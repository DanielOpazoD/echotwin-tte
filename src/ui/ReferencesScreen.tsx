import { GUIDELINE_REFERENCES } from '@/clinical/guidelines/references';
import { SHORTCUTS } from '@/app/shortcuts';

/** What each module that cites a source is called on screen; the keys are the code's (decision 259). */
export const USED_BY_LABEL: Readonly<Record<string, string>> = {
  'acquisition-protocol': 'protocolo de adquisición',
  'aortic-stenosis-grading': 'grados de estenosis aórtica',
  'artifact-engine': 'motor de artefactos',
  'artifact-lab': 'laboratorio de artefactos',
  'chamber-dimensions': 'dimensiones de las cavidades',
  'continuity-equation': 'ecuación de continuidad',
  'diastolic-function': 'función diastólica',
  impression: 'impresión clínica',
  'measurement-sites': 'sitios de medición',
  'myocardial-segmentation': 'segmentación miocárdica',
  'prosthetic valves (future)': 'prótesis valvulares (pendiente)',
  'rap-estimation': 'presión de la aurícula derecha',
  'reference-values': 'valores de referencia',
  'regurgitation (future)': 'insuficiencias valvulares (pendiente)',
  reporting: 'informe',
  'right-heart': 'corazón derecho',
  'segment-catalog': 'catálogo de segmentos',
  'segment-catalog (LV 18, strain: future)':
    'catálogo de segmentos (VI de 18 segmentos; strain pendiente)',
  simpson: 'método de Simpson',
  'strain (future)': 'strain (pendiente)',
  'view-targets': 'vistas',
  'wall-motion-scoring': 'puntuación de la motilidad',
};
const VERIFICATION_LABEL: Readonly<Record<string, string>> = {
  'verified-online': 'verificada en línea',
  'title-verified': 'título verificado',
  'not-verified': 'sin verificar',
};

export function ReferencesScreen() {
  return (
    <div className="screen">
      <h2>Referencias clínicas y técnicas</h2>
      <p className="small">
        Cada regla clínica del simulador apunta a una de estas fuentes (id, sociedad, año, módulo
        que la usa, fecha de última revisión). Los valores de corte viven en{' '}
        <code>src/clinical/reference-values</code> como datos versionados; no se copian tablas
        completas de las guías.
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
              <td>{r.usedBy.map((u) => USED_BY_LABEL[u] ?? u).join(', ')}</td>
              <td>{r.accessedAt}</td>
              <td>
                <span className={`pill ${r.verification === 'verified-online' ? 'ok' : 'warn'}`}>
                  {VERIFICATION_LABEL[r.verification] ?? r.verification}
                </span>
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
