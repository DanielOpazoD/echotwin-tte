import { useEffect, useRef, useState } from 'react';
import { useHudStore, useSimStore } from '@/app/store';
import { useShallow } from 'zustand/shallow';
import { buildInput } from '@/app/useSimulation';
import { displayPngBlob, exportDisplayPng } from '@/app/exportImage';
import {
  buildReviewReport,
  markerDistanceCm,
  markerLabel,
  markerPlace,
  parseReviewReport,
  reportToMarkdown,
  REVIEW_CATEGORIES,
  type ReviewCategory,
} from '@/app/review';
import { listCases } from '@/cases';
import { Section, Toggle } from './controls';

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
      selectedId: st.reviewSelectedId,
      source: st.reviewSource,
      undoCount: st.reviewUndo.length,
      freezeOnMark: st.ui.reviewFreezeOnMark,
      selectReviewMarker: st.selectReviewMarker,
      undoReviewRemove: st.undoReviewRemove,
      linkParentId: st.reviewLinkParentId,
      armReviewLink: st.armReviewLink,
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
  const itemRefs = useRef(new Map<string, HTMLDivElement>());
  // a marker selected on the image or the model scrolls its card into view
  useEffect(() => {
    if (s.selectedId) itemRefs.current.get(s.selectedId)?.scrollIntoView({ block: 'nearest' });
  }, [s.selectedId]);

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
          Clic sobre la imagen o sobre el torso 3D deja un marcador numerado con lo que el modelo
          tiene debajo. Escribe qué ves mal en cada marcador, copia el informe y pégalo en el chat:
          incluye el estado exacto para reproducir el cuadro.
        </p>
        <div className="review-help">
          Arrastra un marcador para moverlo · clic lo selecciona · Supr o Retroceso lo borra ·
          Ctrl+Z deshace · Esc deselecciona · Shift+clic usa la herramienta normal · Alt+clic añade
          un punto secundario al marcador seleccionado.
        </div>
        {s.source && (
          <div className="review-source">
            Informe cargado de {s.source.author === 'claude' ? 'Claude' : 'usuario'} (
            {s.source.createdAt.slice(0, 16).replace('T', ' ')}).
          </div>
        )}
        <Toggle
          label="Congelar al poner el primer marcador"
          value={s.freezeOnMark}
          onChange={(v) => s.setUi({ reviewFreezeOnMark: v })}
          title="Así los marcadores conservan el cuadro en que se pusieron; con Espacio vuelves a vivo"
        />
        <div className="review-actions">
          <button className="primary" onClick={() => void copyReport()}>
            Copiar informe
          </button>
          <button onClick={() => void copyImage()}>Copiar imagen</button>
          <button onClick={() => exportDisplayPng(s.caseId)}>Descargar PNG</button>
          <button
            onClick={() => s.undoReviewRemove()}
            disabled={!s.undoCount}
            aria-label="Deshacer el último borrado"
          >
            Deshacer
          </button>
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
          {s.markers
            .filter((m) => !m.parentId)
            .map((m) => {
              const children = s.markers.filter((c) => c.parentId === m.id);
              const arming = s.linkParentId === m.id;
              return (
                <div
                  key={m.id}
                  className={`review-item${m.id === s.selectedId ? ' on' : ''}`}
                  data-marker={m.n}
                  ref={(el) => {
                    if (el) itemRefs.current.set(m.id, el);
                    else itemRefs.current.delete(m.id);
                  }}
                  onClick={() => s.selectReviewMarker(m.id)}
                >
                  <div className="review-head">
                    <span className="review-n" aria-hidden="true">
                      {m.n}
                    </span>
                    {m.space === 'model' && (
                      <span className="review-chip" title="Marcador sobre el modelo 3D">
                        3D
                      </span>
                    )}
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
                      title="Eliminar (con sus puntos secundarios)"
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
                  {children.length > 0 && (
                    <div className="review-children">
                      {children.map((c) => {
                        const label = markerLabel(c, s.markers);
                        const d = markerDistanceCm(m, c);
                        return (
                          <div
                            key={c.id}
                            className={`review-child${c.id === s.selectedId ? ' on' : ''}`}
                            ref={(el) => {
                              if (el) itemRefs.current.set(c.id, el);
                              else itemRefs.current.delete(c.id);
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              s.selectReviewMarker(c.id);
                            }}
                          >
                            <div className="review-head">
                              <span className="review-n small" aria-hidden="true">
                                {label}
                              </span>
                              {c.space === 'model' && (
                                <span className="review-chip" title="Sobre el modelo 3D">
                                  3D
                                </span>
                              )}
                              <span className="review-place">
                                {d ? `a ${d.cm.toFixed(1)} cm de ${m.n} (${d.where})` : ''}
                              </span>
                              <button
                                aria-label={`Eliminar punto ${label}`}
                                title="Eliminar"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  s.removeReviewMarker(c.id);
                                }}
                              >
                                ×
                              </button>
                            </div>
                            <div className="review-place">{markerPlace(c)}</div>
                            <textarea
                              aria-label={`Nota del punto ${label}`}
                              placeholder="Relación con el principal o detalle (opcional)"
                              value={c.note}
                              onChange={(e) => s.updateReviewMarker(c.id, { note: e.target.value })}
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div className="review-actions">
                    <button
                      className={arming ? 'on' : ''}
                      aria-pressed={arming}
                      aria-label={`Añadir puntos secundarios al marcador ${m.n}`}
                      title="Los siguientes clics sobre la imagen o el torso se enlazan a este marcador; Esc termina"
                      onClick={(e) => {
                        e.stopPropagation();
                        s.armReviewLink(arming ? null : m.id);
                      }}
                    >
                      {arming ? 'Añadiendo secundarios… (Esc termina)' : '+ Punto secundario'}
                    </button>
                  </div>
                </div>
              );
            })}
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
