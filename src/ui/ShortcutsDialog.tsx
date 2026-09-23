import { useEffect, useRef } from 'react';
import { useSimStore } from '@/app/store';
import { SHORTCUTS } from '@/app/shortcuts';

/**
 * The keyboard shortcuts as a sheet over the simulator (decision 185): opened with «?» or from the ⋯ menu, closed with
 * Escape, the backdrop or its button. The same table lives in the References screen; here it is one key away while the
 * learner scans.
 */
export function ShortcutsDialog() {
  const open = useSimStore((s) => s.ui.shortcutsOpen);
  const setUi = useSimStore((s) => s.setUi);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);
  if (!open) return null;
  const close = () => setUi({ shortcutsOpen: false });
  return (
    <div className="sheet-backdrop" onClick={close}>
      <div
        className="sheet shortcuts"
        role="dialog"
        aria-modal="true"
        aria-label="Atajos de teclado"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-head">
          <h3>Atajos de teclado</h3>
          <button ref={closeRef} className="ghost" onClick={close} aria-label="Cerrar">
            Cerrar
          </button>
        </div>
        <p className="small">
          Cada atajo tiene su control en pantalla. Con el foco en un campo o un control, la tecla va
          al control.
        </p>
        <table>
          <tbody>
            {SHORTCUTS.map((s) => (
              <tr key={s.keys}>
                <td>
                  {s.keys
                    .split(' ')
                    .filter(Boolean)
                    .map((k, i) =>
                      k === '·' || k === '/' || k === '+' ? (
                        <span key={i} className="sheet-sep">
                          {k}
                        </span>
                      ) : (
                        <kbd key={i} className="kbd">
                          {k}
                        </kbd>
                      ),
                    )}
                </td>
                <td>{s.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
