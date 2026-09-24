import { useSimStore } from '@/app/store';
import { modePolicy } from '@/app/modePolicy';
import { InfoTip } from './controls';

/**
 * Predefined views (user request): each button moves the probe *continuously* from its current pose
 * to the canonical pose of the view for this synthetic patient and sets it as the target. It is a
 * demonstration aid (an instructor guiding the hand), disabled in exam mode; the probe stays fully
 * manipulable and any manual action cancels the movement.
 */
type Preset = { id: string; label: string; sub: string; title: string };
/** The parasternal window first, then the apical and subcostal ones: the order of a study. */
const PRIMARY: Preset[] = [
  { id: 'plax', label: 'PLAX', sub: 'eje largo', title: 'Paraesternal eje largo' },
  {
    id: 'psax-av',
    label: 'PSAX',
    sub: 'aórtica',
    title: 'Paraesternal eje corto, grandes vasos / válvula aórtica',
  },
  { id: 'psax-mv', label: 'PSAX', sub: 'mitral', title: 'Paraesternal eje corto, nivel mitral' },
  { id: 'psax-pm', label: 'PSAX', sub: 'papilar', title: 'Paraesternal eje corto, nivel papilar' },
  { id: 'psax-apex', label: 'PSAX', sub: 'ápex', title: 'Paraesternal eje corto, nivel apical' },
  { id: 'a4c', label: 'A4C', sub: '4 cámaras', title: 'Apical cuatro cámaras' },
];
const SECONDARY: Preset[] = [
  { id: 'a5c', label: 'A5C', sub: '5 cámaras', title: 'Apical cinco cámaras' },
  { id: 'a2c', label: 'A2C', sub: '2 cámaras', title: 'Apical dos cámaras' },
  { id: 'a3c', label: 'A3C', sub: 'eje largo', title: 'Apical tres cámaras' },
  { id: 'rv-focused', label: 'VD', sub: 'apical', title: 'Apical enfocada en VD' },
  { id: 'subcostal-4c', label: 'SC', sub: '4 cámaras', title: 'Subcostal cuatro cámaras' },
  { id: 'subcostal-ivc', label: 'SC', sub: 'VCI', title: 'Subcostal vena cava inferior' },
];

/** Module-level component: a stable element type so re-renders never remount the buttons. */
function PresetButton({ id, label, sub, title }: Preset) {
  const disabled = useSimStore((s) => !modePolicy(s.mode).presetsEnabled);
  const active = useSimStore((s) => s.targetViewId === id);
  const start = useSimStore((s) => s.startPresetView);
  return (
    <button
      className={active ? 'active' : ''}
      disabled={disabled}
      data-tip={
        disabled
          ? 'No disponible en modo examen'
          : `${title}: mueve la sonda de forma continua hasta la pose canónica`
      }
      onClick={() => start(id)}
      aria-pressed={active}
    >
      {label}
      <span className="preset-sub" aria-hidden="true">
        {sub}
      </span>
    </button>
  );
}

export function PresetViews() {
  const mode = useSimStore((s) => s.mode);
  const anim = useSimStore((s) => s.presetAnim);
  const cancel = useSimStore((s) => s.cancelPreset);
  const disabled = !modePolicy(mode).presetsEnabled;
  return (
    <div className="section">
      <h4>
        Vistas predeterminadas
        {!disabled && (
          <InfoTip text="Cada vista mueve la sonda de forma continua hasta su pose; luego sigues afinando tú. Cualquier acción manual la detiene." />
        )}
      </h4>
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
      <div className={`small preset-status${anim ? ' moving' : ''}`} aria-live="polite">
        {disabled
          ? 'Deshabilitadas en examen: la vista debe obtenerse manipulando la sonda.'
          : anim
            ? `Moviendo la sonda hacia ${anim.viewId.toUpperCase()}…`
            : null}
        {anim && (
          <button className="ghost" onClick={cancel} style={{ marginLeft: 'auto' }}>
            Detener
          </button>
        )}
      </div>
    </div>
  );
}
