import { describe, expect, it } from 'vitest';
import { buildLineKernels, buildPsfKernels, ENVELOPE_NORM, filteredScattererPower, formEnvelope, formEnvelopeLine, lateralFwhmMm, axialFwhmMm, LATERAL_TAPS, LINE_LATTICE_PATH, MAX_LATERAL_RADIUS } from './psf';
import { SPECULAR_WINDOW_MIN } from './acoustics';
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

  // Decision 84: an M-mode line is sampled four times finer than a frame so an echo can move by less than a frame sample.
  // Finer samples of the same scatterer lattice are correlated and add coherently under the axial pulse, and an interface
  // spreads over more taps; the line kernels must return the frame's levels for both.
  describe('M-mode line kernels keep the frame levels at a finer sampling', () => {
    const latA = noiseLattice(5),
      latB = noiseLattice(5 ^ 0x2545f491),
      latC = noiseLattice(5 ^ 0x51);
    const R = SCATTER_FREQ_RATIO;
    const dir = [0.3, -0.8, 0.52].map((v, _i, a) => v / Math.hypot(...a));
    /**
     * Mean envelope of lattice speckle sampled at `samples` over the frame depth and scaled by `scale`: along oblique rays in
     * material coordinates as a frame line samples it, or along the M-mode line's lattice path (`across` fixes the across-beam
     * lattice position, in cells, instead of drawing it per ray).
     */
    const speckleMean = (samples: number, k: { axialRadius: number; axial: Float32Array; lateralRadius: Uint8Array; lateral: Float32Array; key: string }, scale: number, rays: number, path: 'frame' | 'line', across?: number): number => {
      const dr = spec.depthCm / samples;
      const re = new Float32Array(samples),
        im = new Float32Array(samples),
        amp = new Float32Array(samples);
      let acc = 0,
        cnt = 0;
      for (let t = 0; t < rays; t++) {
        const o = [t * 3.7 + 1.1, t * 1.3 + 7.9, t * 2.9 + 3.3];
        for (let i = 0; i < samples; i++) {
          const r = (i + 0.5) * dr;
          let x: number, y: number, z: number;
          if (path === 'frame') {
            x = (o[0]! + dir[0]! * r) * SCATTER_FREQ;
            y = (o[1]! + dir[1]! * r) * SCATTER_FREQ;
            z = (o[2]! + dir[2]! * r) * SCATTER_FREQ;
          } else {
            const u = (o[0]! + r) * SCATTER_FREQ;
            x = u;
            y = (across ?? o[1]! * 7) + u * LINE_LATTICE_PATH[1];
            z = (across ?? o[2]! * 7) + u * LINE_LATTICE_PATH[2];
          }
          re[i] = (latticeNoise3(x, y, z, latA) + latticeNoise3(x * R + 37.3, y * R + 11.9, z * R + 23.7, latB) - 1) * PHASOR_NORM * scale;
          im[i] = (latticeNoise3(x + 71.1, y + 53.5, z + 5.3, latC) + latticeNoise3(x * R + 17.9, y * R + 91.1, z * R + 43.3, latA) - 1) * PHASOR_NORM * scale;
        }
        formEnvelopeLine(re, im, samples, k, amp, new Float32Array(samples), new Float32Array(samples));
        for (let i = 20; i < samples - 20; i++) {
          acc += amp[i]!;
          cnt++;
        }
      }
      return acc / cnt;
    };
    /** Peak envelope of a perpendicular interface deposited on the samples its window covers, averaged over sub-sample positions. */
    const interfacePeak = (samples: number, k: { axialRadius: number; axial: Float32Array; lateralRadius: Uint8Array; lateral: Float32Array; key: string }, amplitude: number): number => {
      const dr = spec.depthCm / samples;
      const re = new Float32Array(samples),
        im = new Float32Array(samples),
        amp = new Float32Array(samples);
      let acc = 0;
      const positions = 40;
      for (let j = 0; j < positions; j++) {
        re.fill(0);
        const r0 = 8 + (j / positions) * (spec.depthCm / spec.samples);
        for (let i = 0; i < samples; i++) if (Math.abs(r0 - (i + 0.5) * dr) < Math.max(1, SPECULAR_WINDOW_MIN) * dr) re[i] = amplitude;
        formEnvelopeLine(re, im, samples, k, amp, new Float32Array(samples), new Float32Array(samples));
        acc += Math.max(...amp);
      }
      return acc / positions;
    };

    it('the filtered power of the scatterer lattice follows its autocorrelation: 1 at the frame spacing, +4.25 dB at a quarter of it', () => {
      const frame = buildPsfKernels(spec, 2.5, true);
      const line = buildLineKernels(spec, spec.samples * 4, 2.5, true);
      expect(filteredScattererPower(frame.axial, spec.depthCm / spec.samples)).toBeCloseTo(1, 2);
      const db = 10 * Math.log10(filteredScattererPower(line.axial, spec.depthCm / (spec.samples * 4)));
      expect(db).toBeGreaterThan(4.0);
      expect(db).toBeLessThan(4.5);
      // the analytic value is what the lattice does: the mean envelope of the unscaled line against the frame's, in dB of
      // amplitude, is the power ratio in dB of power (the envelope mean follows √power)
      const measured = 20 * Math.log10(speckleMean(spec.samples * 4, line, 1, 40, 'frame') / speckleMean(spec.samples, frame, 1, 160, 'frame'));
      expect(Math.abs(measured - db)).toBeLessThan(0.25);
    });

    it('speckle and interface echoes of a line four times finer have the levels of a frame line', () => {
      const frame = buildPsfKernels(spec, 2.5, true);
      const frameSpeckle = speckleMean(spec.samples, frame, 1, 160, 'frame');
      for (const samples of [spec.samples * 2, 800, spec.samples * 4]) {
        const line = buildLineKernels(spec, samples, 2.5, true);
        const rays = Math.ceil((160 * spec.samples) / samples);
        const speckleDb = 20 * Math.log10(speckleMean(samples, line, line.incoherent, rays, 'line') / frameSpeckle);
        expect(Math.abs(speckleDb)).toBeLessThan(0.3);
        // a single cursor sits at one across-beam lattice position for its whole length: mid-cell, where value noise has
        // half the variance of a lattice point, must not dim the line
        const fixedDb = 20 * Math.log10(speckleMean(samples, line, line.incoherent, rays, 'line', 40.5) / frameSpeckle);
        expect(Math.abs(fixedDb)).toBeLessThan(0.5);
        const interfaceDb = 20 * Math.log10(interfacePeak(samples, line, line.specular) / interfacePeak(spec.samples, frame, 1));
        expect(Math.abs(interfaceDb)).toBeLessThan(0.3);
      }
    });
  });
});
