import { useSimStore } from '@/app/store';
import { useShallow } from 'zustand/shallow';
import { modePolicy } from '@/app/modePolicy';
import { useRef } from 'react';
import { useSlidingPill } from './useSlidingPill';
import { isReportSection } from './ReportSections';
import { ANATOMY_LABELS } from './anatomyLabels';
import { IconPencil } from './icons';
import { ANATOMY_CHOICES } from '@/simulator/core/protocol';

/**
 * Slim top bar: brand and run state on the left, the screens as one segmented control in the middle, product mode
 * and quality on the right. Case, vitals and acquisition telemetry live in the on-image HUD (ImageHud) so this row
 * never truncates. The case report, the curriculum and the progress are one tab, «Informe» (decision 244). Where the
 * developer tools are allowed, the heart (analytic or Rodero) and the review mode with its notes are one click away on
 * the right (decision 376); they lived in the Dev panel and the overflow menu.
 */
const SCREENS: { id: 'simulator' | 'report' | 'references'; label: string }[] = [
  { id: 'simulator', label: 'Simulador' },
  { id: 'report', label: 'Informe' },
  { id: 'references', label: 'Referencias' },
];

export function TopBar() {
  const navRef = useRef<HTMLElement>(null);
  const s = useSimStore(
    useShallow((st) => ({
      frozen: st.frozen,
      anatomy: st.anatomy,
      mode: st.mode,
      quality: st.quality,
      setAnatomy: st.setAnatomy,
      setMode: st.setMode,
      setQuality: st.setQuality,
      setUi: st.setUi,
      ui: st.ui,
    })),
  );
  // the curriculum and the progress are sections of the «Informe» tab
  const current = isReportSection(s.ui.screen) ? 'report' : s.ui.screen;
  const pill = useSlidingPill(navRef, current);
  const policy = modePolicy(s.mode);
  return (
    <div className="topbar" role="banner">
      <span className="brand">
        <i className="brand-mark" aria-hidden="true" />
        EchoTwin <span className="brand-sub">TTE</span>
      </span>
      <span
        className={`run-state ${s.frozen ? 'frozen' : 'live'}`}
        data-tip={
          s.frozen ? 'Imagen congelada (Espacio reanuda)' : 'Adquisición en vivo (Espacio congela)'
        }
      >
        <i className="run-dot" aria-hidden="true" />
        {s.frozen ? 'CONGELADA' : 'EN VIVO'}
      </span>
      <nav className="nav-seg" aria-label="Pantallas" ref={navRef}>
        {pill && <span className="seg-pill" style={pill} aria-hidden="true" />}
        {SCREENS.map((sc) => (
          <button
            key={sc.id}
            className={current === sc.id ? 'active' : ''}
            aria-current={current === sc.id ? 'page' : undefined}
            onClick={() => {
              if (current !== sc.id) s.setUi({ screen: sc.id });
            }}
            disabled={sc.id === 'references' && !policy.learningScreensEnabled}
          >
            {sc.label}
          </button>
        ))}
      </nav>
      {policy.devToolsAllowed && (
        <div className="tool-seg" role="group" aria-label="Corazón">
          <span className="tool-seg-cap" aria-hidden="true">
            Corazón
          </span>
          {ANATOMY_CHOICES.map((a) => (
            <button
              key={a}
              className={s.anatomy === a ? 'active' : ''}
              aria-pressed={s.anatomy === a}
              onClick={() => s.setAnatomy(a)}
              data-tip={ANATOMY_LABELS[a].tip}
            >
              {ANATOMY_LABELS[a].short}
            </button>
          ))}
        </div>
      )}
      {policy.devToolsAllowed && (
        <button
          className={`notes-btn${s.ui.reviewMode ? ' active' : ''}`}
          aria-pressed={s.ui.reviewMode}
          onClick={() =>
            s.setUi({
              reviewMode: !s.ui.reviewMode,
              consoleTab: s.ui.reviewMode ? 'adquirir' : 'revisar',
            })
          }
          data-tip="Modo revisión: marca y anota sobre la imagen lo que ves mal, y copia el informe"
          data-tip-key="R"
        >
          <IconPencil size={15} />
          Notas
        </button>
      )}
      <select
        aria-label="Modo del producto"
        value={s.mode}
        onChange={(e) => s.setMode(e.target.value as typeof s.mode)}
        data-tip="Libre: todo abierto. Guiada: una vista objetivo con ayudas. Examen: sin ayudas ni presets"
      >
        <option value="sandbox">Libre</option>
        <option value="guided">Adquisición guiada</option>
        <option value="exam">Examen</option>
      </select>
      <select
        aria-label="Calidad"
        value={s.quality}
        onChange={(e) => s.setQuality(e.target.value as typeof s.quality)}
        data-tip="Nivel de calidad: resolución del trazado y, en alta, el grosor del corte (tres planos de elevación); no altera la fisiología. Automática: la calibrada contra imágenes clínicas cuando la GPU forma la imagen, media con el trazador de CPU"
      >
        <option value="auto">Calidad automática</option>
        <option value="low">Calidad baja</option>
        <option value="medium">Calidad media</option>
        <option value="high">Calidad alta</option>
      </select>
    </div>
  );
}
