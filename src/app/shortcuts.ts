import { useEffect } from 'react';
import { useSimStore } from './store';
import { modePolicy } from './modePolicy';

/**
 * Keyboard accelerators (spec 4.2). Every shortcut has a visible UI equivalent.
 * Q/E rotate · W/S pressure · arrows slide · Shift+arrows rock/tilt · Space freeze · C colour · M M-mode · P PW · X CW · 2 2D · T TDI · H hide/show torso
 */
export const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: 'Q / E', action: 'Rotar sonda −/+ 3° (Shift: 15°)' },
  { keys: '← → ↑ ↓', action: 'Deslizar sonda 2 mm (Shift: 1 cm)' },
  { keys: 'Alt + ← →', action: 'Rock −/+ 3°' },
  { keys: 'Alt + ↑ ↓', action: 'Tilt (abanico) +/− 3°' },
  { keys: 'W / S', action: 'Presión +/−' },
  { keys: 'Espacio', action: 'Freeze / Live' },
  { keys: '2 · C · M · P · X · T', action: '2D · Color · M-mode · PW · CW · TDI' },
  { keys: '[ / ]', action: 'Profundidad −/+ 1 cm' },
  { keys: '- / +', action: 'Ganancia −/+ 2 dB' },
  { keys: 'H', action: 'Mostrar/ocultar torso 3D' },
  { keys: 'R', action: 'Modo revisión: marcar la imagen para un informe' },
  {
    keys: 'Supr / Retroceso',
    action: 'Revisión: borrar el marcador seleccionado (Ctrl+Z deshace)',
  },
  { keys: '. / ,', action: 'Cine: cuadro siguiente/anterior (en freeze)' },
  { keys: 'Esc', action: 'Cancelar la medición en curso' },
];

export function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA'))
        return;
      const s = useSimStore.getState();
      const big = e.shiftKey;
      const step = big ? 1 : 0.2;
      const ang = big ? 15 : 3;
      switch (e.key) {
        case 'q':
        case 'Q':
          s.nudgeProbe({ rotationDeg: -ang });
          break;
        case 'e':
        case 'E':
          s.nudgeProbe({ rotationDeg: ang });
          break;
        case 'w':
        case 'W':
          s.nudgeProbe({ pressure: 0.1 });
          break;
        case 's':
        case 'S':
          s.nudgeProbe({ pressure: -0.1 });
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (e.altKey) s.nudgeProbe({ rockDeg: -3 });
          else s.nudgeProbe({ u: -step });
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (e.altKey) s.nudgeProbe({ rockDeg: 3 });
          else s.nudgeProbe({ u: step });
          break;
        case 'ArrowUp':
          e.preventDefault();
          if (e.altKey) s.nudgeProbe({ tiltDeg: 3 });
          else s.nudgeProbe({ v: step });
          break;
        case 'ArrowDown':
          e.preventDefault();
          if (e.altKey) s.nudgeProbe({ tiltDeg: -3 });
          else s.nudgeProbe({ v: -step });
          break;
        case 'r':
        case 'R': {
          if (modePolicy(s.mode).devToolsAllowed) {
            const on = !s.ui.reviewMode;
            s.setUi({ reviewMode: on, consoleTab: on ? 'revisar' : 'adquirir' });
          }
          break;
        }
        case ' ':
          e.preventDefault();
          s.toggleFreeze();
          break;
        case '2':
          s.setModality('2d');
          break;
        case 'c':
        case 'C':
          s.setModality(s.modality === 'color' ? '2d' : 'color');
          break;
        case 'm':
        case 'M':
          s.setModality(e.shiftKey ? 'cmm' : 'm-mode');
          break;
        case 'p':
        case 'P':
          s.setModality('pw');
          break;
        case 'x':
        case 'X':
          s.setModality('cw');
          break;
        case 't':
        case 'T':
          s.setModality('tdi');
          break;
        case '[':
          s.setSettings({ depthCm: s.settings.depthCm - 1 });
          break;
        case ']':
          s.setSettings({ depthCm: s.settings.depthCm + 1 });
          break;
        case '-':
          s.setSettings({ gainDb: s.settings.gainDb - 2 });
          break;
        case '+':
        case '=':
          s.setSettings({ gainDb: s.settings.gainDb + 2 });
          break;
        case 'h':
        case 'H':
          if (!s.ui.minimal && s.mode !== 'exam') s.setUi({ showTorso: !s.ui.showTorso });
          break;
        case '.':
          if (s.frozen) s.setCineOffset(s.cineOffset + 1);
          break;
        case ',':
          if (s.frozen) s.setCineOffset(s.cineOffset - 1);
          break;
        case 'Escape':
          if (s.activeMeasurementId) s.setActiveMeasurement(null);
          else if (s.activeTool !== 'none') s.setActiveTool('none');
          else if (s.reviewLinkParentId) s.armReviewLink(null);
          else if (s.reviewSelectedId) s.selectReviewMarker(null);
          break;
        case 'Delete':
        case 'Backspace':
          if (s.ui.reviewMode && s.reviewSelectedId) s.removeReviewMarker(s.reviewSelectedId);
          else return;
          break;
        case 'z':
        case 'Z':
          if ((e.ctrlKey || e.metaKey) && s.ui.reviewMode && s.reviewUndo.length)
            s.undoReviewRemove();
          else return;
          break;
        default:
          return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
