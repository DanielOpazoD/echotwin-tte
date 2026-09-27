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

/**
 * Whether the screen may name the case (decision 234). A case's title is its diagnosis («Estenosis aórtica severa…»), and
 * so are the measurements it requires: during an exam the image, the case selector, the report and the measurement list
 * said what the learner was asked to find. They name it again once the exam is finished, for the debrief.
 */
export function showsCaseIdentity(mode: ProductMode, examFinished: boolean): boolean {
  return mode !== 'exam' || examFinished;
}

/** Name shown for the case while its identity is hidden. */
export const EXAM_CASE_NAME = 'Caso de examen';

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

/** The case's name in an exported file: its id, or a neutral tag while the exam hides it (decision 234). */
export function exportCaseTag(mode: ProductMode, examFinished: boolean, caseId: string): string {
  return showsCaseIdentity(mode, examFinished) ? caseId : 'examen';
}
