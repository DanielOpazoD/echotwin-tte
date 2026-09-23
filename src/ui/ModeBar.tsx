import { useHudStore, useSimStore } from '@/app/store';
import { useShallow } from 'zustand/shallow';
import { modePolicy } from '@/app/modePolicy';
import { exportDisplayPng } from '@/app/exportImage';
import { useRestartTutorial } from './Tutorial';
import { IconSliders } from './icons';
import { MODALITY_LIST } from '@/simulator/renderer/modality';
import { ActionItem, CheckItem, MenuCap, usePopover } from './menu';

const MODES = MODALITY_LIST;

/**
 * Bottom toolbar: only the acquisition controls live in the first row — modality keys, freeze/cine
 * and the torso toggle. Interface toggles and secondary actions live in the ⋯ overflow menu.
 */
export function ModeBar() {
  const s = useSimStore(
    useShallow((st) => ({
      cineOffset: st.cineOffset,
      fpsUi: st.fpsUi,
      frozen: st.frozen,
      modality: st.modality,
      mode: st.mode,
      setCineOffset: st.setCineOffset,
      setModality: st.setModality,
      setUi: st.setUi,
      toggleFreeze: st.toggleFreeze,
      ui: st.ui,
      workerMode: st.workerMode,
    })),
  );
  const hud = useHudStore((h) => h.hud);
  return (
    <div className="modebar" role="toolbar" aria-label="Modalidades y cine">
      <div className="seg-bar" role="group" aria-label="Modalidad">
        {MODES.map((m) => (
          <button
            key={m.id}
            className={s.modality === m.id ? 'active' : ''}
            onClick={() => s.setModality(m.id)}
            title={`Tecla ${m.key}`}
            aria-pressed={s.modality === m.id}
          >
            {m.label}
            <kbd className="kbd" aria-hidden="true">
              {m.key.replace('Shift+', '⇧')}
            </kbd>
          </button>
        ))}
      </div>
      <ContextChip />
      <div className="sep" />
      <button
        className={`freeze-btn${s.frozen ? ' active' : ''}`}
        onClick={() => s.toggleFreeze()}
        title={s.frozen ? 'Reanudar (Espacio)' : 'Congelar (Espacio)'}
        aria-pressed={s.frozen}
      >
        <i className="run-dot" aria-hidden="true" />
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
        title={
          s.ui.minimal || s.mode === 'exam'
            ? 'Interfaz limpia activa — desactívala en el menú ⋯'
            : 'Mostrar/ocultar el torso 3D (H)'
        }
        aria-pressed={s.ui.showTorso}
        disabled={s.ui.minimal || s.mode === 'exam'}
      >
        Torso 3D
      </button>
      <OverflowMenu />
      <span
        className="small modebar-status"
        title="Dónde corre la simulación y a cuántos cuadros por segundo se repinta la interfaz"
      >
        {s.workerMode === 'worker' ? 'Worker' : s.workerMode === 'inline' ? 'Inline' : 'Iniciando…'}{' '}
        · UI {s.fpsUi} fps
      </span>
    </div>
  );
}

/**
 * One glanceable chip that states what the active modality is doing — colour Nyquist, the PW/TDI
 * gate depth, the CW cursor or the M-mode sweep. Read-only: the control lives in the Doppler tab.
 */
function ContextChip() {
  const modality = useSimStore((s) => s.modality);
  const scaleMps = useSimStore((s) => s.color.scaleMps);
  const gateDepthCm = useSimStore((s) => s.gateDepthCm);
  const sweepSpeed = useSimStore((s) => s.spectral.sweepSpeedMmPerS);
  const spec: Record<string, { text: string; title: string } | undefined> = {
    color: {
      text: `±${scaleMps.toFixed(2)} m/s`,
      title: 'Escala de Nyquist de la caja de color (pestaña Doppler)',
    },
    pw: { text: `Gate ${gateDepthCm.toFixed(1)} cm`, title: 'Profundidad de la compuerta PW' },
    cw: { text: 'Cursor', title: 'Cursor CW activo — sin compuerta' },
    tdi: { text: `Gate ${gateDepthCm.toFixed(1)} cm`, title: 'Profundidad de la compuerta TDI' },
    'm-mode': { text: `${sweepSpeed} mm/s`, title: 'Velocidad de barrido del modo M' },
    cmm: { text: `${sweepSpeed} mm/s`, title: 'Velocidad de barrido del modo M' },
  };
  const chip = spec[modality];
  if (!chip) return null;
  return (
    <span className="ctx-chip" title={chip.title}>
      {chip.text}
    </span>
  );
}

/** ⋯ menu: interface toggles (checkable) plus the secondary actions, per the minimal-console spec. */
function OverflowMenu() {
  const s = useSimStore(
    useShallow((st) => ({ caseId: st.caseId, mode: st.mode, setUi: st.setUi, ui: st.ui })),
  );
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
          <MenuCap>Revisión</MenuCap>
          <CheckItem
            label="Modo revisión"
            checked={s.ui.reviewMode}
            onToggle={() =>
              s.setUi({
                reviewMode: !s.ui.reviewMode,
                consoleTab: s.ui.reviewMode ? 'adquirir' : 'revisar',
              })
            }
            disabled={!policy.devToolsAllowed}
            hint="Marca sobre la imagen lo que ves mal y copia el informe (R)"
          />
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
            label="Datos sobre imagen"
            checked={s.ui.showHud}
            onToggle={() => s.setUi({ showHud: !s.ui.showHud })}
            hint="Caso, FC y parámetros en las esquinas"
          />
          <CheckItem
            label="Interfaz limpia"
            checked={s.ui.minimal || s.mode === 'exam'}
            onToggle={() => s.setUi({ minimal: !s.ui.minimal })}
            disabled={s.mode === 'exam'}
            hint="Solo imagen y consola — oculta el rail izquierdo"
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
            label="Atajos de teclado"
            onClick={() => {
              s.setUi({ shortcutsOpen: true });
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
