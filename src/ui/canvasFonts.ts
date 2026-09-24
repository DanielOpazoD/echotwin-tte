/**
 * The interface's type for canvas text (decision 198): the same self-hosted Inter and JetBrains Mono the stylesheet
 * uses, so what the overlays write on the image and the cut map matches the panels. A frame drawn before the font
 * file arrives falls back to the system face and the next frame catches up.
 */
export const UI_FONT = "'Inter Variable', Inter, system-ui, sans-serif";
export const MONO_FONT =
  "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, Menlo, monospace";

/** A canvas font string: optional weight, size in px, one of the two faces. */
export function canvasFont(sizePx: number, face: 'ui' | 'mono' = 'ui', weight?: number): string {
  return `${weight ? `${weight} ` : ''}${sizePx}px ${face === 'mono' ? MONO_FONT : UI_FONT}`;
}
