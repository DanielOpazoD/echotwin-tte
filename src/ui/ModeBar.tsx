import { useHudStore, useSimStore } from '@/app/store';
import { modePolicy } from '@/app/modePolicy';
import type { ImagingModality } from '@/simulator/renderer/types';
import { exportDisplayPng } from '@/app/exportImage';
import { useRestartTutorial } from './Tutorial';
import { IconSliders } from './icons';
import { ActionItem, CheckItem, MenuCap, usePopover } from './menu';

const MODES: { id: ImagingModality; label: string; key: string }[] = [
  { id: '2d', label: '2D', key: '2' },
  { id: 'color', label: 'Color', key: 'C' },
  { id: 'm-mode', label: 'M', key: 'M' },
  { id: 'cmm', label: 'CMM', key: 'Shift+M' },
  { id: 'pw', label: 'PW', key: 'P' },
  { id: 'cw', label: 'CW', key: 'X' },
  { id: 'tdi', label: 'TDI', key: 'T' },
];

/**
 * Bottom toolbar: only the acquisition controls live in the first row — modality keys, freeze/cine
 * and the torso toggle. Interface toggles and secondary actions live in the ⋯ overflow menu.
 */
export function ModeBar() {
  const s = useSimStore();
  const hud = useHudStore((h) => h.hud);
  return (
    <div className="modebar" role="toolbar" aria-label="Modalidades y cine">
      <div className="group">
        {MODES.map((m) => (
          <button
            key={m.id}
            className={s.modality === m.id ? 'active' : ''}
            onClick={() => s.setModality(m.id)}
            title={`Tecla ${m.key}`}
            aria-pressed={s.modality === m.id}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div className="sep" />
      <button
        className={s.frozen ? 'active' : ''}
        onClick={() => s.toggleFreeze()}
        title="Espacio"
        aria-pressed={s.frozen}
      >
        {s.frozen ? 'Live' : 'Freeze'}
      </button>
      {s.frozen && hud && (
        <div className="cine">
          <input
            type="range"
            aria-label="Cine"
            min={-(hud.cineLength - 1)}
            max={0}
            value={s.cineOffset}
            onChange={(e) => s.setCineOffset(Number(e.target.value))}
          />
          <span className="small">
            cuadro {hud.cineLength + s.cineOffset}/{hud.cineLength} · fase{' '}
            {(hud.cineFramePhase * 100).toFixed(0)}%
          </span>
        </div>
      )}
      <span className="spacer" style={{ flex: 1 }} />
      <button
        onClick={() => s.setUi({ showTorso: !s.ui.showTorso })}
        className={s.ui.showTorso ? 'active' : ''}
        title="Mostrar/ocultar el torso 3D (H)"
        aria-pressed={s.ui.showTorso}
      >
        Torso 3D
      </button>
      <OverflowMenu />
      <span className="small modebar-status">
        {s.workerMode === 'worker' ? 'Worker' : s.workerMode === 'inline' ? 'Inline' : 'Iniciando…'}{' '}
        · UI {s.fpsUi} fps
      </span>
    </div>
  );
}

/** ⋯ menu: interface toggles (checkable) plus the secondary actions, per the minimal-console spec. */
function OverflowMenu() {
  const s = useSimStore();
  const policy = modePolicy(s.mode);
  const restartTutorial = useRestartTutorial();
  const { open, setOpen, wrap } = usePopover();

  return (
    <div className="menu-wrap" ref={wrap}>
      <button
        className={`menu-btn${open ? ' active' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Más opciones"
        title="Paneles y acciones"
        onClick={() => setOpen(!open)}
      >
        <IconSliders />
      </button>
      {open && (
        <div className="menu" role="menu" aria-label="Paneles y acciones">
          <MenuCap>Mostrar</MenuCap>
          <CheckItem
            label="Ayudas de vista"
            checked={s.ui.showHints}
            onToggle={() => s.setUi({ showHints: !s.ui.showHints })}
            disabled={!policy.hintsEnabled}
            hint="Puntuación y sugerencias de adquisición"
          />
          <CheckItem
            label="Superposición física"
            checked={s.ui.showPhysics}
            onToggle={() => s.setUi({ showPhysics: !s.ui.showPhysics })}
            disabled={!policy.devToolsAllowed}
            hint="Líneas de barrido y zona focal"
          />
          <CheckItem
            label="ECG"
            checked={s.ui.showEcg}
            onToggle={() => s.setUi({ showEcg: !s.ui.showEcg })}
          />
          <CheckItem
            label="Panel Dev"
            checked={s.ui.devPanel}
            onToggle={() => s.setUi({ devPanel: !s.ui.devPanel })}
            disabled={!policy.devToolsAllowed}
          />
          <div className="menu-sep" />
          <MenuCap>Acciones</MenuCap>
          <ActionItem
            label="Guardar imagen PNG"
            onClick={() => {
              exportDisplayPng(s.caseId);
              setOpen(false);
            }}
          />
          <ActionItem
            label="Reiniciar tutorial"
            onClick={() => {
              restartTutorial();
              setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}
