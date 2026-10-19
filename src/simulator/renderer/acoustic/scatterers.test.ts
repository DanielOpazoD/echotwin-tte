/**
 * Point scatterers anchored in tissue (decision 351): one sample's sum is a circular complex Gaussian of unit power,
 * turns with the phase of the tissue's motion along the beam, follows the slice's elevation profile and is independent
 * of its neighbours.
 */
import { describe, expect, it } from 'vitest';
import {
  ELEVATION_REACH_SIGMAS,
  SCATTERER_CELL_CM,
  scattererPhasor,
  wavenumberRadPerCm,
  type Phasor,
} from './scatterers';

const K = wavenumberRadPerCm(2.5, false);
const DR = 0.05,
  WIDTH = 0.06,
  SIGMA_E = 0.17,
  SEED = 7;
/** The phasor of a sample at material position (u, v, w), on a line along the forward axis at depth r. */
function at(u: number, v: number, w: number, r = 9, cosT = 1, sinT = 0, sigmaE = SIGMA_E): Phasor {
  const p = { re: 0, im: 0 };
  scattererPhasor(u, v, w, cosT, sinT, r, DR, WIDTH, sigmaE, K, SEED, p);
  return p;
}
/** Sample positions far enough apart to hold different scatterers. */
const positions = Array.from({ length: 3000 }, (_, i) => [
  (i % 50) * 0.37 + 0.011,
  Math.floor(i / 50) * 0.41 + 0.007,
  0.003,
]);

describe('point scatterers anchored in tissue (decision 351)', () => {
  it('sum to a circular complex Gaussian of unit mean power: a Rayleigh envelope', () => {
    const z = positions.map(([u, v, w]) => at(u!, v!, w!));
    const power = z.reduce((m, p) => m + p.re * p.re + p.im * p.im, 0) / z.length;
    expect(power).toBeGreaterThan(0.93);
    expect(power).toBeLessThan(1.07);
    const vr = z.reduce((m, p) => m + p.re * p.re, 0) / z.length,
      vi = z.reduce((m, p) => m + p.im * p.im, 0) / z.length,
      ri = z.reduce((m, p) => m + p.re * p.im, 0) / z.length;
    expect(Math.abs(vr - vi) / power).toBeLessThan(0.1);
    expect(Math.abs(ri) / power).toBeLessThan(0.05);
    // the envelope's mean over its standard deviation: 1.91 for Rayleigh
    const a = z.map((p) => Math.hypot(p.re, p.im));
    const m = a.reduce((s, x) => s + x, 0) / a.length;
    const sd = Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length);
    expect(m / sd).toBeGreaterThan(1.8);
    expect(m / sd).toBeLessThan(2.02);
  });

  it('turns by −2kδ when the tissue moves δ along the beam, and keeps its pattern', () => {
    // the tissue moves 0.02 mm deeper: the material point under the sample is 0.02 mm shallower in the tissue
    const d = 0.002;
    let cr = 0,
      ci = 0,
      p0 = 0;
    for (const [u, v, w] of positions) {
      const a = at(u!, v!, w!),
        b = at(u! - d, v!, w!);
      cr += b.re * a.re + b.im * a.im;
      ci += b.im * a.re - b.re * a.im;
      p0 += a.re * a.re + a.im * a.im;
    }
    // the mean of b·conj(a): its angle is the motion's phase, its length how much of the pattern stays
    expect(Math.atan2(ci, cr)).toBeCloseTo(-2 * K * d, 1);
    expect(Math.hypot(cr, ci) / p0).toBeGreaterThan(0.9);
  });

  it('follows the slice across the plane: a small shift keeps the echo, one past its reach changes it', () => {
    const corr = (dw: number) => {
      let c = 0,
        p = 0;
      for (const [u, v, w] of positions) {
        const a = at(u!, v!, w!),
          b = at(u!, v!, w! + dw);
        c += a.re * b.re + a.im * b.im;
        p += a.re * a.re + a.im * a.im;
      }
      return c / p;
    };
    expect(corr(0.1 * SIGMA_E)).toBeGreaterThan(0.9);
    expect(Math.abs(corr(2 * ELEVATION_REACH_SIGMAS * SIGMA_E + SCATTERER_CELL_CM))).toBeLessThan(
      0.1,
    );
  });

  /** |E z·conj(z′)| / E|z|² between the sample at (u, r) and a neighbour moved du in the tissue and dr along the line. */
  const corr = (du: number, dr: number) => {
    let cr = 0,
      ci = 0,
      p = 0;
    for (const [u, v, w] of positions) {
      const a = at(u!, v!, w!, 9),
        b = at(u! + du, v!, w!, 9 + dr);
      cr += a.re * b.re + a.im * b.im;
      ci += a.im * b.re - a.re * b.im;
      p += a.re * a.re + a.im * a.im;
    }
    return Math.hypot(cr, ci) / p;
  };

  it('shares a quarter of its scatterers’ power with the next sample along the line', () => {
    // linear weights over ±1 sample: ∫ t(x) t(x − 1) dx over ∫ t² = (1/6)/(2/3)
    expect(corr(DR, DR)).toBeGreaterThan(0.2);
    expect(corr(DR, DR)).toBeLessThan(0.3);
    expect(corr(2 * DR, 2 * DR)).toBeLessThan(0.06);
  });

  it('keeps the echo of tissue that moves a quarter of a sample, without jumping between samples', () => {
    // linear weights: 1 − 1.5τ² + 0.75τ³ = 0.92 at τ = ¼; deposited on the nearest sample alone, 1 − τ = 0.75
    expect(corr(-DR / 4, 0)).toBeGreaterThan(0.86);
  });

  it('receives harmonic echoes at twice the wavenumber', () => {
    expect(wavenumberRadPerCm(2.5, true)).toBeCloseTo(2 * K, 9);
    expect(K).toBeCloseTo((2 * Math.PI * 2.5) / 0.154, 9);
  });
});
