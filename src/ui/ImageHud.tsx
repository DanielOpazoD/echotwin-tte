import { useHudStore, useSimStore } from '@/app/store';
import { modePolicy } from '@/app/modePolicy';
import { listCases } from '@/cases';

const TIER_LABEL: Record<string, string> = { low: 'baja', medium: 'media', high: 'alta' };

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
  const gpuReason = typeof hud?.stats?.['gpu'] === 'string' ? hud.stats['gpu'] : null;
  const tier = typeof hud?.stats?.['tier'] === 'string' ? hud.stats['tier'] : null;
  const title = listCases().find((c) => c.id === caseId)?.title ?? caseId;
  return (
    <div className="img-hud">
      <div className="hud-box hud-tl">
        <span className="hud-title">
          {title}
          {frozen ? ' · congelada' : ''}
        </span>
      </div>
      <div className="hud-box hud-tr">
        <span>
          FC {hud ? Math.round(hud.heartRateBpm) : '—'} lpm
          {truth ? ` · ${RHYTHM_LABEL[truth.rhythm] ?? truth.rhythm}` : ''}
        </span>
        <span>
          {depthCm} cm · {frequencyMHz.toFixed(1)} MHz{harmonics ? ' THI' : ''}
        </span>
        {gpuReason && gpuReason !== 'ok' ? (
          // the image is formed by the CPU tracer (no WebGL2, or the context was lost): slower and, on «auto», coarser
          <span className="hud-warn" title={gpuReason}>
            Sin GPU · trazador CPU{tier ? `, calidad ${TIER_LABEL[tier] ?? tier}` : ''}
          </span>
        ) : null}
      </div>
      <div className="hud-box hud-br">
        <span>
          FR {hud ? Math.round(hud.simulatedFps) : '—'} Hz
          {hud && hud.colorFps > 0 ? ` · color ${Math.round(hud.colorFps)}` : ''}
        </span>
        {modePolicy(mode).showViewFeedback ? (
          <span className="hud-view">
            Vista{' '}
            {hud?.view?.bestViewId ? `${hud.view.bestViewId.toUpperCase()} ${hud.view.score}` : '—'}
          </span>
        ) : null}
      </div>
    </div>
  );
}
