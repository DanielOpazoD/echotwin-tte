export type ProductMode = 'sandbox' | 'guided' | 'exam';

export interface ModePolicy {
  /** Live view id + score in the top bar and view hints in the guidance panel. */
  showViewFeedback: boolean;
  /** Preset probe poses ("PLAX", "A4C"… buttons). */
  presetsEnabled: boolean;
  /** Hints toggle and hint content. */
  hintsEnabled: boolean;
  /** Curriculum / progress / references screens reachable. */
  learningScreensEnabled: boolean;
  /** Automatic curriculum task evaluation runs on each frame. */
  evaluateCurriculum: boolean;
  /** Physics overlay and dev panel may be shown. */
  devToolsAllowed: boolean;
}

/** What each product mode hides or disables. Extracted so the rules live in one place. */
export function modePolicy(mode: ProductMode): ModePolicy {
  const exam = mode === 'exam';
  return {
    // Today the top bar still shows the view score in exam mode — a known defect a later
    // clinical PR will fix; kept true here to pin current behavior.
    showViewFeedback: true,
    presetsEnabled: !exam,
    hintsEnabled: !exam,
    learningScreensEnabled: !exam,
    evaluateCurriculum: !exam,
    devToolsAllowed: !exam,
  };
}
