/**
 * Point scatterers anchored in tissue (decision 351): the incoherent echo of a polar sample as the sum of the discrete
 * scatterers that fall in it, each with its own amplitude and the phase of its depth, the convolution model of speckle
 * (Bamber & Dickinson 1980) as COLE forms it (Gao et al., IEEE TUFFC 2009;56:1077-1082). The lattice phasor of
 * decision 52 is band-limited value noise at the material coordinates: it moves with the tissue but keeps its pattern
 * when the tissue slides along the beam. Scatterers carry the phase of their depth, so a quarter wavelength of motion
 * turns the echo by π, and their sum is a circular complex Gaussian (Rayleigh envelope) for any tissue.
 *
 * The scatterers sit one per cube of SCATTERER_CELL_CM of material space, jittered by a hash of the cube, with a
 * zero-mean unit-variance amplitude: about 8 per mm³, some 50 per resolution cell at 9 cm. The cubes are aligned with the
 * probe's axes (forward, lateral, normal at the centre line), expressed in the material frame: a sample then visits the
 * cubes of its rotated neighbourhood in the plane and the layers of the slice across it. Each scatterer reaches the two
 * nearest samples along the line and the two nearest lines with linear weights, and the slice's elevation profile (a
 * Gaussian of the slice thickness) across the plane. Deposited on the nearest sample alone, a scatterer's echo stayed at
 * that sample's centre until it jumped to the next: tissue moving less than a sample turned every phase together and
 * left the envelope's pattern in place, and speckle tracking read 0.12 of the shortening in the moving heart. The sum
 * is scaled to unit mean power, as the lattice phasor is.
 *
 * Parenchyma holds two populations (decision 356): the dense weak scatterers and a sparse one of strong scatterers
 * (STRONG_SCATTERER_FRACTION of the cubes, STRONG_SCATTERER_GAIN times the amplitude), the fibre sheets, vessel walls and
 * connective tissue of the classic two-population model of tissue. They carry about half of its echo power and draw the
 * bright isolated grains of a real myocardium; with one population the residual grey of the myocardium was symmetric
 * (log skewness 0.05, CAMUS Good 0.53) whatever the anatomy.
 *
 * No store, no DOM; the CPU tracer calls it per sample when its image formation asks for scatterers.
 */
import { STRONG_SCATTERER_FRACTION, STRONG_SCATTERER_GAIN } from './acoustics';

export { STRONG_SCATTERER_FRACTION, STRONG_SCATTERER_GAIN };

/** Edge of the material cube that holds one scatterer (cm): 0.5 mm. */
export const SCATTERER_CELL_CM = 0.05;
/** How far across the plane the slice's elevation profile is summed, in its standard deviations. */
export const ELEVATION_REACH_SIGMAS = 2.5;
/** Speed of sound (cm/µs): the phase of a scatterer at depth r is −2kr with k = 2πf/c. */
export const SOUND_SPEED_CM_PER_US = 0.154;

/** Wavenumber (rad/cm) of the received echo at `frequencyMHz` (twice the transmit frequency in harmonic imaging). */
export function wavenumberRadPerCm(frequencyMHz: number, harmonics: boolean): number {
  return (2 * Math.PI * frequencyMHz * (harmonics ? 2 : 1)) / SOUND_SPEED_CM_PER_US;
}

/** 32-bit integer hash of a cube and a channel (a lowbias32-style mix). */
function hash(i: number, j: number, k: number, c: number, seed: number): number {
  let h = (i * 0x8da6b343) ^ (j * 0xd8163841) ^ (k * 0xcb1ab31f) ^ (c * 0x165667b1) ^ seed;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}
const U32 = 1 / 4294967296;
const SQRT3 = Math.sqrt(3);

/** The sample's complex echo, written into `out`. */
export interface Phasor {
  re: number;
  im: number;
}

/** What an image formation with point scatterers hands the tracer: the per-sample sum and the received wavenumber. */
export interface ScatterField {
  phasor: typeof scattererPhasor;
  wavenumber: typeof wavenumberRadPerCm;
}

/**
 * The scatterer phasor of one sample. (u, v, w) are the sample's material position on the probe's axes (cm): forward,
 * lateral and normal at the centre line. The line runs at angle θ from the forward axis in the plane (cosT, sinT);
 * `rCm` is the sample's depth, `drCm` its spacing along the line, `widthCm` the line spacing across it at that depth and
 * `elevSigmaCm` the standard deviation of the slice's elevation profile. `k` is the wavenumber (rad/cm). `strong` is the
 * fraction of cubes that hold a strong scatterer: STRONG_SCATTERER_FRACTION in parenchyma, 0 elsewhere.
 */
export function scattererPhasor(
  u: number,
  v: number,
  w: number,
  cosT: number,
  sinT: number,
  rCm: number,
  drCm: number,
  widthCm: number,
  elevSigmaCm: number,
  k: number,
  seed: number,
  strong: number,
  out: Phasor,
): void {
  const c = SCATTER_CELL;
  const halfA = drCm,
    halfL = widthCm;
  const reachE = ELEVATION_REACH_SIGMAS * elevSigmaCm;
  // the box of the sample in the plane, rotated by θ: its bounding box on the cubes
  const hu = Math.abs(cosT) * halfA + Math.abs(sinT) * halfL,
    hv = Math.abs(sinT) * halfA + Math.abs(cosT) * halfL;
  const i0 = Math.floor((u - hu) / c),
    i1 = Math.floor((u + hu) / c);
  const j0 = Math.floor((v - hv) / c),
    j1 = Math.floor((v + hv) / c);
  const k0 = Math.floor((w - reachE) / c),
    k1 = Math.floor((w + reachE) / c);
  const inv2s2 = 1 / (2 * elevSigmaCm * elevSigmaCm);
  let sr = 0,
    si = 0;
  for (let kk = k0; kk <= k1; kk++)
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const pu = (i + hash(i, j, kk, 0, seed) * U32) * c - u,
          pv = (j + hash(i, j, kk, 1, seed) * U32) * c - v,
          pw = (kk + hash(i, j, kk, 2, seed) * U32) * c - w;
        const da = pu * cosT + pv * sinT;
        if (da <= -halfA || da >= halfA) continue;
        const dl = -pu * sinT + pv * cosT;
        if (dl <= -halfL || dl >= halfL || Math.abs(pw) > reachE) continue;
        // a zero-mean, unit-variance amplitude: the sum of four uniforms (variance 1/3), centred and scaled by √3
        let g =
          ((hash(i, j, kk, 3, seed) + hash(i, j, kk, 4, seed)) * U32 +
            (hash(i, j, kk, 5, seed) + hash(i, j, kk, 6, seed)) * U32 -
            2) *
          SQRT3;
        // a strong scatterer of parenchyma (decision 356)
        if (strong > 0 && hash(i, j, kk, 7, seed) * U32 < strong) g *= STRONG_SCATTERER_GAIN;
        // linear weights to the neighbouring samples and lines, the elevation profile across the plane
        const a =
          g * (1 - Math.abs(da) / halfA) * (1 - Math.abs(dl) / halfL) * Math.exp(-pw * pw * inv2s2);
        const ph = -2 * k * (rCm + da);
        sr += a * Math.cos(ph);
        si += a * Math.sin(ph);
      }
  // unit mean power: the expected Σ a² is the density times ∫ (1 − |x|/Δ)² dx = 2Δ/3 along and across, times
  // ∫ exp(−e²/σ²) de = √π σ across the plane
  // the strong scatterers' share of it: E[g²] = 1 − p + p·A²
  const n =
    (((2 / 3) * drCm * (2 / 3) * widthCm * Math.sqrt(Math.PI) * elevSigmaCm) / (c * c * c)) *
    (1 - strong + strong * STRONG_SCATTERER_GAIN * STRONG_SCATTERER_GAIN);
  const norm = n > 0 ? 1 / Math.sqrt(n) : 0;
  out.re = sr * norm;
  out.im = si * norm;
}
const SCATTER_CELL = SCATTERER_CELL_CM;

/** The point scatterers of decision 351, for an `ImageFormation`. */
export const SCATTER_FIELD: ScatterField = {
  phasor: scattererPhasor,
  wavenumber: wavenumberRadPerCm,
};
