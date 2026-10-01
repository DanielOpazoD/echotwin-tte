// @tier slow
import { describe, expect, it } from 'vitest';
import { fall, inflowPeaks as peaks, rise } from './inflowPeaks.testkit';

/**
 * Respiratory variation of the inflows through the core (decision 108), in a normal heart. Each case lives in a file of its own so that CI
 * runs them in parallel (decision 239).
 */
describe('free breathing through the core (decision 108)', () => {
  it('a normal heart varies within the normal limits, and holding the breath does not vary', () => {
    const mitral = peaks('normal-excellent-window', 'free-breathing', false);
    // normal respiratory variation of the mitral E: 95% limits 6–26%
    expect(fall(mitral), mitral.map((v) => v.toFixed(2)).join(' ')).toBeGreaterThan(0.06);
    expect(fall(mitral)).toBeLessThan(0.26);
    expect(rise(peaks('normal-excellent-window', 'free-breathing', true))).toBeLessThan(0.3);
    expect(fall(peaks('normal-excellent-window', 'expiration', false))).toBeLessThan(0.05);
  });
});
