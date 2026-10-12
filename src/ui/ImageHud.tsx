import { useLayoutEffect, useRef } from 'react';
import { viewLabel } from '@/simulator/windows/viewLabels';
import { useHudStore, useSimStore } from '@/app/store';
import { EXAM_CASE_NAME, modePolicy, showsCaseIdentity } from '@/app/modePolicy';
import { listCases } from '@/cases';
import { isStripModality } from '@/simulator/renderer/modality';
import type { ProductMode } from '@/app/modePolicy';
import { formatMHz } from './format';

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
  const examFinished = useSimStore((s) => s.examFinished);
  const truth = useSimStore((s) => s.truth);
  const depthCm = useSimStore((s) => s.settings.depthCm);
  const frequencyMHz = useSimStore((s) => s.settings.frequencyMHz);
  const harmonics = useSimStore((s) => s.settings.harmonics);
  const strip = useSimStore((s) => isStripModality(s.modality));
  const hud = useHudStore((h) => h.hud);
  // the title wraps to two lines on a narrow image: the segment chip below it reads its height (--hud-tl-h) to keep clear
  const titleBoxRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const box = titleBoxRef.current;
    const host = box?.parentElement?.parentElement;
    if (!box || !host) return;
    // and the title leaves the width of the acquisition box on its right (--hud-tr-w), whatever its lines say
    const right = box.parentElement?.querySelector<HTMLElement>('.hud-tr') ?? null;
    const publish = () => {
      host.style.setProperty('--hud-tl-h', `${box.offsetHeight}px`);
      if (right) host.style.setProperty('--hud-tr-w', `${right.offsetWidth}px`);
    };
    publish();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(publish);
    ro.observe(box);
    if (right) ro.observe(right);
    return () => ro.disconnect();
  }, [show]);
  if (!show) return null;
  const gpuReason = typeof hud?.stats?.['gpu'] === 'string' ? hud.stats['gpu'] : null;
  const tier = typeof hud?.stats?.['tier'] === 'string' ? hud.stats['tier'] : null;
  const title = showsCaseIdentity(mode, examFinished)
    ? (listCases().find((c) => c.id === caseId)?.title ?? caseId)
    : EXAM_CASE_NAME;
  // the view line sits bottom-right on the 2D image; with a strip below the sector it joins the top-right group, off
  // the strip's velocity scale
  const viewLine = modePolicy(mode).showViewFeedback ? <ViewLine mode={mode} /> : null;
  return (
    <div className="img-hud">
      <div className="hud-box hud-tl" ref={titleBoxRef}>
        <span className="hud-title" title={title}>
          {title}
        </span>
      </div>
      <div className="hud-box hud-tr">
        <span>
          FC {hud ? Math.round(hud.heartRateBpm) : '—'} lpm
          {truth ? ` · ${RHYTHM_LABEL[truth.rhythm] ?? truth.rhythm}` : ''}
        </span>
        <span>
          {depthCm} cm · {formatMHz(frequencyMHz)}
          {harmonics ? ' THI' : ''}
        </span>
        {/* in colour the frame rate already is the colour one: «· color N» repeated it (decision 195) */}
        <span>FR {hud ? Math.round(hud.simulatedFps) : '—'} Hz</span>
        {strip ? viewLine : null}
        {gpuReason && gpuReason !== 'ok' ? (
          // the image is formed by the CPU tracer (no WebGL2, or the context was lost): slower and, on «auto», coarser
          <span className="hud-warn" data-tip={gpuReason}>
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
      Vista {hud?.view?.bestViewId ? `${viewLabel(hud.view.bestViewId)} ${hud.view.score}` : '—'}
    </span>
  );
}
