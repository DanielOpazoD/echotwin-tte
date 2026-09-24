import { useSimStore } from '@/app/store';
import { useShallow } from 'zustand/shallow';
import { modePolicy } from '@/app/modePolicy';

/**
 * Slim top bar: brand and run state on the left, the screens as one segmented control in the middle, product mode
 * and quality on the right. Case, vitals and acquisition telemetry live in the on-image HUD (ImageHud) so this row
 * never truncates.
 */
const SCREENS: {
  id: 'simulator' | 'report' | 'curriculum' | 'progress' | 'references';
  label: string;
}[] = [
  { id: 'simulator', label: 'Simulador' },
  { id: 'report', label: 'Informe' },
  { id: 'curriculum', label: 'Currículo' },
  { id: 'progress', label: 'Progreso' },
  { id: 'references', label: 'Referencias' },
];

export function TopBar() {
  const s = useSimStore(
    useShallow((st) => ({
      frozen: st.frozen,
      mode: st.mode,
      quality: st.quality,
      setMode: st.setMode,
      setQuality: st.setQuality,
      setUi: st.setUi,
      ui: st.ui,
    })),
  );
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
        {s.frozen ? 'FREEZE' : 'LIVE'}
      </span>
      <nav className="nav-seg" aria-label="Pantallas">
        {SCREENS.map((sc) => (
          <button
            key={sc.id}
            className={s.ui.screen === sc.id ? 'active' : ''}
            aria-current={s.ui.screen === sc.id ? 'page' : undefined}
            onClick={() => s.setUi({ screen: sc.id })}
            disabled={sc.id !== 'simulator' && sc.id !== 'report' && !policy.learningScreensEnabled}
          >
            {sc.label}
          </button>
        ))}
      </nav>
      <select
        aria-label="Modo del producto"
        value={s.mode}
        onChange={(e) => s.setMode(e.target.value as typeof s.mode)}
        data-tip="Sandbox: todo abierto. Guiada: una vista objetivo con ayudas. Examen: sin ayudas ni presets"
      >
        <option value="sandbox">Sandbox</option>
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
