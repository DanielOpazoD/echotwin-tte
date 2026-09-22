import { describe, expect, it } from 'vitest';
import {
  applyConsole,
  consoleCompensation,
  createConsoleState,
  NOISE_FLOOR,
  NOISE_RMS,
  receiverNoise,
  REF_DB,
} from './consolePipeline';
import {
  buildNoiseKernels,
  LATERAL_TAPS,
  MAX_LATERAL_RADIUS,
  type PsfKernels,
} from '../acoustic/psf';
import { COMPOUND_LOOKS } from '../acoustic/acoustics';
import { allocPolarFrame, DEFAULT_ACQUISITION, polarSpecFor, type PolarFrameSpec } from '../types';

/**
 * Receiver noise (decision 91, external audit F03): thermal noise is a complex signal that adds to the echo before
 * envelope detection and passes the receive response. The console used to add a Rayleigh envelope to the detected echo,
 * which fills every speckle null with a positive offset, and drew it independently per sample, a grain finer than the
 * resolution.
 */
const settings = {
  ...DEFAULT_ACQUISITION,
  grayMap: 'linear' as const,
  dynamicRangeDb: 90,
  gainDb: 0,
  edgeEnhance: 0,
  persistence: 0,
  tgcDb: [0, 0, 0, 0, 0, 0, 0, 0],
};

/** Lag-1 correlation of the noise power |n|² along the beam (dl 0, ds 1) or across lines (dl 1, ds 0), mid-depth band. */
function powerCorrelation(
  spec: PolarFrameSpec,
  k: PsfKernels,
  dl: number,
  ds: number,
  frames = 3,
): number {
  const { lines: L, samples: N } = spec;
  const re = new Float32Array(L * N),
    im = new Float32Array(L * N),
    tr = new Float32Array(L * N),
    ti = new Float32Array(L * N);
  let c = 0;
  for (let f = 0; f < frames; f++) {
    receiverNoise(k, L, N, f, 4242, re, im, tr, ti);
    let sxy = 0,
      sx = 0,
      sy = 0,
      sxx = 0,
      syy = 0,
      n = 0;
    for (let li = L > 1 ? 8 : 0; li < (L > 1 ? L - 8 - dl : 1); li++)
      for (let si = Math.floor(0.4 * N); si < Math.floor(0.6 * N) - ds; si++) {
        const x = re[li * N + si]! ** 2 + im[li * N + si]! ** 2;
        const y = re[(li + dl) * N + si + ds]! ** 2 + im[(li + dl) * N + si + ds]! ** 2;
        sxy += x * y;
        sx += x;
        sy += y;
        sxx += x * x;
        syy += y * y;
        n++;
      }
    c +=
      (sxy / n - (sx / n) * (sy / n)) /
      Math.sqrt((sxx / n - (sx / n) ** 2) * (syy / n - (sy / n) ** 2)) /
      frames;
  }
  return c;
}

/** |ρ(1)|² of a unit-energy kernel: the power correlation at lag 1 of complex Gaussian noise filtered by it. */
const lagOnePower = (w: ArrayLike<number>, from: number, to: number): number => {
  let s = 0;
  for (let j = from; j < to; j++) s += w[j]! * w[j + 1]!;
  return s * s;
};

describe('receiver noise', () => {
  it('adds to the echo before detection: a steady echo reads the Rician second moment, and noise alone its floor over √looks', () => {
    const spec = polarSpecFor(settings, 'medium');
    const { lines: L, samples: N } = spec;
    const A = 2 * NOISE_FLOOR;
    const frame = allocPolarFrame(spec);
    frame.amplitude.fill(A);
    const display = new Uint8ClampedArray(L * N);
    applyConsole(frame, settings, createConsoleState(99), display);
    const comp = new Float64Array(N);
    consoleCompensation(settings, spec, comp);
    let m2 = 0,
      n = 0;
    for (let li = 0; li < L; li++)
      for (let si = Math.floor(0.3 * N); si < Math.floor(0.7 * N); si++) {
        const db =
          (display[li * N + si]! / 255) * settings.dynamicRangeDb -
          settings.dynamicRangeDb +
          REF_DB;
        const env = Math.pow(10, db / 20) / comp[si]!;
        m2 += env * env;
        n++;
      }
    // |A + n|² averages A² + E|n|²; an envelope added after detection averages A² + 2A·NOISE_FLOOR + E|n|², 76% more here
    expect(m2 / n / (A * A + NOISE_RMS * NOISE_RMS)).toBeGreaterThan(0.95);
    expect(m2 / n / (A * A + NOISE_RMS * NOISE_RMS)).toBeLessThan(1.05);
    const k = buildNoiseKernels(spec, settings.frequencyMHz, settings.harmonics);
    const re = new Float32Array(L * N),
      im = new Float32Array(L * N);
    receiverNoise(k, L, N, 0, 7, re, im, new Float32Array(L * N), new Float32Array(L * N));
    let mean = 0;
    for (let i = 0; i < L * N; i++) mean += Math.hypot(re[i]!, im[i]!) / (L * N);
    // the receiver's floor is per look; the console adds it once, to the compounded envelope (decision 145)
    expect(mean / (NOISE_FLOOR / Math.sqrt(COMPOUND_LOOKS))).toBeCloseTo(1, 1);
  });

  it('has the grain of the receive response, not of the sampling, along and across the beam', () => {
    const spec = polarSpecFor(settings, 'high');
    const k = buildNoiseKernels(spec, settings.frequencyMHz, settings.harmonics);
    const mid = Math.floor(spec.samples / 2);
    const R = k.lateralRadius[mid]!;
    const centre = mid * LATERAL_TAPS + MAX_LATERAL_RADIUS;
    const expectedLateral = lagOnePower(k.lateral, centre - R, centre + R);
    const expectedAxial = lagOnePower(k.axial, 0, k.axial.length - 1);
    // white noise per sample would read 0 in both directions
    expect(expectedLateral).toBeGreaterThan(0.3);
    expect(expectedAxial).toBeGreaterThan(0.3);
    expect(Math.abs(powerCorrelation(spec, k, 1, 0) - expectedLateral)).toBeLessThan(0.06);
    expect(Math.abs(powerCorrelation(spec, k, 0, 1) - expectedAxial)).toBeLessThan(0.06);
  });

  it('an M-mode line takes the axial response at its own finer sampling', () => {
    const frame = polarSpecFor(settings, 'medium');
    const line = { ...frame, lines: 1, samples: Math.round(frame.depthCm / 0.02) };
    const k = buildNoiseKernels(line, settings.frequencyMHz, settings.harmonics);
    expect(k.lateral.length).toBe(0);
    const expected = lagOnePower(k.axial, 0, k.axial.length - 1);
    expect(expected).toBeGreaterThan(0.6);
    expect(Math.abs(powerCorrelation(line, k, 0, 1, 40) - expected)).toBeLessThan(0.06);
  });
});
