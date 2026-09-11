import { useSimStore } from '@/app/store';
import { formatClinical } from '@/clinical/reference-values';
import { buildEducationalReport } from '@/clinical/reporting/report';
import { buildExamSummary, scoreAcquisition } from '@/education/scoring/scoring';
import { loadCaseById } from '@/cases';

/** Educational structured report (spec 26) + exam summary (spec 28.4). Learning mode shows ground truth; exam mode hides it until finished. */
export function ReportScreen() {
  const s = useSimStore();
  const hideTruth = s.mode === 'exam' && !s.examFinished;
  const report = buildEducationalReport(s.measurements, s.truth, hideTruth);
  const caseDef = loadCaseById(s.caseId);
  const acquisition = scoreAcquisition(caseDef, s.viewProgress);
  const summary = s.truth && (s.mode !== 'exam' || s.examFinished) ? buildExamSummary(caseDef, s.truth, s.viewProgress, s.measurements) : null;
  return (
    <div className="screen">
      <h2>Informe educacional — {s.caseId}</h2>
      <p className="small">Simulador educacional con pacientes sintéticos. No utilizar para diagnóstico ni toma de decisiones clínicas reales.</p>
      {s.mode === 'exam' && !s.examFinished && (
        <p>
          <button onClick={() => s.finishExam()}>Finalizar examen y ver puntuación</button>
        </p>
      )}
      <h3>Vistas requeridas</h3>
      <table>
        <thead>
          <tr>
            <th>Vista</th>
            <th>Mínimo</th>
            <th>Mejor score alcanzado</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>
          {acquisition.perView.map((v) => (
            <tr key={v.viewId}>
              <td>{v.viewId.toUpperCase()}</td>
              <td>{v.required}</td>
              <td>{v.achieved}</td>
              <td>
                <span className={`pill ${v.ok ? 'ok' : 'warn'}`}>{v.ok ? 'ok' : v.achieved ? 'incompleta' : 'no adquirida'}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Calidad del estudio</h3>
      <p>{report.studyQuality}</p>
      {report.derived.length > 0 && (
        <>
          <h3>Cálculos derivados de tus mediciones</h3>
          <table>
            <thead>
              <tr>
                <th>Cálculo</th>
                <th>Valor</th>
                <th>Fórmula</th>
                <th>Entradas</th>
              </tr>
            </thead>
            <tbody>
              {report.derived.map((d) => (
                <tr key={d.id} data-derived={d.id}>
                  <td>{d.label}</td>
                  <td>{d.value}</td>
                  <td>
                    <code>{d.formula}</code>
                  </td>
                  <td className="small">{d.inputs}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <h3>Mediciones adquiridas</h3>
      <table>
        <thead>
          <tr>
            <th>Medición</th>
            <th>Valor</th>
            <th>Modalidad / vista</th>
            <th>Calidad vista</th>
            <th>Técnica</th>
            {s.mode !== 'exam' && <th>Modelo (verdad)</th>}
            {s.mode !== 'exam' && <th>Desviación</th>}
          </tr>
        </thead>
        <tbody>
          {report.rows.map((r) => (
            <tr key={r.id} data-technique={r.technique?.level ?? 'free'}>
              <td>{r.label}</td>
              <td>{r.value}</td>
              <td>
                {r.modality}
                {r.view ? ` / ${r.view}` : ''}
              </td>
              <td>{r.viewScore ?? '—'}</td>
              <td>
                {r.technique ? (
                  <>
                    <span className={`pill ${r.technique.level === 'ok' ? 'ok' : r.technique.level === 'warn' ? 'warn' : 'bad'}`}>{r.technique.score}/100</span>
                    {r.technique.notes.length > 0 && (
                      <ul className="small technique-notes">
                        {r.technique.notes.map((n, i) => (
                          <li key={i}>{n}</li>
                        ))}
                      </ul>
                    )}
                  </>
                ) : (
                  <span className="small">libre</span>
                )}
              </td>
              {s.mode !== 'exam' && <td>{r.truth ?? '—'}</td>}
              {s.mode !== 'exam' && <td>{r.deviation ?? '—'}</td>}
            </tr>
          ))}
          {report.rows.length === 0 && (
            <tr>
              <td colSpan={7} className="small">
                Sin mediciones todavía.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {s.mode !== 'exam' && s.truth && (
        <>
          <h3>Resumen del modelo (solo aprendizaje)</h3>
          <ul>
            <li>
              VI: DTD {formatClinical(s.truth.lv.eddCm, 'linearCm')}, SIV {formatClinical(s.truth.lv.ivsdCm, 'linearCm')}, PP {formatClinical(s.truth.lv.lvpwdCm, 'linearCm')}, FEVI {formatClinical(s.truth.lv.efPct, 'percent')}, VS {formatClinical(s.truth.lv.strokeVolumeMl, 'volumeMl')}
            </li>
            <li>
              TSVI {formatClinical(s.truth.lvot.diameterCm, 'linearCm')} · VTI {formatClinical(s.truth.lvot.vtiCm, 'vtiCm')} · VAo Vmax {formatClinical(s.truth.aorticValve.vmaxMps, 'velocityMps')} · ΔP medio {formatClinical(s.truth.aorticValve.meanGradientMmHg, 'gradientMmHg')} · AVA {formatClinical(s.truth.aorticValve.continuityAvaCm2, 'areaCm2')}
            </li>
            <li>
              Mitral E {formatClinical(s.truth.mitral.ePeakMps, 'velocityMps')} · A {formatClinical(s.truth.mitral.aPeakMps, 'velocityMps')} · DT {formatClinical(s.truth.mitral.decelerationTimeMs, 'timeMs')} · E/e′ {s.truth.mitral.eOverEPrimeAvg.toFixed(1)}
            </li>
            <li>
              Derecho: TAPSE {formatClinical(s.truth.rightHeart.tapseCm, 'linearCm')} · TR Vmax {s.truth.rightHeart.trVmaxMps ? formatClinical(s.truth.rightHeart.trVmaxMps, 'velocityMps') : '—'} · RVSP {s.truth.rightHeart.rvspMmHg ? formatClinical(s.truth.rightHeart.rvspMmHg, 'gradientMmHg') : '—'}
            </li>
          </ul>
        </>
      )}
      <h3>Impresión</h3>
      <ul>
        {report.impression.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
      {summary && (
        <>
          <h3>Puntuación {s.mode === 'exam' ? 'del examen' : '(progreso)'}: {summary.total}/100</h3>
          <p className="small">
            Adquisición {summary.acquisition.total}/100 · Mediciones {summary.measurements.total}/100. Tolerancias y pesos en <code>src/education/scoring</code>.
          </p>
          <table>
            <thead>
              <tr>
                <th>Medición requerida</th>
                <th>Medida</th>
                <th>Modelo</th>
                <th>Error</th>
                <th>Vista</th>
                <th>Puntos</th>
                <th>Comentario</th>
              </tr>
            </thead>
            <tbody>
              {summary.measurements.rows.map((r) => (
                <tr key={r.measurementId}>
                  <td>{r.label}</td>
                  <td>{r.measured === null ? '—' : `${r.measured.toFixed(2)} ${r.units}`}</td>
                  <td>{`${r.truth.toFixed(2)} ${r.units}`}</td>
                  <td>{r.errorPct === null ? '—' : `${r.errorPct.toFixed(0)} %`}</td>
                  <td>{r.viewScore ?? '—'}</td>
                  <td>{r.points}</td>
                  <td className="small">{r.comment}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {summary.strengths.length > 0 && (
            <>
              <h4>Fortalezas</h4>
              <ul>{summary.strengths.map((x, i) => <li key={i}>{x}</li>)}</ul>
            </>
          )}
          {summary.mainErrors.length > 0 && (
            <>
              <h4>Errores principales</h4>
              <ul>{summary.mainErrors.map((x, i) => <li key={i}>{x}</li>)}</ul>
            </>
          )}
          {summary.recommendations.length > 0 && (
            <>
              <h4>Recomendaciones de práctica</h4>
              <ul>{summary.recommendations.map((x, i) => <li key={i}>{x}</li>)}</ul>
            </>
          )}
        </>
      )}
    </div>
  );
}
