import { useHudStore, useSimStore } from '@/app/store';
import type { ImagingModality } from '@/simulator/renderer/types';
import { exportDisplayPng } from '@/app/exportImage';
import { useRestartTutorial } from './Tutorial';

const MODES: { id: ImagingModality; label: string; key: string }[] = [
  { id: '2d', label: '2D', key: '2' },
  { id: 'color', label: 'Color', key: 'C' },
  { id: 'm-mode', label: 'M', key: 'M' },
  { id: 'pw', label: 'PW', key: 'P' },
  { id: 'cw', label: 'CW', key: 'X' },
  { id: 'tdi', label: 'TDI', key: 'T' },
];

export function ModeBar() {
  const s = useSimStore();
  const hud = useHudStore((h) => h.hud);
  const restartTutorial = useRestartTutorial();
  return (
    <div className="modebar" role="toolbar" aria-label="Modalidades y cine">
      <div className="group">
        {MODES.map((m) => (
          <button key={m.id} className={s.modality === m.id ? 'active' : ''} onClick={() => s.setModality(m.id)} title={`Tecla ${m.key}`} aria-pressed={s.modality === m.id}>
            {m.label}
          </button>
        ))}
      </div>
      <div className="sep" />
      <button className={s.frozen ? 'active' : ''} onClick={() => s.toggleFreeze()} title="Espacio" aria-pressed={s.frozen}>
        {s.frozen ? 'Live' : 'Freeze'}
      </button>
      {s.frozen && hud && (
        <div className="cine">
          <input type="range" aria-label="Cine" min={-(hud.cineLength - 1)} max={0} value={s.cineOffset} onChange={(e) => s.setCineOffset(Number(e.target.value))} />
          <span className="small">
            cuadro {hud.cineLength + s.cineOffset}/{hud.cineLength} · fase {(hud.cineFramePhase * 100).toFixed(0)}%
          </span>
        </div>
      )}
      <div className="sep" />
      <button onClick={() => s.setUi({ showTorso: !s.ui.showTorso })} className={s.ui.showTorso ? 'active' : ''} title="H">
        Torso 3D
      </button>
      <button onClick={() => s.setUi({ showHints: !s.ui.showHints })} className={s.ui.showHints ? 'active' : ''} disabled={s.mode === 'exam'}>
        Ayudas
      </button>
      <button onClick={() => s.setUi({ showPhysics: !s.ui.showPhysics })} className={s.ui.showPhysics ? 'active' : ''} disabled={s.mode === 'exam'} title="Superpone líneas de barrido y zona focal">
        Física
      </button>
      <button onClick={() => s.setUi({ showEcg: !s.ui.showEcg })} className={s.ui.showEcg ? 'active' : ''}>
        ECG
      </button>
      <button onClick={() => s.setUi({ devPanel: !s.ui.devPanel })} className={s.ui.devPanel ? 'active' : ''} disabled={s.mode === 'exam'} title="Panel de desarrollador">
        Dev
      </button>
      <div className="sep" />
      <button onClick={() => exportDisplayPng(s.caseId)} title="Guardar la imagen actual como PNG con marca de agua SYNTHETIC TRAINING">
        Guardar PNG
      </button>
      <button onClick={restartTutorial} title="Reiniciar el tutorial de controles">
        Tutorial
      </button>
      <span className="spacer" style={{ flex: 1 }} />
      <span className="small">
        {s.workerMode === 'worker' ? 'Worker' : s.workerMode === 'inline' ? 'Inline' : 'Iniciando…'} · UI {s.fpsUi} fps
      </span>
    </div>
  );
}
