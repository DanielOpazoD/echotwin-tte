import { describe, expect, it } from 'vitest';
import { summarizeEnvelope } from './vti';

describe('summarizeEnvelope', () => {
  it('integrates a half-sine envelope: VTI ≈ 2/π·v·T and Bernoulli gradients', () => {
    // 1 m/s half-sine over 0.3 s sampled per ms: analytic VTI = 2/π·0.3 s = 19.1 cm
    const n = 301;
    const vel = Array.from({ length: n }, (_, i) => Math.sin((Math.PI * i) / (n - 1)));
    const s = summarizeEnvelope(vel, 0.001);
    expect(s.vtiCm).toBeCloseTo(19.1, 1);
    expect(s.vmaxMps).toBeCloseTo(1, 2);
    expect(s.peakGradientMmHg).toBeCloseTo(4, 1);
    // mean gradient of a half-sine: 4·mean(v²) = 4·0.5 = 2 mmHg
    expect(s.meanGradientMmHg).toBeCloseTo(2, 1);
  });

  it('takes the magnitude of a signed (CW) envelope', () => {
    const s = summarizeEnvelope([-4, -4, -4], 0.01);
    expect(s.vmaxMps).toBeCloseTo(4, 6);
    expect(s.peakGradientMmHg).toBeCloseTo(64, 6);
    expect(s.meanGradientMmHg).toBeCloseTo(64, 6);
    expect(s.vtiCm).toBeCloseTo(8, 6); // 2 intervals × 4 m/s × 0.01 s
  });

  it('returns zeros for an empty or single-point envelope', () => {
    expect(summarizeEnvelope([], 0.01)).toEqual({ vtiCm: 0, vmaxMps: 0, meanGradientMmHg: 0, peakGradientMmHg: 0 });
    expect(summarizeEnvelope([1.2], 0.01).vtiCm).toBe(0);
  });
});
