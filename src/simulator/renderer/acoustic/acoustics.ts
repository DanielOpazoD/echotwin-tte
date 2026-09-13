import { Tissue } from '@/simulator/anatomy/tissue';

/**
 * Acoustic constants shared by the CPU tracer and its WebGL2 port (acoustic image formation, decision 52).
 * GLSL receives them as #defines from `acousticDefinesGlsl`, so both backends read the same numbers.
 */

/** Scatterer lattice frequency (cells per cm): 0.4 mm, finer than the PSF, so the speckle cell comes from the PSF. */
export const SCATTER_FREQ = 25;
/** Second lattice term runs at a slightly different scale so the 128-cell lattices never repeat visibly. */
export const SCATTER_FREQ_RATIO = 1.137;
/**
 * (n₁ + n₂ − 1)·PHASOR_NORM has variance ½ when n is 3D smoothstep value noise on uniform bytes:
 * Var(n) = Var(U)·(1 − 2·E[u(1−u)])³ = 0.08399·0.74286³ = 0.034430, so PHASOR_NORM = √(½ / (2·0.034430)).
 * Real and imaginary parts together give E|z|² = 1.
 */
export const PHASOR_NORM = Math.sqrt(0.5 / (2 * 0.03443));
/** Myocardial backscatter with the beam along the wall, relative to perpendicular incidence (≈ −10 dB). */
export const MYO_ANISO_FLOOR = 0.32;
/** Backscatter heterogeneity: spatial frequency (cycles/cm) and peak-to-peak depth (dB) per tissue. */
export let HETERO_FREQ = 1.6;
export let HETERO_DB_MYO = 6;
/** SWEEP ONLY (worktree): multiplier on blood backscatter. */
export const BLOOD_ECHO = { factor: 1 };
/** SWEEP ONLY (worktree). */
export function setHeterogeneity(freq: number, dbMyo: number): void {
  HETERO_FREQ = freq;
  HETERO_DB_MYO = dbMyo;
}
export const HETERO_DB_LIVER = 4;
export const HETERO_DB_MUSCLE = 4;
/** Coherent (specular) echo at the interface sample: specular coefficient × |n·d|⁴ × gain. */
export const SPECULAR_GAIN = 1.0;
/** Harmonic imaging factor on the specular echo. */
export const SPECULAR_HARMONIC = 1.1;
/** Lower bound of |n·d| in the interface window, so grazing interfaces still occupy one sample. */
export const SPECULAR_WINDOW_MIN = 0.15;

export function heteroDb(tissue: number): number {
  return tissue === Tissue.Myocardium ? HETERO_DB_MYO : tissue === Tissue.Liver ? HETERO_DB_LIVER : tissue === Tissue.Muscle ? HETERO_DB_MUSCLE : 0;
}

export function acousticDefinesGlsl(envelopeNorm: number): string {
  const f = (v: number): string => (Number.isInteger(v) ? `${v}.0` : `${v}`);
  return [
    `#define SCATTER_FREQ ${f(SCATTER_FREQ)}`,
    `#define SCATTER_FREQ_RATIO ${f(SCATTER_FREQ_RATIO)}`,
    `#define PHASOR_NORM ${f(PHASOR_NORM)}`,
    `#define MYO_ANISO_FLOOR ${f(MYO_ANISO_FLOOR)}`,
    `#define HETERO_FREQ ${f(HETERO_FREQ)}`,
    `#define HETERO_DB_MYO ${f(HETERO_DB_MYO)}`,
    `#define HETERO_DB_LIVER ${f(HETERO_DB_LIVER)}`,
    `#define HETERO_DB_MUSCLE ${f(HETERO_DB_MUSCLE)}`,
    `#define SPECULAR_GAIN ${f(SPECULAR_GAIN)}`,
    `#define SPECULAR_HARMONIC ${f(SPECULAR_HARMONIC)}`,
    `#define SPECULAR_WINDOW_MIN ${f(SPECULAR_WINDOW_MIN)}`,
    `#define ENVELOPE_NORM ${f(envelopeNorm)}`,
  ].join('\n');
}
