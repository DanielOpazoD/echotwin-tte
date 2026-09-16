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
/**
 * Myocardial angular response is set by the beam·fibre alignment, not the wall normal: the mid-wall
 * helix runs ~circumferentially around the LV long axis, so backscatter is strongest with the beam
 * across the fibres and drops to the floor (≈ −16 dB) when the beam runs along them — the PSAX
 * lateral-wall dropout — while apical walls in long-axis views stay lit because the circumferential
 * fibres lie out of the image plane.
 */
export const MYO_ANISO_FLOOR = 0.15;
/**
 * E[cos²α] over the transmural fibre helix: the fibre pitch rotates through the wall (≈ ±40–60° about
 * the circumferential direction), so a PSF volume averages a spread of orientations — 0.9 ≈ fibres
 * dominated by the circumferential component, the rest weighted onto the long axis.
 */
export const MYO_HELIX_COS2 = 0.9;
/** Below this radius from the long axis the circumferential direction is undefined: no fibre response. */
export const MYO_ANISO_RADIAL_EPS = 1e-3;

/**
 * Angular gain of a myocardial sample from the beam direction in heart frame: `dphi` is the beam's
 * component along the circumferential direction at the sample and `dz2` its squared component along
 * the long axis. Beam across the fibres → 1; beam along the fibres → the floor.
 */
export function myoAnisoGain(dphi: number, dz2: number): number {
  return (
    MYO_ANISO_FLOOR +
    (1 - MYO_ANISO_FLOOR) * (1 - MYO_HELIX_COS2 * dphi * dphi - (1 - MYO_HELIX_COS2) * dz2)
  );
}
/** Backscatter heterogeneity: spatial frequency (cycles/cm) and peak-to-peak depth (dB) per tissue. */
export const HETERO_FREQ = 1.6;
export const HETERO_DB_MYO = 6;
export const HETERO_DB_LIVER = 4;
export const HETERO_DB_MUSCLE = 4;
/** Coherent (specular) echo at the interface sample: specular coefficient × |n·d|⁴ × gain. */
export const SPECULAR_GAIN = 1.0;
/** Harmonic imaging factor on the specular echo. */
export const SPECULAR_HARMONIC = 1.1;
/** Lower bound of |n·d| in the interface window, so grazing interfaces still occupy one sample. */
export const SPECULAR_WINDOW_MIN = 0.15;

export const REVERB_PERIOD_MIN_CM = 0.4;
export const REVERB_WIDTH_CM = 0.12;
export const REVERB_DECAY = 0.55;
export const REVERB_GAIN = 0.9;
export const REVERB_DIFFUSE = 0.02;
/** Noise that modulates the diffuse reverberation floor: base + amplitude · lattice(line·f, r·f, z). */
export const REVERB_MOD_BASE = 0.4;
export const REVERB_MOD_AMP = 0.6;
export const REVERB_MOD_LINE_FREQ = 0.7;
export const REVERB_MOD_DEPTH_FREQ = 4;
export const REVERB_MOD_Z = 3.1;
/** Reverberation energy is incoherent: a phasor tied to the line (line·f) and the depth (r·SCATTER_FREQ). */
export const REVERB_PHASOR_LINE_FREQ = 0.9;
export const REVERB_PHASOR_RE_A_Z = 17.3;
export const REVERB_PHASOR_RE_B: readonly [number, number, number] = [5.1, 2.3, 29.9];
export const REVERB_PHASOR_IM_A: readonly [number, number, number] = [9.7, 13.1, 41.3];
export const REVERB_PHASOR_IM_B: readonly [number, number, number] = [3.3, 7.7, 53.9];
/** The pleural line itself: a strong coherent reflector, base + amplitude · lattice(line·f, r·f, z). */
export const PLEURA_BASE = 1.2;
export const PLEURA_AMP = 0.4;
export const PLEURA_LINE_FREQ = 0.8;
export const PLEURA_DEPTH_FREQ = 3;
export const PLEURA_Z = 1;

/** Blood backscatter with harmonic imaging (fundamental suppressed). */
export const BLOOD_HARMONIC_SIGMA = 0.6;
/** Lattice offsets of the heterogeneity noise (material coordinates · HETERO_FREQ + offset). */
export const HETERO_OFFSET: readonly [number, number, number] = [5.3, 1.7, 9.1];
/** Calcified tissue adds bright, grainy backscatter: gain · (base + amp · lattice(m · freq + offset)). */
export const CALCIUM_GAIN = 1.5;
export const CALCIUM_BASE = 0.6;
export const CALCIUM_AMP = 0.8;
export const CALCIUM_FREQ = 6;
export const CALCIUM_OFFSET: readonly [number, number, number] = [3.3, 1.1, 9.2];
/** Elevational slice half-width (cm) at depth r: base + slope · |r − focus| (decision 48). */
export const SLICE_HALF_BASE_CM = 0.2;
export const SLICE_HALF_SLOPE = 0.04;
/** Lattice offsets of the two-term complex scatterer phasor (decision 52); the M-mode line uses the same. */
export const PHASOR_RE_B: readonly [number, number, number] = [37.3, 11.9, 23.7];
export const PHASOR_IM_A: readonly [number, number, number] = [71.1, 53.5, 5.3];
export const PHASOR_IM_B: readonly [number, number, number] = [17.9, 91.1, 43.3];
/** Two-way amplitude loss: 0.23 Np per dB·cm⁻¹·MHz⁻¹ of one-way attenuation, integrated over the sample (decision 89). */
export const ATTEN_NP_PER_DB = 0.23;
/** Calcified tissue (extraReflect above the threshold) adds ≈ 10 dB/cm at 2.5 MHz: NP per 0.07 cm of sample. */
export const CALCIUM_ATTEN_THRESHOLD = 0.4;
export const CALCIUM_ATTEN_NP = 0.09;
export const CALCIUM_ATTEN_REF_CM = 0.07;
/** A poor acoustic window attenuates the chest wall tissues (fat, muscle, skin) up to this factor more. */
export const WINDOW_ATTEN_GAIN = 1.5;
/** Transmission floor: nothing below it is drawn, and the march never underflows. */
export const TRANSMISSION_FLOOR = 1e-4;
/** Near-field clutter: reverberation in the chest wall under the footprint, incoherent, fixed to the probe. */
export const CLUTTER_MAX_CM = 4.5;
export const CLUTTER_DECAY_CM = 1.8;
export const CLUTTER_BASE = 0.15;
export const CLUTTER_AMP = 0.5;
export const CLUTTER_MOD_FREQ = 6;
export const CLUTTER_MOD_LINE_FREQ = 0.7;
export const CLUTTER_MOD_DEPTH_FREQ = 5;
export const CLUTTER_FREQ = 25;
export const CLUTTER_LINE_FREQ = 0.9;
export const CLUTTER_RE_A_X = 3.1;
export const CLUTTER_RE_B: readonly [number, number] = [8.3, 1.9];
export const CLUTTER_IM_A: readonly [number, number, number] = [61.7, 5.5, 3.3];
export const CLUTTER_IM_B: readonly [number, number, number] = [21.1, 44.4, 9.9];
/** Transducer ring-down in the first samples: gain · (1 − r / extent). */
export const RINGDOWN_CM = 0.35;
export const RINGDOWN_GAIN = 0.6;

export function pleuralReverberation(
  rCm: number,
  entryCm: number,
  transmission: number,
  modulation: number,
): number {
  if (rCm <= entryCm) return 0;
  const d = rCm - entryCm;
  const period = Math.max(entryCm, REVERB_PERIOD_MIN_CM);
  const k = d / period;
  const first = Math.max(0, Math.floor(k) - 1);
  let decay = Math.pow(REVERB_DECAY, first + 1);
  let band = 0;
  for (let j = 0; j < 4; j++) {
    const offset = (d - (first + j) * period) / REVERB_WIDTH_CM;
    band += decay * Math.exp(-offset * offset);
    decay *= REVERB_DECAY;
  }
  const diffuse = REVERB_DIFFUSE * Math.pow(REVERB_DECAY, k + 1) * modulation;
  return transmission * (REVERB_GAIN * band + diffuse);
}

export function heteroDb(tissue: number): number {
  return tissue === Tissue.Myocardium
    ? HETERO_DB_MYO
    : tissue === Tissue.Liver
      ? HETERO_DB_LIVER
      : tissue === Tissue.Muscle
        ? HETERO_DB_MUSCLE
        : 0;
}

/**
 * Every acoustic constant the GLSL passes read, by its GLSL name. `acousticDefinesGlsl` emits one `#define` per
 * entry, so a constant added here reaches the shader without editing a second list; `glslParity.test.ts` checks
 * that each define is used by some pass and that no numeric literal is written on both sides.
 */
export const ACOUSTIC_GLSL_CONSTANTS: Readonly<
  Record<string, number | readonly [number, number] | readonly [number, number, number]>
> = {
  SCATTER_FREQ,
  SCATTER_FREQ_RATIO,
  PHASOR_NORM,
  MYO_ANISO_FLOOR,
  MYO_HELIX_COS2,
  MYO_ANISO_RADIAL_EPS,
  HETERO_FREQ,
  HETERO_DB_MYO,
  HETERO_DB_LIVER,
  HETERO_DB_MUSCLE,
  HETERO_OFFSET,
  SPECULAR_GAIN,
  SPECULAR_HARMONIC,
  SPECULAR_WINDOW_MIN,
  REVERB_PERIOD_MIN_CM,
  REVERB_WIDTH_CM,
  REVERB_DECAY,
  REVERB_GAIN,
  REVERB_DIFFUSE,
  REVERB_MOD_BASE,
  REVERB_MOD_AMP,
  REVERB_MOD_LINE_FREQ,
  REVERB_MOD_DEPTH_FREQ,
  REVERB_MOD_Z,
  REVERB_PHASOR_LINE_FREQ,
  REVERB_PHASOR_RE_A_Z,
  REVERB_PHASOR_RE_B,
  REVERB_PHASOR_IM_A,
  REVERB_PHASOR_IM_B,
  PLEURA_BASE,
  PLEURA_AMP,
  PLEURA_LINE_FREQ,
  PLEURA_DEPTH_FREQ,
  PLEURA_Z,
  BLOOD_HARMONIC_SIGMA,
  CALCIUM_GAIN,
  CALCIUM_BASE,
  CALCIUM_AMP,
  CALCIUM_FREQ,
  CALCIUM_OFFSET,
  SLICE_HALF_BASE_CM,
  SLICE_HALF_SLOPE,
  PHASOR_RE_B,
  PHASOR_IM_A,
  PHASOR_IM_B,
  ATTEN_NP_PER_DB,
  CALCIUM_ATTEN_THRESHOLD,
  CALCIUM_ATTEN_NP,
  CALCIUM_ATTEN_REF_CM,
  WINDOW_ATTEN_GAIN,
  TRANSMISSION_FLOOR,
  CLUTTER_MAX_CM,
  CLUTTER_DECAY_CM,
  CLUTTER_BASE,
  CLUTTER_AMP,
  CLUTTER_MOD_FREQ,
  CLUTTER_MOD_LINE_FREQ,
  CLUTTER_MOD_DEPTH_FREQ,
  CLUTTER_FREQ,
  CLUTTER_LINE_FREQ,
  CLUTTER_RE_A_X,
  CLUTTER_RE_B,
  CLUTTER_IM_A,
  CLUTTER_IM_B,
  RINGDOWN_CM,
  RINGDOWN_GAIN,
};

/** A number as a GLSL float literal (`1` → `1.0`, `1e-4` → `1e-4`). */
export function glslFloat(v: number): string {
  return Number.isInteger(v) ? `${v}.0` : `${v}`;
}

export function acousticDefinesGlsl(envelopeNorm: number): string {
  const lines = Object.entries(ACOUSTIC_GLSL_CONSTANTS).map(([name, v]) =>
    typeof v === 'number'
      ? `#define ${name} ${glslFloat(v)}`
      : `#define ${name} vec${v.length}(${v.map(glslFloat).join(', ')})`,
  );
  lines.push(`#define ENVELOPE_NORM ${glslFloat(envelopeNorm)}`);
  return lines.join('\n');
}
