import { useSimStore } from '@/app/store';
import { useShallow } from 'zustand/shallow';
import { IconMinus, IconPlus } from './icons';

/**
 * Depth and gain on the image itself (decision 187): the two knobs a sonographer turns most, as steppers that show
 * while the pointer is over the image or a stepper has focus, with the same steps as their keys ([ ] and − +). The
 * store clamps each value to its range.
 */
export function ImageQuickBar() {
  const s = useSimStore(
    useShallow((st) => ({
      depthCm: st.settings.depthCm,
      gainDb: st.settings.gainDb,
      setSettings: st.setSettings,
    })),
  );
  return (
    <div className="quick-bar" role="group" aria-label="Profundidad y ganancia">
      <Stepper
        label="Profundidad"
        value={`${s.depthCm} cm`}
        less="Menos profundidad"
        more="Más profundidad"
        onLess={() => s.setSettings({ depthCm: s.depthCm - 1 })}
        onMore={() => s.setSettings({ depthCm: s.depthCm + 1 })}
      />
      <i className="quick-sep" aria-hidden="true" />
      <Stepper
        label="Ganancia"
        value={`${s.gainDb > 0 ? '+' : ''}${s.gainDb} dB`}
        less="Menos ganancia"
        more="Más ganancia"
        onLess={() => s.setSettings({ gainDb: s.gainDb - 2 })}
        onMore={() => s.setSettings({ gainDb: s.gainDb + 2 })}
      />
    </div>
  );
}

function Stepper(props: {
  label: string;
  value: string;
  less: string;
  more: string;
  onLess: () => void;
  onMore: () => void;
}) {
  return (
    <span className="quick-stepper">
      <span className="quick-label">{props.label}</span>
      <button
        className="icon-btn"
        aria-label={props.less}
        title={props.less}
        onClick={props.onLess}
      >
        <IconMinus size={13} />
      </button>
      <span className="quick-value" aria-live="polite">
        {props.value}
      </span>
      <button
        className="icon-btn"
        aria-label={props.more}
        title={props.more}
        onClick={props.onMore}
      >
        <IconPlus size={13} />
      </button>
    </span>
  );
}
