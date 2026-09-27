// @tier slow
import { describe, expect, it } from 'vitest';
import { fall, inflowPeaks as peaks, rise } from './inflowPeaks.testkit';

/**
 * Respiratory variation of the inflows through the core (decision 108), in tamponade. Each case lives in a file of its own so that CI
 * runs them in parallel (decision 239).
 */
describe('free breathing through the core (decision 108)', () => {
  it('in tamponade the mitral E falls more than 30% with inspiration and the tricuspid E rises more than 60%', () => {
    const mitral = peaks('pericardial-effusion-tamponade', 'free-breathing', false);
    const tricuspid = peaks('pericardial-effusion-tamponade', 'free-breathing', true);
    expect(mitral.length).toBeGreaterThan(15);
    // before: the tables were the same in every beat whatever the breathing
    expect(fall(mitral), mitral.map((v) => v.toFixed(2)).join(' ')).toBeGreaterThan(0.3);
    expect(fall(mitral)).toBeLessThan(0.45);
    expect(rise(tricuspid), tricuspid.map((v) => v.toFixed(2)).join(' ')).toBeGreaterThan(0.6);
  });
});
