// @tier fast
import { describe, expect, it } from 'vitest';
import { assessEvidence, summarizeEvidence, type EvidenceObservation } from './validationEvidence';
const observation: EvidenceObservation = {
  id: 'phantom',
  value: 1,
  unit: 'm/s',
  criterion: { min: 0.99, max: 1.01 },
  reference: 'Analytical tone: 1 m/s',
};
describe('fidelity evidence cannot silently hide missing or repaired limitations', () => {
  it('distinguishes measured success, failure, active debt and repaired debt', () => {
    expect(assessEvidence(observation)).toBe('pass');
    expect(assessEvidence({ ...observation, value: 0.8 })).toBe('fail');
    const limitation = { id: 'known', reason: 'Declared model defect' };
    expect(assessEvidence({ ...observation, value: 0.8, limitation })).toBe('known-limitation');
    expect(assessEvidence({ ...observation, limitation })).toBe('resolved-limitation');
    expect(summarizeEvidence([{ ...observation, limitation }]).passed).toBe(false);
  });
  it('non-finite values, duplicate evidence and an empty report cannot pass', () => {
    expect(
      assessEvidence({
        ...observation,
        value: NaN,
        limitation: { id: 'known', reason: 'Declared' },
      }),
    ).toBe('fail');
    expect(() => summarizeEvidence([observation, observation])).toThrow('Duplicate');
    expect(summarizeEvidence([]).passed).toBe(false);
  });
  it('requires a criterion and provenance', () => {
    expect(() => assessEvidence({ ...observation, criterion: {} })).toThrow();
    expect(() => assessEvidence({ ...observation, reference: '' })).toThrow();
    for (const criterion of [{ min: NaN }, { max: Infinity }, { min: 2, max: 1 }])
      expect(() => assessEvidence({ ...observation, criterion })).toThrow('finite and ordered');
  });
});
