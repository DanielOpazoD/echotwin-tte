import { describe, expect, it } from 'vitest';
import { buildPsfKernels, ENVELOPE_NORM, formEnvelope, lateralFwhmMm, axialFwhmMm, LATERAL_TAPS, MAX_LATERAL_RADIUS } from './psf';
import { PHASOR_NORM, SCATTER_FREQ, SCATTER_FREQ_RATIO } from './acoustics';
import { latticeNoise3, noiseLattice } from '@/core/noise';
import { DEFAULT_ACQUISITION, polarSpecFor } from '../types';

/** Small deterministic PRNG for the synthetic scatterer fields of these tests. */
function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussPair(rng: () => number): [number, number] {
  const u = Math.max(1e-12, rng()),
    v = rng();
  const m = Math.sqrt(-2 * Math.log(u));
  return [m * Math.cos(2 * Math.PI * v), m * Math.sin(2 * Math.PI * v)];
}

describe('point spread function and envelope', () => {
  const spec = polarSpecFor({ ...DEFAULT_ACQUISITION }, 'medium');

  it('kernels have unit energy and the lateral beam widens with depth beyond the near field', () => {
    const k = buildPsfKernels(spec, 2.5, true);
    let e = 0;
    for (const w of k.axial) e += w * w;
    expect(e).toBeCloseTo(1, 5);
    for (const si of [20, 100, 200]) {
      let el = 0;
      for (let j = 0; j < LATERAL_TAPS; j++) el += (k.lateral[si * LATERAL_TAPS + j] ?? 0) ** 2;
      expect(el).toBeCloseTo(1, 5);
      expect(k.lateralRadius[si]).toBeLessThanOrEqual(MAX_LATERAL_RADIUS);
    }
    expect(lateralFwhmMm(15, 9, 2.5, true)).toBeGreaterThan(lateralFwhmMm(9, 9, 2.5, true));
    expect(lateralFwhmMm(9, 9, 2.5, true)).toBeGreaterThan(lateralFwhmMm(3, 9, 2.5, true));
    expect(lateralFwhmMm(9, 9, 2.5, true)).toBeLessThan(lateralFwhmMm(9, 9, 2.5, false)); // harmonic beam is narrower
    expect(axialFwhmMm(3.5, false)).toBeLessThan(axialFwhmMm(2.5, false)); // higher frequency, finer axial cell
  });

  it('the beam-width artifact widens the lateral beam away from the focus, not at it', () => {
    expect(lateralFwhmMm(14, 6, 2.5, true, 1)).toBeGreaterThan(lateralFwhmMm(14, 6, 2.5, true, 0) * 1.5);
    expect(lateralFwhmMm(6, 6, 2.5, true, 1)).toBeCloseTo(lateralFwhmMm(6, 6, 2.5, true, 0), 6);
  });

  it('fully developed speckle: circular Gaussian scatterers give a Rayleigh envelope whose mean is the backscatter', () => {
    const { lines, samples } = spec;
    const n = lines * samples;
    const re = new Float32Array(n),
      im = new Float32Array(n);
    const rng = mulberry32(7);
    for (let i = 0; i < n; i++) {
      const [a, b] = gaussPair(rng);
      re[i] = a * Math.SQRT1_2;
      im[i] = b * Math.SQRT1_2;
    }
    const amp = new Float32Array(n);
    formEnvelope(re, im, lines, samples, buildPsfKernels(spec, 2.5, true), amp, new Float32Array(n), new Float32Array(n));
    let s = 0,
      s2 = 0;
    const from = Math.floor(samples * 0.15),
      to = Math.floor(samples * 0.85);
    let cnt = 0;
    for (let li = 10; li < lines - 10; li++)
      for (let si = from; si < to; si++) {
        const v = amp[li * samples + si]!;
        s += v;
        s2 += v * v;
        cnt++;
      }
    const mean = s / cnt;
    const std = Math.sqrt(s2 / cnt - mean * mean);
    expect(mean).toBeGreaterThan(0.95);
    expect(mean).toBeLessThan(1.05);
    expect(mean / std).toBeGreaterThan(1.8); // Rayleigh: 1.913
    expect(mean / std).toBeLessThan(2.03);
    expect(ENVELOPE_NORM).toBeCloseTo(2 / Math.sqrt(Math.PI), 10);
  });

  it('the tissue-anchored scatterer phasor has zero mean, unit power and uncorrelated parts', () => {
    const latA = noiseLattice(11),
      latB = noiseLattice(11 ^ 0x2545f491),
      latC = noiseLattice(11 ^ 0x51);
    const rng = mulberry32(3);
    let sr = 0,
      si = 0,
      srr = 0,
      sii = 0,
      sri = 0;
    const N = 60000;
    for (let k = 0; k < N; k++) {
      const x = rng() * 10 * SCATTER_FREQ,
        y = rng() * 10 * SCATTER_FREQ,
        z = rng() * 10 * SCATTER_FREQ;
      const zr = (latticeNoise3(x, y, z, latA) + latticeNoise3(x * SCATTER_FREQ_RATIO + 37.3, y * SCATTER_FREQ_RATIO + 11.9, z * SCATTER_FREQ_RATIO + 23.7, latB) - 1) * PHASOR_NORM;
      const zi = (latticeNoise3(x + 71.1, y + 53.5, z + 5.3, latC) + latticeNoise3(x * SCATTER_FREQ_RATIO + 17.9, y * SCATTER_FREQ_RATIO + 91.1, z * SCATTER_FREQ_RATIO + 43.3, latA) - 1) * PHASOR_NORM;
      sr += zr;
      si += zi;
      srr += zr * zr;
      sii += zi * zi;
      sri += zr * zi;
    }
    expect(Math.abs(sr / N)).toBeLessThan(0.03);
    expect(Math.abs(si / N)).toBeLessThan(0.03);
    expect((srr + sii) / N).toBeGreaterThan(0.94);
    expect((srr + sii) / N).toBeLessThan(1.06);
    expect(Math.abs(sri / N)).toBeLessThan(0.03);
  });
});
