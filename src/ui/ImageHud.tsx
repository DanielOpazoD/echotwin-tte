import { useHudStore, useSimStore } from '@/app/store';
import { modePolicy } from '@/app/modePolicy';
import { listCases } from '@/cases';

const RHYTHM_LABEL: Record<string, string> = {
  sinus: 'Sinusal',
  'sinus-tachycardia': 'Taquicardia sinusal',
  'sinus-bradycardia': 'Bradicardia sinusal',
  'atrial-fibrillation': 'FA',
};

/**
 * On-image telemetry, where a real scanner prints it: exam name top-left, vitals and acquisition
 * parameters top-right, frame rate and the recognised view bottom-right. Pure overlay — it never
 * intercepts pointer events and disappears with `ui.showHud`.
 */
export function ImageHud() {
  const show = useSimStore((s) => s.ui.showHud);
  const mode = useSimStore((s) => s.mode);
  const caseId = useSimStore((s) => s.caseId);
  const truth = useSimStore((s) => s.truth);
  const depthCm = useSimStore((s) => s.settings.depthCm);
  const frequencyMHz = useSimStore((s) => s.settings.frequencyMHz);
  const harmonics = useSimStore((s) => s.settings.harmonics);
  const frozen = useSimStore((s) => s.frozen);
  const hud = useHudStore((h) => h.hud);
  if (!show) return null;
  const title = listCases().find((c) => c.id === caseId)?.title ?? caseId;
  return (
    <div className="img-hud">
      <div className="hud-box hud-tl">
        {title}
        {frozen ? ' · congelada' : ''}
      </div>
      <div className="hud-box hud-tr">
        <span>
          FC {hud ? Math.round(hud.heartRateBpm) : '—'} lpm
          {truth ? ` · ${RHYTHM_LABEL[truth.rhythm] ?? truth.rhythm}` : ''}
        </span>
        <span>
          {depthCm} cm · {frequencyMHz.toFixed(1)} MHz{harmonics ? ' THI' : ''}
        </span>
      </div>
      <div className="hud-box hud-br">
        <span>
          FR {hud ? Math.round(hud.simulatedFps) : '—'} Hz
          {hud && hud.colorFps > 0 ? ` · color ${Math.round(hud.colorFps)}` : ''}
        </span>
        {modePolicy(mode).showViewFeedback ? (
          <span>
            Vista{' '}
            {hud?.view?.bestViewId ? `${hud.view.bestViewId.toUpperCase()} ${hud.view.score}` : '—'}
          </span>
        ) : null}
      </div>
    </div>
  );
}
