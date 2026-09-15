import { useEffect, useRef, useState } from 'react';
import { useHudStore, useSimStore } from '@/app/store';
import { modePolicy } from '@/app/modePolicy';
import type { ImagingModality } from '@/simulator/renderer/types';
import { exportDisplayPng } from '@/app/exportImage';
import { useRestartTutorial } from './Tutorial';
import { IconCheck, IconSliders } from './icons';

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
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const item = (
    label: string,
    value: boolean,
    onToggle: () => void,
    opts: { disabled?: boolean; hint?: string } = {},
  ) => (
    <button
      role="menuitemcheckbox"
      aria-checked={value}
      disabled={opts.disabled}
      title={opts.disabled ? 'No disponible en modo examen' : opts.hint}
      onClick={onToggle}
    >
      <span className="mi-check" aria-hidden="true">
        {value ? <IconCheck size={12} /> : null}
      </span>
      <span className="mi-label">
        {label}
        {opts.hint && !opts.disabled ? (
          <span className="mi-hint" aria-hidden="true">
            {opts.hint}
          </span>
        ) : null}
      </span>
    </button>
  );

  const action = (label: string, onClick: () => void) => (
    <button
      role="menuitem"
      onClick={() => {
        onClick();
        setOpen(false);
      }}
    >
      <span className="mi-check" aria-hidden="true" />
      <span className="mi-label">{label}</span>
    </button>
  );

  return (
    <div className="menu-wrap" ref={wrap}>
      <button
        className={`menu-btn${open ? ' active' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Más opciones"
        title="Paneles y acciones"
        onClick={() => setOpen((o) => !o)}
      >
        <IconSliders />
      </button>
      {open && (
        <div className="menu" role="menu" aria-label="Paneles y acciones">
          <div className="menu-cap">Mostrar</div>
          {item('Ayudas de vista', s.ui.showHints, () => s.setUi({ showHints: !s.ui.showHints }), {
            disabled: !policy.hintsEnabled,
            hint: 'Puntuación y sugerencias de adquisición',
          })}
          {item(
            'Superposición física',
            s.ui.showPhysics,
            () => s.setUi({ showPhysics: !s.ui.showPhysics }),
            { disabled: !policy.devToolsAllowed, hint: 'Líneas de barrido y zona focal' },
          )}
          {item('ECG', s.ui.showEcg, () => s.setUi({ showEcg: !s.ui.showEcg }))}
          {item('Panel Dev', s.ui.devPanel, () => s.setUi({ devPanel: !s.ui.devPanel }), {
            disabled: !policy.devToolsAllowed,
          })}
          <div className="menu-sep" />
          <div className="menu-cap">Acciones</div>
          {action('Guardar imagen PNG', () => exportDisplayPng(s.caseId))}
          {action('Reiniciar tutorial', restartTutorial)}
        </div>
      )}
    </div>
  );
}
