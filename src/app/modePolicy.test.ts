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
    // the exam asks the learner to recognise the view: its name and score stay hidden (decision 154)
    showViewFeedback: false,
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
