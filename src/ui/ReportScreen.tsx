import { useSimStore } from '@/app/store';
import { useShallow } from 'zustand/shallow';
import { formatClinical } from '@/clinical/reference-values';
import { buildEducationalReport } from '@/education/report';
import { buildExamSummary, scoreAcquisition } from '@/education/scoring/scoring';
import { loadCaseById } from '@/cases';
import {
  expectedFindings,
  FINDINGS,
  getFinding,
  scoreImpression,
  type FindingDomain,
} from '@/education/impression';

/** Educational structured report (spec 26) + exam summary (spec 28.4). Learning mode shows ground truth; exam mode hides it until finished. */
export function ReportScreen() {
  const s = useSimStore(
    useShallow((st) => ({
      caseId: st.caseId,
      examFinished: st.examFinished,
      finishExam: st.finishExam,
      impressionSelection: st.impressionSelection,
      measurements: st.measurements,
      mode: st.mode,
      toggleFinding: st.toggleFinding,
      truth: st.truth,
      viewProgress: st.viewProgress,
    })),
  );
  const hideTruth = s.mode === 'exam' && !s.examFinished;
  const report = buildEducationalReport(s.measurements, s.truth, hideTruth);
  const caseDef = loadCaseById(s.caseId);
  const acquisition = scoreAcquisition(caseDef, s.viewProgress);
  const expected = s.truth ? expectedFindings(s.truth) : [];
  const impression = s.impressionSelection.length
    ? scoreImpression(s.impressionSelection, expected)
    : null;
  const summary =
    s.truth && (s.mode !== 'exam' || s.examFinished)
      ? buildExamSummary(
          caseDef,
          s.truth,
          s.viewProgress,
          s.measurements,
          impression?.score ?? null,
        )
      : null;
  const domains: { id: FindingDomain; label: string }[] = [
    { id: 'global', label: 'Global' },
    { id: 'lv', label: 'Ventrículo izquierdo' },
    { id: 'valves', label: 'Válvulas y TSVI' },
    { id: 'right', label: 'Corazón derecho' },
    { id: 'atria', label: 'Aurículas' },
    { id: 'pericardium', label: 'Pericardio' },
    { id: 'rhythm-diastole', label: 'Ritmo y diástole' },
  ];
  const showImpressionTruth = s.mode !== 'exam' || s.examFinished;
  return (
    <div className="screen">
      <h2>Informe educacional — {s.caseId}</h2>
      <p className="small">
        Simulador educacional con pacientes sintéticos. No utilizar para diagnóstico ni toma de
        decisiones clínicas reales.
      </p>
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
            {/* the best score of each view would say which view the image showed (decision 154) */}
            {!hideTruth && <th>Mejor score alcanzado</th>}
            {!hideTruth && <th>Estado</th>}
          </tr>
        </thead>
        <tbody>
          {acquisition.perView.map((v) => (
            <tr key={v.viewId}>
              <td>{v.viewId.toUpperCase()}</td>
              <td>{v.required}</td>
              {!hideTruth && <td>{v.achieved}</td>}
              {!hideTruth && (
                <td>
                  <span className={`pill ${v.ok ? 'ok' : 'warn'}`}>
                    {v.ok ? 'ok' : v.achieved ? 'incompleta' : 'no adquirida'}
                  </span>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Impresión estructurada</h3>
      <p className="small">
        Marca los hallazgos que sustentan tu impresión. Se comparan con los que el modelo del caso
        implica (umbrales de las guías); la puntuación es la F1 entre ambos conjuntos.
      </p>
      <div className="impression-form" data-impression-score={impression?.score ?? ''}>
        {domains.map((d) => (
          <fieldset key={d.id}>
            <legend className="small">{d.label}</legend>
            {FINDINGS.filter((f) => f.domain === d.id).map((f) => {
              const checked = s.impressionSelection.includes(f.id);
              const isExpected = expected.includes(f.id);
              const cls =
                showImpressionTruth && s.impressionSelection.length
                  ? checked && isExpected
                    ? 'ok'
                    : checked && !isExpected
                      ? 'bad'
                      : !checked && isExpected
                        ? 'missed'
                        : ''
                  : '';
              return (
                <label key={f.id} className={`finding ${cls}`} data-finding={f.id}>
                  <input type="checkbox" checked={checked} onChange={() => s.toggleFinding(f.id)} />
                  {f.label}
                </label>
              );
            })}
          </fieldset>
        ))}
      </div>
      {impression && showImpressionTruth && (
        <p data-impression-result="1">
          Impresión: <b>{impression.score}/100</b> · correctos {impression.correct.length} ·
          omitidos {impression.missed.length} · sobrantes {impression.wrong.length}
          {impression.missed.length > 0 && (
            <span className="small">
              {' '}
              — omitidos: {impression.missed.map((id) => getFinding(id)?.label ?? id).join('; ')}
            </span>
          )}
        </p>
      )}
      {impression && !showImpressionTruth && (
        <p className="small">
          Impresión registrada ({s.impressionSelection.length} hallazgos); se evalúa al finalizar el
          examen.
        </p>
      )}
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
            <th>Rango normal</th>
            <th>{hideTruth ? 'Modalidad' : 'Modalidad / vista'}</th>
            {!hideTruth && <th>Calidad vista</th>}
            {!hideTruth && <th>Técnica</th>}
            {s.mode !== 'exam' && <th>Modelo (verdad)</th>}
            {s.mode !== 'exam' && <th>Desviación</th>}
          </tr>
        </thead>
        <tbody>
          {report.rows.map((r) => (
            <tr key={r.id} data-technique={r.technique?.level ?? 'free'}>
              <td>{r.label}</td>
              <td>{r.value}</td>
              <td data-range-flag={r.rangeFlag ?? 'none'}>
                {r.range ? (
                  <>
                    {r.range}{' '}
                    {r.rangeFlag === 'normal' ? (
                      <span className="pill ok">normal</span>
                    ) : (
                      <span className="pill warn">{r.rangeFlag === 'high' ? 'alto' : 'bajo'}</span>
                    )}
                  </>
                ) : (
                  '—'
                )}
              </td>
              <td>
                {r.modality}
                {r.view ? ` / ${r.view}` : ''}
              </td>
              {!hideTruth && <td>{r.viewScore ?? '—'}</td>}
              {!hideTruth && (
                <td>
                  {r.technique ? (
                    <>
                      <span
                        className={`pill ${r.technique.level === 'ok' ? 'ok' : r.technique.level === 'warn' ? 'warn' : 'bad'}`}
                      >
                        {r.technique.score}/100
                      </span>
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
              )}
              {s.mode !== 'exam' && <td>{r.truth ?? '—'}</td>}
              {s.mode !== 'exam' && <td>{r.deviation ?? '—'}</td>}
            </tr>
          ))}
          {report.rows.length === 0 && (
            <tr>
              <td colSpan={8} className="small">
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
              VI: DTD {formatClinical(s.truth.lv.eddCm, 'linearCm')}, SIV{' '}
              {formatClinical(s.truth.lv.ivsdCm, 'linearCm')}, PP{' '}
              {formatClinical(s.truth.lv.lvpwdCm, 'linearCm')}, FEVI{' '}
              {formatClinical(s.truth.lv.efPct, 'percent')}, VS{' '}
              {formatClinical(s.truth.lv.strokeVolumeMl, 'volumeMl')}
            </li>
            <li>
              TSVI {formatClinical(s.truth.lvot.diameterCm, 'linearCm')} · VTI{' '}
              {formatClinical(s.truth.lvot.vtiCm, 'vtiCm')} · VAo Vmax{' '}
              {formatClinical(s.truth.aorticValve.vmaxMps, 'velocityMps')} · ΔP medio{' '}
              {formatClinical(s.truth.aorticValve.meanGradientMmHg, 'gradientMmHg')} · AVA{' '}
              {formatClinical(s.truth.aorticValve.continuityAvaCm2, 'areaCm2')}
            </li>
            <li>
              Mitral E {formatClinical(s.truth.mitral.ePeakMps, 'velocityMps')} · A{' '}
              {formatClinical(s.truth.mitral.aPeakMps, 'velocityMps')} · DT{' '}
              {formatClinical(s.truth.mitral.decelerationTimeMs, 'timeMs')} · E/e′{' '}
              {s.truth.mitral.eOverEPrimeAvg.toFixed(1)}
            </li>
            <li>
              Derecho: TAPSE {formatClinical(s.truth.rightHeart.tapseCm, 'linearCm')} · TR Vmax{' '}
              {s.truth.rightHeart.trVmaxMps
                ? formatClinical(s.truth.rightHeart.trVmaxMps, 'velocityMps')
                : '—'}{' '}
              · RVSP{' '}
              {s.truth.rightHeart.rvspMmHg
                ? formatClinical(s.truth.rightHeart.rvspMmHg, 'gradientMmHg')
                : '—'}
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
          <h3>
            Puntuación {s.mode === 'exam' ? 'del examen' : '(progreso)'}: {summary.total}/100
          </h3>
          <p className="small">
            Adquisición {summary.acquisition.total}/100 · Mediciones {summary.measurements.total}
            /100{summary.impression !== null ? ` · Impresión ${summary.impression}/100` : ''}.
            Tolerancias y pesos en <code>src/education/scoring</code>.
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
              <ul>
                {summary.strengths.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </>
          )}
          {summary.mainErrors.length > 0 && (
            <>
              <h4>Errores principales</h4>
              <ul>
                {summary.mainErrors.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </>
          )}
          {summary.recommendations.length > 0 && (
            <>
              <h4>Recomendaciones de práctica</h4>
              <ul>
                {summary.recommendations.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}
