import { describe, expect, it } from 'vitest';
import {
  aliasVelocity,
  bsaDuBois,
  bsaMosteller,
  cardiacOutput,
  circularArea,
  continuityAva,
  dopplerShiftHz,
  ejectionFraction,
  maxPrfForDepth,
  nyquistVelocity,
  rvspFromTr,
  simplifiedBernoulli,
  simpsonBiplaneVolume,
  strokeVolume,
  velocityRatio,
  vtiFromEnvelope,
} from './index';
import { formatClinical } from '../reference-values';

describe('clinical formulas', () => {
  it('BSA Mosteller / DuBois for 175 cm, 75 kg', () => {
    expect(bsaMosteller(175, 75)).toBeCloseTo(1.909, 2);
    expect(bsaDuBois(175, 75)).toBeCloseTo(1.9, 1);
  });
  it('Bernoulli 4 m/s → 64 mmHg', () => {
    expect(simplifiedBernoulli(4)).toBe(64);
  });
  it('LVOT 2.0 cm & VTI 20 cm → SV ≈ 62.8 mL; continuity AVA with AV VTI 80 → 0.785 cm²', () => {
    expect(circularArea(2)).toBeCloseTo(Math.PI, 9);
    expect(strokeVolume(2, 20)).toBeCloseTo(62.83, 1);
    expect(continuityAva(2, 20, 80)).toBeCloseTo(0.785, 2);
    expect(velocityRatio(20, 80)).toBe(0.25);
  });
  it('EF and CO', () => {
    expect(ejectionFraction(120, 45)).toBeCloseTo(62.5, 6);
    expect(cardiacOutput(75, 65)).toBeCloseTo(4.875, 6);
    expect(() => ejectionFraction(100, 120)).toThrow();
  });
  it('RVSP from TR 2.8 m/s + RAP 3 = 34.36', () => {
    expect(rvspFromTr(2.8, 3)).toBeCloseTo(34.36, 2);
  });
  it('VTI of a half-sine 1 m/s peak over 0.3 s ≈ 19.1 cm', () => {
    const n = 300;
    const dt = 0.3 / n;
    const v = Array.from({ length: n + 1 }, (_, i) => Math.sin((Math.PI * i) / n));
    expect(vtiFromEnvelope(v, dt)).toBeCloseTo((2 / Math.PI) * 0.3 * 100, 1);
  });
  it('Simpson biplane of a cylinder equals π/4·a·b·L', () => {
    const d = Array(20).fill(4);
    expect(simpsonBiplaneVolume(d, d, 8)).toBeCloseTo(Math.PI * 4 * 8, 6);
  });
  it('Doppler physics: shift, Nyquist, PRF', () => {
    expect(dopplerShiftHz(2.5e6, 1, 1)).toBeCloseTo(3246.75, 1);
    expect(nyquistVelocity(4000, 2.5e6)).toBeCloseTo(0.616, 3);
    expect(maxPrfForDepth(0.1)).toBe(7700);
  });
  it('aliasing wraps velocities beyond Nyquist to the opposite side', () => {
    expect(aliasVelocity(0.5, 0.6)).toBeCloseTo(0.5, 9);
    expect(aliasVelocity(0.8, 0.6)).toBeCloseTo(-0.4, 9);
    expect(aliasVelocity(-0.8, 0.6)).toBeCloseTo(0.4, 9);
    // baseline shifted up by 0.3 → range [-0.3, 0.9]
    expect(aliasVelocity(0.8, 0.6, 0.3)).toBeCloseTo(0.8, 9);
    expect(aliasVelocity(-0.5, 0.6, 0.3)).toBeCloseTo(0.7, 9);
  });
  it('formatClinical rounds at presentation only', () => {
    expect(formatClinical(2.0499, 'linearCm')).toBe('2.0 cm');
    expect(formatClinical(64.4, 'gradientMmHg')).toBe('64 mmHg');
    expect(formatClinical(null, 'velocityMps')).toBe('—');
  });
});
