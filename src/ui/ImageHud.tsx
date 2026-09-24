import { useHudStore, useSimStore } from '@/app/store';
import { modePolicy } from '@/app/modePolicy';
import { listCases } from '@/cases';
import { isStripModality } from '@/simulator/renderer/modality';
import type { ProductMode } from '@/app/modePolicy';

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
  const strip = useSimStore((s) => isStripModality(s.modality));
  const hud = useHudStore((h) => h.hud);
  if (!show) return null;
  const gpuReason = typeof hud?.stats?.['gpu'] === 'string' ? hud.stats['gpu'] : null;
  const tier = typeof hud?.stats?.['tier'] === 'string' ? hud.stats['tier'] : null;
  const title = listCases().find((c) => c.id === caseId)?.title ?? caseId;
  // the view line sits bottom-right on the 2D image; with a strip below the sector it joins the top-right group, off
  // the strip's velocity scale
  const viewLine = modePolicy(mode).showViewFeedback ? <ViewLine mode={mode} /> : null;
  return (
    <div className="img-hud">
      <div className="hud-box hud-tl">
        <span className="hud-title">{title}</span>
      </div>
      <div className="hud-box hud-tr">
        <span>
          FC {hud ? Math.round(hud.heartRateBpm) : '—'} lpm
          {truth ? ` · ${RHYTHM_LABEL[truth.rhythm] ?? truth.rhythm}` : ''}
        </span>
        <span>
          {depthCm} cm · {frequencyMHz.toFixed(1)} MHz{harmonics ? ' THI' : ''}
        </span>
        <span>
          FR {hud ? Math.round(hud.simulatedFps) : '—'} Hz
          {hud && hud.colorFps > 0 ? ` · color ${Math.round(hud.colorFps)}` : ''}
        </span>
        {strip ? viewLine : null}
        {gpuReason && gpuReason !== 'ok' ? (
          // the image is formed by the CPU tracer (no WebGL2, or the context was lost): slower and, on «auto», coarser
          <span className="hud-warn" title={gpuReason}>
            Sin GPU · trazador CPU{tier ? `, calidad ${TIER_LABEL[tier] ?? tier}` : ''}
          </span>
        ) : null}
      </div>
      {!strip && viewLine ? <div className="hud-box hud-br">{viewLine}</div> : null}
    </div>
  );
}

/** The recognised view and its score, with a ring in the colour of the guide; null in exam mode. */
function ViewLine({ mode }: { mode: ProductMode }) {
  const hud = useHudStore((h) => h.hud);
  if (!modePolicy(mode).showViewFeedback) return null;
  return (
    <span className="hud-view">
      {hud?.view ? (
        <i
          className="mini-ring"
          aria-hidden="true"
          style={{
            ['--p' as string]: `${Math.max(0, Math.min(100, hud.view.score))}%`,
            color:
              hud.view.score >= 75
                ? 'var(--ok)'
                : hud.view.score >= 50
                  ? 'var(--warn)'
                  : 'var(--bad)',
          }}
        />
      ) : null}
      Vista {hud?.view?.bestViewId ? `${hud.view.bestViewId.toUpperCase()} ${hud.view.score}` : '—'}
    </span>
  );
}
