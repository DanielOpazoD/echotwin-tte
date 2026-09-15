import { describe, expect, it } from 'vitest';
import {
  BREATH_PERIOD_S,
  inflowRespiratoryVariation,
  INSPIRATION_FRACTION,
  respiratoryDepth,
} from './respiration';

describe('free breathing (decision 108)', () => {
  it('inspiration deepens and releases smoothly once per breath, and the inflow variation grows with tamponade', () => {
    expect(respiratoryDepth(0)).toBeCloseTo(0, 9);
    expect(respiratoryDepth(INSPIRATION_FRACTION * BREATH_PERIOD_S)).toBeCloseTo(1, 9);
    expect(respiratoryDepth(1.3 * BREATH_PERIOD_S)).toBeCloseTo(
      respiratoryDepth(0.3 * BREATH_PERIOD_S),
      9,
    );
    let worst = 0;
    for (let t = 0; t < BREATH_PERIOD_S; t += 0.001)
      worst = Math.max(worst, Math.abs(respiratoryDepth(t + 0.001) - respiratoryDepth(t)));
    expect(worst).toBeLessThan(0.003);
    expect(inflowRespiratoryVariation(0)).toEqual({ mitral: 0.16, tricuspid: 0.2 });
    const tamponade = inflowRespiratoryVariation(0.8);
    expect(tamponade.mitral).toBeGreaterThan(0.3);
    expect(tamponade.tricuspid).toBeGreaterThan(0.6);
  });
});
