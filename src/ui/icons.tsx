import type { ReactNode } from 'react';

/**
 * Minimal stroke icon set for the console (24×24 grid, 1.7px stroke, round caps).
 * Kept local and dependency-free; each glyph reads at small sizes in the tab bar.
 */
function I({ children, size = 15 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** Ultrasound sector fan — acquisition / probe work. */
export function IconAcquire({ size }: { size?: number }) {
  return (
    <I size={size}>
      <circle cx="12" cy="3.6" r="1.4" fill="currentColor" stroke="none" />
      <path d="M12 3.6 4.4 20.4" />
      <path d="M12 3.6l7.6 16.8" />
      <path d="M4.4 20.4a18.9 18.9 0 0 0 15.2 0" />
    </I>
  );
}

/** Framed picture — B-mode image controls. */
export function IconImage({ size }: { size?: number }) {
  return (
    <I size={size}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m5.5 18.5 5-5 3 3 3.5-3.5 3.5 3.5" />
    </I>
  );
}

/** Spectral pulse — Doppler modalities. */
export function IconDoppler({ size }: { size?: number }) {
  return (
    <I size={size}>
      <path d="M3 12h3.5L9 5.5l4.5 13L16 12h5" />
    </I>
  );
}

/** Caliper jaws — measurement tools. */
export function IconMeasure({ size }: { size?: number }) {
  return (
    <I size={size}>
      <path d="M6 3v4.5L10.5 12 8 21" />
      <path d="M18 3v4.5L13.5 12 16 21" />
      <path d="M6 3h12" />
    </I>
  );
}

/** Conical flask — artifact laboratory. */
export function IconLab({ size }: { size?: number }) {
  return (
    <I size={size}>
      <path d="M9 3h6" />
      <path d="M10 3v5.2L5.2 18.6A2 2 0 0 0 7 21.4h10a2 2 0 0 0 1.8-2.8L14 8.2V3" />
      <path d="M7.5 14.5h9" />
    </I>
  );
}

/** Crosshair with a dot — review-mode markers (decision 134). */
export function IconReview({ size }: { size?: number }) {
  return (
    <I size={size}>
      <circle cx="12" cy="12" r="7" />
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" />
    </I>
  );
}

/** Horizontal sliders — overflow / display options menu. */
export function IconSliders({ size }: { size?: number }) {
  return (
    <I size={size}>
      <path d="M4 6h10M18 6h2" />
      <circle cx="16" cy="6" r="2" />
      <path d="M4 12h4M12 12h8" />
      <circle cx="10" cy="12" r="2" />
      <path d="M4 18h13M21 18h-1" />
      <circle cx="19" cy="18" r="2" />
    </I>
  );
}

/** Check mark for menu toggles. */
export function IconCheck({ size }: { size?: number }) {
  return (
    <I size={size}>
      <path d="M4.5 12.5 10 18 19.5 6.5" />
    </I>
  );
}

/** Chevron pointing right: a collapsible section's header turns it down when open. */
export function IconChevronRight({ size }: { size?: number }) {
  return (
    <I size={size}>
      <path d="m9 6 6 6-6 6" />
    </I>
  );
}
