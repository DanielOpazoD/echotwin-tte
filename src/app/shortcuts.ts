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
  { keys: '?', action: 'Mostrar u ocultar esta lista de atajos' },
];

/** The pointer on the 3D navigator (decision 188): listed in the shortcuts sheet, one short line on the torso itself. */
export const TORSO_GESTURES: { keys: string; action: string }[] = [
  { keys: 'Arrastrar la piel', action: 'Deslizar la sonda' },
  { keys: 'Arrastrar el marcador · rueda', action: 'Rotar la sonda (Shift + rueda: 10°)' },
  { keys: 'Shift + arrastrar', action: 'Rock' },
  { keys: 'Alt + arrastrar', action: 'Tilt (abanico)' },
  { keys: 'Botón derecho + arrastrar', action: 'Orbitar la cámara' },
  { keys: 'Ctrl/⌘ + rueda', action: 'Acercar o alejar la cámara' },
];

/** Roles whose widgets move with the arrow keys and act with Space (WAI-ARIA composite widgets and the slider). */
const ARROW_ROLES = new Set([
  'tab',
  'tablist',
  'slider',
  'radio',
  'radiogroup',
  'listbox',
  'option',
  'menu',
  'menuitem',
  'menuitemradio',
  'menuitemcheckbox',
  'spinbutton',
  'combobox',
  'tree',
  'treeitem',
  'grid',
  'gridcell',
]);
const ARROW_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']);

/**
 * Whether the focused element handles this key itself, so the global shortcut must yield (decision 176): every key in a
 * form field or an editable element; the arrows, Home, End and Space in a tab, a slider or another composite widget;
 * Space and Enter on a button, a link or a summary. With focus on a tab ArrowRight moved the probe and Space froze the
 * image while it pressed the button.
 */
export function focusOwnsKey(target: EventTarget | null, key: string): boolean {
  const t = target as HTMLElement | null;
  if (!t || typeof t.tagName !== 'string') return false;
  if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') return true;
  if (t.isContentEditable) return true;
  const role = t.getAttribute('role');
  if (role && ARROW_ROLES.has(role) && (ARROW_KEYS.has(key) || key === ' ')) return true;
  const pressable =
    t.tagName === 'BUTTON' || t.tagName === 'A' || t.tagName === 'SUMMARY' || role === 'button';
  return pressable && (key === ' ' || key === 'Enter');
}

export function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (focusOwnsKey(e.target, e.key)) return;
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
        case '?':
          s.setUi({ shortcutsOpen: !s.ui.shortcutsOpen });
          break;
        case 'Escape':
          if (s.ui.shortcutsOpen) s.setUi({ shortcutsOpen: false });
          else if (s.activeMeasurementId) s.setActiveMeasurement(null);
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
