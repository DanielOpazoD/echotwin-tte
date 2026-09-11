import { useSimStore } from '@/app/store';

/**
 * Predefined views (user request): each button moves the probe *continuously* from its current pose
 * to the canonical pose of the view for this synthetic patient and sets it as the target. It is a
 * demonstration aid (an instructor guiding the hand), disabled in exam mode; the probe stays fully
 * manipulable and any manual action cancels the movement.
 */
const PRIMARY: { id: string; label: string; title: string }[] = [
  { id: 'plax', label: 'PLAX', title: 'Paraesternal eje largo' },
  { id: 'psax-av', label: 'PSAX GV', title: 'Paraesternal eje corto, grandes vasos / válvula aórtica' },
  { id: 'psax-mv', label: 'PSAX MV', title: 'Paraesternal eje corto, nivel mitral' },
  { id: 'psax-apex', label: 'PSAX ápex', title: 'Paraesternal eje corto, nivel apical' },
  { id: 'a4c', label: 'A4C', title: 'Apical cuatro cámaras' },
  { id: 'a5c', label: 'A5C', title: 'Apical cinco cámaras' },
];
const SECONDARY: { id: string; label: string; title: string }[] = [
  { id: 'psax-pm', label: 'PSAX PM', title: 'Paraesternal eje corto, nivel papilar' },
  { id: 'a2c', label: 'A2C', title: 'Apical dos cámaras' },
  { id: 'a3c', label: 'A3C', title: 'Apical tres cámaras' },
  { id: 'rv-focused', label: 'VD', title: 'Apical enfocada en VD' },
  { id: 'subcostal-4c', label: 'SC 4C', title: 'Subcostal cuatro cámaras' },
  { id: 'subcostal-ivc', label: 'SC VCI', title: 'Subcostal vena cava inferior' },
];

/** Module-level component: a stable element type so re-renders never remount the buttons. */
function PresetButton({ id, label, title }: { id: string; label: string; title: string }) {
  const disabled = useSimStore((s) => s.mode === 'exam');
  const active = useSimStore((s) => s.targetViewId === id);
  const start = useSimStore((s) => s.startPresetView);
  return (
    <button
      className={active ? 'active' : ''}
      disabled={disabled}
      title={disabled ? 'No disponible en modo examen' : `${title}: mueve la sonda de forma continua hasta la pose canónica`}
      onClick={() => start(id)}
      aria-pressed={active}
    >
      {label}
    </button>
  );
}

export function PresetViews() {
  const mode = useSimStore((s) => s.mode);
  const anim = useSimStore((s) => s.presetAnim);
  const cancel = useSimStore((s) => s.cancelPreset);
  const disabled = mode === 'exam';
  return (
    <div className="section">
      <h4>Vistas predeterminadas</h4>
      <div className="preset-grid">
        {PRIMARY.map((p) => (
          <PresetButton key={p.id} {...p} />
        ))}
      </div>
      <div className="preset-grid secondary">
        {SECONDARY.map((p) => (
          <PresetButton key={p.id} {...p} />
        ))}
      </div>
      <div className="small" aria-live="polite">
        {disabled
          ? 'Deshabilitadas en examen: la vista debe obtenerse manipulando la sonda.'
          : anim
            ? `Moviendo la sonda hacia ${anim.viewId.toUpperCase()}… (cualquier acción manual la detiene) `
            : 'La sonda se desplaza, rota e inclina de forma continua hasta la pose objetivo; luego sigues afinando tú.'}
        {anim && (
          <button onClick={cancel} style={{ marginLeft: 6 }}>
            Detener
          </button>
        )}
      </div>
    </div>
  );
}
