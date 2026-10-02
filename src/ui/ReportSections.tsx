import { useRef, type ReactNode } from 'react';
import { useSimStore } from '@/app/store';
import { modePolicy } from '@/app/modePolicy';
import { useSlidingPill } from './useSlidingPill';

export type ReportSectionId = 'report' | 'curriculum' | 'progress';

/** The case report, the curriculum and the progress share one tab of the top bar (decision 244). */
export const REPORT_SECTIONS: { id: ReportSectionId; label: string }[] = [
  { id: 'report', label: 'Caso' },
  { id: 'curriculum', label: 'Currículo' },
  { id: 'progress', label: 'Progreso' },
];

export function isReportSection(screen: string): screen is ReportSectionId {
  return REPORT_SECTIONS.some((s) => s.id === screen);
}

/**
 * The «Informe» tab: a small segmented control over the section it shows. The curriculum and the progress stay closed
 * in exam mode, as they were as screens of their own.
 */
export function ReportSections({ children }: { children: ReactNode }) {
  const screen = useSimStore((s) => s.ui.screen);
  const setUi = useSimStore((s) => s.setUi);
  const learning = useSimStore((s) => modePolicy(s.mode).learningScreensEnabled);
  const navRef = useRef<HTMLElement>(null);
  const pill = useSlidingPill(navRef, screen);
  return (
    <div className="screen-group">
      <div className="screen-group-head">
        <nav className="nav-seg screen-tabs" aria-label="Secciones del informe" ref={navRef}>
          {pill && <span className="seg-pill" style={pill} aria-hidden="true" />}
          {REPORT_SECTIONS.map((sec) => (
            <button
              key={sec.id}
              className={screen === sec.id ? 'active' : ''}
              aria-current={screen === sec.id ? 'page' : undefined}
              onClick={() => setUi({ screen: sec.id })}
              disabled={sec.id !== 'report' && !learning}
            >
              {sec.label}
            </button>
          ))}
        </nav>
      </div>
      {children}
    </div>
  );
}
