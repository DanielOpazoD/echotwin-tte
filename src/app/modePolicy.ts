export type ProductMode = 'sandbox' | 'guided' | 'exam';

export interface ModePolicy {
  /** The recognised view and its score: image HUD, measurement list and technique grade (hidden in exam). */
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
    // the recognised view and its score would tell the learner what the exam asks them to recognise (decision 154)
    showViewFeedback: !exam,
    presetsEnabled: !exam,
    hintsEnabled: !exam,
    learningScreensEnabled: !exam,
    evaluateCurriculum: !exam,
    devToolsAllowed: !exam,
  };
}
