import { useHudStore, useSimStore } from '@/app/store';
import { listCases } from '@/cases';

export function TopBar() {
  const s = useSimStore();
  const hud = useHudStore((h) => h.hud);
  const title = listCases().find((c) => c.id === s.caseId)?.title ?? s.caseId;
  const rhythmLabel: Record<string, string> = { sinus: 'Sinusal', 'sinus-tachycardia': 'Taquicardia sinusal', 'sinus-bradycardia': 'Bradicardia sinusal', 'atrial-fibrillation': 'FA' };
  return (
    <div className="topbar" role="banner">
      <span className="brand">EchoTwin TTE</span>
      <span className="stat" title={title}>
        <b>{title.length > 44 ? title.slice(0, 44) + '…' : title}</b>
      </span>
      <span className="stat">
        FC <b>{hud ? Math.round(hud.heartRateBpm) : '—'}</b> lpm · <b>{s.truth ? rhythmLabel[s.truth.rhythm] ?? s.truth.rhythm : '—'}</b>
      </span>
      <span className="stat">
        Prof <b>{s.settings.depthCm} cm</b> · <b>{s.settings.frequencyMHz.toFixed(1)} MHz{s.settings.harmonics ? ' THI' : ''}</b>
      </span>
      <span className="stat">
        FR <b>{hud ? Math.round(hud.simulatedFps) : '—'} Hz</b>
        {hud && hud.colorFps > 0 ? <span> · color {Math.round(hud.colorFps)} Hz</span> : null}
      </span>
      <span className="stat">
        Vista <b>{hud?.view?.bestViewId ? `${hud.view.bestViewId.toUpperCase()} ${hud.view.score}` : '—'}</b>
      </span>
      <span className="spacer" />
      <span className={s.frozen ? 'frozen' : 'live'}>{s.frozen ? 'FREEZE' : 'LIVE'}</span>
      <select aria-label="Modo del producto" value={s.mode} onChange={(e) => s.setMode(e.target.value as typeof s.mode)}>
        <option value="sandbox">Sandbox</option>
        <option value="guided">Adquisición guiada</option>
        <option value="exam">Examen</option>
      </select>
      <select aria-label="Calidad" value={s.quality} onChange={(e) => s.setQuality(e.target.value as typeof s.quality)} title="Nivel de calidad (solo resolución/rendimiento; no altera fisiología)">
        <option value="low">Calidad baja</option>
        <option value="medium">Calidad media</option>
        <option value="high">Calidad alta</option>
      </select>
      <button className={s.ui.screen === 'simulator' ? 'active' : ''} onClick={() => s.setUi({ screen: 'simulator' })}>
        Simulador
      </button>
      <button className={s.ui.screen === 'report' ? 'active' : ''} onClick={() => s.setUi({ screen: 'report' })}>
        Informe
      </button>
      <button className={s.ui.screen === 'references' ? 'active' : ''} onClick={() => s.setUi({ screen: 'references' })} disabled={s.mode === 'exam'}>
        Referencias
      </button>
    </div>
  );
}
