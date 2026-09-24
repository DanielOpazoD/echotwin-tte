import { imageSegmentsOn, useSimStore } from '@/app/store';
import { modePolicy } from '@/app/modePolicy';
import type { SegmentModelChoice } from './segmentMap';

/**
 * The button on the ultrasound image that shows the LV segments of the tissue in it (decision 153), and, while they
 * show, the choice of model (17 anatomical, 16 wall motion) and how to read them. Hidden in exam mode, where the
 * layer is off whatever the saved preference. While off it shows only with the pointer over the image, like the depth
 * and gain steppers (decision 192).
 */
export function SegmentImageToggle() {
  const mode = useSimStore((s) => s.mode);
  const on = useSimStore(imageSegmentsOn);
  const model = useSimStore((s) => s.ui.segmentModel);
  const setUi = useSimStore((s) => s.setUi);
  if (!modePolicy(mode).hintsEnabled) return null;
  const pick = (m: SegmentModelChoice) =>
    setUi({
      segmentModel: m,
      selectedSegment:
        m === 'LV_16' && useSimStore.getState().ui.selectedSegment === 17
          ? null
          : useSimStore.getState().ui.selectedSegment,
    });
  return (
    <div className={on ? 'img-seg on' : 'img-seg'}>
      <button
        className={on ? 'img-seg-toggle on' : 'img-seg-toggle'}
        aria-pressed={on}
        onClick={() => setUi({ imageSegments: !on })}
        data-tip="Colorea en la imagen los segmentos del VI del tejido que corta el plano; pasar el ratón: nombre del segmento"
      >
        <i className="img-seg-icon" aria-hidden="true" />
        Segmentos VI
      </button>
      {on && (
        <div
          className="img-seg-model"
          role="group"
          aria-label="Modelo de segmentación de la imagen"
        >
          <button
            className={model === 'LV_AHA17' ? 'active' : ''}
            aria-pressed={model === 'LV_AHA17'}
            onClick={() => pick('LV_AHA17')}
            data-tip="AHA 17: el 17 es el casquete apical, sin cavidad"
          >
            17
          </button>
          <button
            className={model === 'LV_16' ? 'active' : ''}
            aria-pressed={model === 'LV_16'}
            onClick={() => pick('LV_16')}
            data-tip="Motilidad: 16 segmentos, los apicales cubren todo el ápex"
          >
            16
          </button>
        </div>
      )}
    </div>
  );
}
