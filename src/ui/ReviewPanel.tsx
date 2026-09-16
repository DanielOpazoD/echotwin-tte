import { useState } from 'react';
import { useHudStore, useSimStore } from '@/app/store';
import { useShallow } from 'zustand/shallow';
import { buildInput } from '@/app/useSimulation';
import { displayPngBlob, exportDisplayPng } from '@/app/exportImage';
import {
  buildReviewReport,
  markerPlace,
  parseReviewReport,
  reportToMarkdown,
  REVIEW_CATEGORIES,
  type ReviewCategory,
} from '@/app/review';
import { listCases } from '@/cases';
import { Section } from './controls';

/**
 * Review mode console (decision 134): the markers placed on the image with what the model holds under each
 * one, a note per marker and a general note, and the report as text ready to paste into a conversation with
 * whoever changes the model. The same panel loads a report back (pasted text) and restores its state.
 */
export function ReviewPanel() {
  const s = useSimStore(
    useShallow((st) => ({
      caseId: st.caseId,
      mode: st.mode,
      workerMode: st.workerMode,
      markers: st.reviewMarkers,
      note: st.reviewNote,
      setUi: st.setUi,
      updateReviewMarker: st.updateReviewMarker,
      removeReviewMarker: st.removeReviewMarker,
      clearReview: st.clearReview,
      setReviewNote: st.setReviewNote,
      loadReviewReport: st.loadReviewReport,
    })),
  );
  const [preview, setPreview] = useState('');
  const [status, setStatus] = useState('');
  const [pasted, setPasted] = useState('');

  const report = () => {
    const hud = useHudStore.getState().hud;
    const display = hud ? { width: hud.width, height: hud.height } : { width: 640, height: 520 };
    const caseTitle = listCases().find((c) => c.id === s.caseId)?.title ?? s.caseId;
    return buildReviewReport({
      caseId: s.caseId,
      caseTitle,
      mode: s.mode,
      workerMode: s.workerMode,
      input: buildInput(display),
      hud,
      note: s.note,
      markers: s.markers,
      url: typeof location !== 'undefined' ? location.href : '',
    });
  };

  const copyReport = async () => {
    const md = reportToMarkdown(report());
    setPreview(md);
    try {
      await navigator.clipboard.writeText(md);
      setStatus('Informe copiado al portapapeles: pégalo en el chat.');
    } catch {
      setStatus('El navegador no dejó copiar: selecciona el texto de abajo y cópialo a mano.');
    }
  };

  const copyImage = async () => {
    const blob = await displayPngBlob();
    if (!blob) return setStatus('No hay imagen que copiar.');
    try {
      const item = new ClipboardItem({ 'image/png': blob });
      await navigator.clipboard.write([item]);
      setStatus('Imagen copiada al portapapeles (con los marcadores).');
    } catch {
      exportDisplayPng(s.caseId);
      setStatus('El navegador no dejó copiar la imagen: se descargó como PNG.');
    }
  };

  const load = () => {
    const r = parseReviewReport(pasted);
    if (!r) return setStatus('No reconozco un informe en el texto pegado (falta el bloque JSON).');
    s.loadReviewReport(r);
    setPasted('');
    setStatus(
      `Informe cargado: ${r.markers.length} marcador(es) de ${r.author === 'claude' ? 'Claude' : 'usuario'} sobre ${r.caseId}.`,
    );
  };

  return (
    <>
      <Section title="Modo revisión">
        <p className="small">
          Clic sobre la imagen deja un marcador numerado con lo que el modelo tiene debajo.
          Shift+clic usa la herramienta normal. Escribe qué ves mal en cada marcador, copia el
          informe y pégalo en el chat: incluye el estado exacto para reproducir el cuadro.
        </p>
        <div className="review-actions">
          <button className="primary" onClick={() => void copyReport()}>
            Copiar informe
          </button>
          <button onClick={() => void copyImage()}>Copiar imagen</button>
          <button onClick={() => exportDisplayPng(s.caseId)}>Descargar PNG</button>
          <button
            onClick={() => s.clearReview()}
            disabled={!s.markers.length && !s.note}
            aria-label="Borrar marcadores y nota"
          >
            Limpiar
          </button>
          <button
            onClick={() => s.setUi({ reviewMode: false, consoleTab: 'adquirir' })}
            aria-label="Salir del modo revisión"
          >
            Salir
          </button>
        </div>
        {status && (
          <div className="review-status" role="status">
            {status}
          </div>
        )}
      </Section>
      <Section title="Nota general">
        <textarea
          className="review-note"
          aria-label="Nota general de la revisión"
          placeholder="¿Qué ves mal en esta imagen en conjunto? (opcional)"
          value={s.note}
          onChange={(e) => s.setReviewNote(e.target.value)}
        />
      </Section>
      <Section title={`Marcadores (${s.markers.length})`}>
        {s.markers.length === 0 && (
          <div className="small">Sin marcadores. Haz clic sobre la imagen para señalar algo.</div>
        )}
        <div className="review-list">
          {s.markers.map((m) => (
            <div key={m.id} className="review-item" data-marker={m.n}>
              <div className="review-head">
                <span className="review-n" aria-hidden="true">
                  {m.n}
                </span>
                <select
                  aria-label={`Categoría del marcador ${m.n}`}
                  value={m.category}
                  onChange={(e) =>
                    s.updateReviewMarker(m.id, { category: e.target.value as ReviewCategory })
                  }
                >
                  {REVIEW_CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <button
                  aria-label={`Eliminar marcador ${m.n}`}
                  title="Eliminar"
                  onClick={() => s.removeReviewMarker(m.id)}
                >
                  ×
                </button>
              </div>
              <div className="review-place">{markerPlace(m)}</div>
              <textarea
                aria-label={`Nota del marcador ${m.n}`}
                placeholder="¿Qué está mal aquí?"
                value={m.note}
                onChange={(e) => s.updateReviewMarker(m.id, { note: e.target.value })}
              />
            </div>
          ))}
        </div>
      </Section>
      {preview && (
        <Section title="Informe (texto)">
          <textarea
            className="review-preview"
            aria-label="Informe de revisión en texto"
            readOnly
            value={preview}
            onFocus={(e) => e.currentTarget.select()}
          />
        </Section>
      )}
      <Section title="Cargar un informe">
        <p className="small">
          Pega aquí un informe (el tuyo o uno de Claude): la app restaura el caso, el paciente, la
          sonda y la consola, y muestra sus marcadores.
        </p>
        <textarea
          className="review-note"
          aria-label="Texto del informe a cargar"
          placeholder="Pega el informe completo o su bloque JSON"
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
        />
        <div className="review-actions">
          <button onClick={load} disabled={!pasted.trim()}>
            Cargar informe
          </button>
        </div>
      </Section>
    </>
  );
}
