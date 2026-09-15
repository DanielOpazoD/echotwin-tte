import { describe, expect, it } from 'vitest';
import { modePolicy, type ModePolicy, type ProductMode } from './modePolicy';

const ALL_ON: ModePolicy = {
  showViewFeedback: true,
  presetsEnabled: true,
  hintsEnabled: true,
  learningScreensEnabled: true,
  evaluateCurriculum: true,
  devToolsAllowed: true,
};

const EXPECTED: Record<ProductMode, ModePolicy> = {
  sandbox: ALL_ON,
  guided: ALL_ON,
  exam: {
    // Pinned current defect: the view score IS still shown in exam (the top bar displays it).
    // A later clinical PR will flip this to false; update this row then.
    showViewFeedback: true,
    presetsEnabled: false,
    hintsEnabled: false,
    learningScreensEnabled: false,
    evaluateCurriculum: false,
    devToolsAllowed: false,
  },
};

describe('modePolicy', () => {
  it.each(Object.entries(EXPECTED) as [ProductMode, ModePolicy][])('%s → %o', (mode, policy) => {
    expect(modePolicy(mode)).toEqual(policy);
  });
});
