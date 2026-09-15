import { useSimStore } from '@/app/store';
import { modePolicy } from '@/app/modePolicy';

/**
 * Slim top bar: brand, run state, product mode, quality and screen navigation. Case, vitals and
 * acquisition telemetry live in the on-image HUD (ImageHud) so this row never truncates.
 */
export function TopBar() {
  const s = useSimStore();
  const policy = modePolicy(s.mode);
  return (
    <div className="topbar" role="banner">
      <span className="brand">EchoTwin TTE</span>
      <span className={s.frozen ? 'frozen' : 'live'}>{s.frozen ? 'FREEZE' : 'LIVE'}</span>
      <span className="spacer" />
      <select
        aria-label="Modo del producto"
        value={s.mode}
        onChange={(e) => s.setMode(e.target.value as typeof s.mode)}
      >
        <option value="sandbox">Sandbox</option>
        <option value="guided">Adquisición guiada</option>
        <option value="exam">Examen</option>
      </select>
      <select
        aria-label="Calidad"
        value={s.quality}
        onChange={(e) => s.setQuality(e.target.value as typeof s.quality)}
        title="Nivel de calidad (solo resolución/rendimiento; no altera fisiología)"
      >
        <option value="low">Calidad baja</option>
        <option value="medium">Calidad media</option>
        <option value="high">Calidad alta</option>
      </select>
      <button
        className={s.ui.screen === 'simulator' ? 'active' : ''}
        onClick={() => s.setUi({ screen: 'simulator' })}
      >
        Simulador
      </button>
      <button
        className={s.ui.screen === 'report' ? 'active' : ''}
        onClick={() => s.setUi({ screen: 'report' })}
      >
        Informe
      </button>
      <button
        className={s.ui.screen === 'curriculum' ? 'active' : ''}
        onClick={() => s.setUi({ screen: 'curriculum' })}
        disabled={!policy.learningScreensEnabled}
      >
        Currículo
      </button>
      <button
        className={s.ui.screen === 'progress' ? 'active' : ''}
        onClick={() => s.setUi({ screen: 'progress' })}
        disabled={!policy.learningScreensEnabled}
      >
        Progreso
      </button>
      <button
        className={s.ui.screen === 'references' ? 'active' : ''}
        onClick={() => s.setUi({ screen: 'references' })}
        disabled={!policy.learningScreensEnabled}
      >
        Referencias
      </button>
    </div>
  );
}
