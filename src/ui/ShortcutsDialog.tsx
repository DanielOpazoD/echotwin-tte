import { useEffect, useRef } from 'react';
import { useSimStore } from '@/app/store';
import { SHORTCUTS, TORSO_GESTURES } from '@/app/shortcuts';

/**
 * The keyboard shortcuts as a sheet over the simulator (decision 185): opened with «?» or from the ⋯ menu, closed with
 * Escape, the backdrop or its button. Decision 188 adds the pointer gestures on the 3D navigator. The same table lives in the References screen; here it is one key away while the
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
        <div className="sheet-cols">
          <section>
            <h4 className="sheet-sub">Teclado</h4>
            <table>
              <tbody>
                {SHORTCUTS.map((s) => (
                  <tr key={s.keys}>
                    <td>{chips(s.keys.split(' '))}</td>
                    <td>{s.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section>
            <h4 className="sheet-sub">Ratón sobre el torso</h4>
            <table>
              <tbody>
                {TORSO_GESTURES.map((g) => (
                  <tr key={g.keys}>
                    <td>{chips(g.keys.split(/ ([·+]) /), 'kbd gesture')}</td>
                    <td>{g.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      </div>
    </div>
  );
}

/** Each key or gesture in its chip; the separators between them («·», «/», «+») stay as plain text. */
function chips(parts: string[], chip = 'kbd') {
  const keys = parts.filter(Boolean);
  // «+» joins two keys (Alt + ←) but is a key itself at either end («- / +»)
  const isSep = (k: string, i: number) =>
    k === '·' || k === '/' || (k === '+' && i > 0 && i < keys.length - 1);
  return keys.map((k, i) =>
    isSep(k, i) ? (
      <span key={i} className="sheet-sep">
        {k}
      </span>
    ) : (
      <kbd key={i} className={chip}>
        {k}
      </kbd>
    ),
  );
}
