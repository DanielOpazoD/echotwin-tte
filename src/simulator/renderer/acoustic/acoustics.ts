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
/**
 * Fibre helix of the LV wall (decision 144): the helix angle from the circumferential direction runs from
 * MYO_HELIX_ENDO_DEG at the endocardium to MYO_HELIX_EPI_DEG at the epicardium (Streeter's ≈ +60° → −60°), so the
 * subendocardial and subepicardial layers are longitudinal and the mid-wall circumferential. Seen from the apex, the
 * beam runs along the fibres of the two edges and across those of the middle, which is why a clinical apical wall is
 * brightest in its middle (CAMUS Good: the endocardial fifth at 0.80–0.84 of the mid-wall grey) where one
 * circumferential direction for the whole wall gave a flat band.
 */
export const MYO_HELIX_ENDO_DEG = 60;
export const MYO_HELIX_EPI_DEG = -60;
/**
 * Angular gain of an LV wall sample: `dphi` is the beam's component along the circumferential direction at the
 * sample (signed), `dz` its component along the long axis and `u` the depth across the wall (0 endocardium,
 * 1 epicardium). Beam across the local fibre → 1; beam along it → the floor.
 */
export function myoHelixGain(dphi: number, dz: number, u: number): number {
  const alpha =
    ((MYO_HELIX_ENDO_DEG + (MYO_HELIX_EPI_DEG - MYO_HELIX_ENDO_DEG) * u) * Math.PI) / 180;
  const c = Math.cos(alpha) * dphi + Math.sin(alpha) * dz;
  return MYO_ANISO_FLOOR + (1 - MYO_ANISO_FLOOR) * (1 - c * c);
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
/**
 * Diffuse reverberation behind the pleura (decision 144): brightest right behind the pleural line and fading with the
 * distance into the lung, as the haze of a real lung does (CAMUS Good: the band 3–9 mm outside the lateral wall at
 * 98, the far background beyond 8 mm from the heart at 79). Until then the floor followed the A-line period, which for
 * a pleura 8 cm deep meant a flat 0.011 for the whole far field: a black band beside the lateral wall.
 */
export const REVERB_DIFFUSE = 0.35;
export const REVERB_DIFFUSE_DECAY_CM = 1.5;
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
/**
 * Compounding (decision 145): the frame is formed from COMPOUND_LOOKS independent speckle realizations — the same
 * scene, the same coherent echoes, a different scatterer phasor per look — and their envelopes are averaged after
 * detection, as a scanner's spatial or frequency compounding averages looks whose speckle differs. A single look is a
 * Rayleigh envelope with its long tail of dark nulls (log-residual skewness −0.2…−0.35 against +0.1…+0.3 in CAMUS
 * Good); the mean of a few looks keeps the bright grains and fills the nulls. Each look shifts the scatterer lattice by
 * LOOK_SHIFT[k] (lattice units), which decorrelates it fully; the M-mode line keeps one look.
 */
export const COMPOUND_LOOKS = 2;
export const LOOK_SHIFT: readonly (readonly [number, number, number])[] = [
  [0, 0, 0],
  [61.7, 23.9, 47.3],
  [29.3, 79.1, 13.7],
  [83.9, 41.3, 67.9],
];
/**
 * Flowing blood (decision 163): its scatterers travel with the flow, 1–20 mm between two frames at 50 Hz where the
 * speckle cell is 0.4 mm deep, so its speckle does not persist from one frame (or M-mode pulse) to the next while the
 * tissue's does, and the scanner's persistence averages it. Each frame shifts the blood's scatterer lattice by
 * BLOOD_DECORRELATION_CELLS lattice units: value noise is uncorrelated beyond two cells.
 */
export const BLOOD_DECORRELATION_CELLS = 2.7;
/** Lattice shift of the blood's scatterers in frame `frame` (the lattice repeats every 128 units, `core/noise.ts`). */
export function bloodShiftCells(frame: number): number {
  return (frame * BLOOD_DECORRELATION_CELLS) % 128;
}
/**
 * Bright grains (decision 145): a sparse coherent component of the parenchyma — bundles and sheets that reflect as a
 * unit — on top of the diffuse scatterers. A fully developed speckle is a Rayleigh envelope whose log-residuals skew
 * negative (dark nulls); the clinical myocardium skews positive (+0.1…+0.3 in CAMUS Good) with bright grains over a
 * smoother ground and its variance sits at the 2–4 mm scale (21 against a 5×5 window's 10). The grain field is a
 * lattice at each tissue's grain frequency (`TISSUE_PROPS.grain`, cycles/cm): where it rises above GRAIN_THRESHOLD a
 * coherent echo of up to GRAIN_GAIN × σ is added, the same in every compounding look.
 */
export const GRAIN_GAIN = 4.8;
export const GRAIN_THRESHOLD = 0.72;
export const GRAIN_OFFSET: readonly [number, number, number] = [43.1, 17.7, 61.3];
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
/**
 * On-axis two-way sensitivity of the beam at depth r relative to its transmit focus (decision 144). The energy a
 * pulse carries spreads over the beam's width: near the face a focused aperture is as wide as the aperture itself
 * (lateral) and as tall as the element (elevation), and only at the focus does it narrow to its diffraction waist,
 * so the same scatterer sends back less from the near field than from the focus; beyond the focus the beam widens
 * again. Widths are the geometric taper of the aperture towards the focus combined in quadrature with the waist,
 * the two-way amplitude the square root of the width ratio in each direction (energy conserved across the beam,
 * receive focusing following transmit). A scanner's default TGC restores the far side (`consoleCompensation`) and
 * leaves the near side to fall, as the images do: CAMUS Good shows the chest wall at 119–138 with the first 2.5 mm
 * at 152 where the renderer, with a beam of constant sensitivity, saturated the first centimetre.
 */
export const FOCUS_HALF_APERTURE_MM = 7;
export const FOCUS_HALF_ELEVATION_MM = 6.5;
export const FOCUS_WAIST_LATERAL_MM = 2;
export const FOCUS_WAIST_ELEVATION_MM = 2;
/** Lateral half-width of the transmit beam at depth r (cm): the aperture tapering to the waist at the focus. */
export function beamHalfWidthCm(rCm: number, focusCm: number): number {
  const taper = 1 - rCm / Math.max(1, focusCm);
  return (
    Math.sqrt(
      FOCUS_HALF_APERTURE_MM * FOCUS_HALF_APERTURE_MM * taper * taper +
        FOCUS_WAIST_LATERAL_MM * FOCUS_WAIST_LATERAL_MM,
    ) / 10
  );
}
export function focusingGain(rCm: number, focusCm: number): number {
  const taper = 1 - rCm / Math.max(1, focusCm);
  const wl = beamHalfWidthCm(rCm, focusCm) * 10;
  const we = Math.sqrt(
    FOCUS_HALF_ELEVATION_MM * FOCUS_HALF_ELEVATION_MM * taper * taper +
      FOCUS_WAIST_ELEVATION_MM * FOCUS_WAIST_ELEVATION_MM,
  );
  return Math.sqrt((FOCUS_WAIST_LATERAL_MM / wl) * (FOCUS_WAIST_ELEVATION_MM / we));
}
/**
 * Thickness of a valve leaflet as the slice sees it (cm; aortic cusps 0.8–1 mm, mitral leaflets 1–2 mm). A leaflet is a
 * membrane thinner than the slice: where the beam meets it edge-on it fills the slice across its whole width and reads
 * as tissue, but where the imaging plane runs along it (its normal along the plane normal) only MEMBRANE_CM of the slice
 * thickness holds tissue and the rest is blood. Point classification cannot tell the two apart: a coaptation surface
 * lying in the long-axis plane read as a bright mass filling the root (decision 147). `membraneWeight` scales the
 * backscatter and interface echo of valve tissue by the fraction of the slice the membrane occupies.
 */
export const MEMBRANE_CM = 0.1;
/**
 * Fraction of the slice a membrane fills: 1 when it stands across the plane (|n·N| = 0) and its thickness over the
 * slice thickness (2 × half width) when it lies in the plane.
 */
export function membraneWeight(normalDotPlane: number, sliceHalfWidthCm: number): number {
  const along = Math.abs(normalDotPlane);
  return MEMBRANE_CM / (MEMBRANE_CM + 2 * sliceHalfWidthCm * along);
}
/** Most lines the beam-attenuation window spans on either side (near the face the beam is wider than the sector). */
export const BEAM_ATTEN_MAX_LINES = 24;
/** Floor of the arc one line spans (cm), so the window at the apex sample stays finite. */
export const BEAM_ATTEN_MIN_ARC_CM = 1e-6;

/** Transducer ring-down in the first samples: gain · (1 − r / extent). */
export const RINGDOWN_CM = 0.35;
export const RINGDOWN_GAIN = 0.05;

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
  const diffuse = REVERB_DIFFUSE * Math.exp(-d / REVERB_DIFFUSE_DECAY_CM) * modulation;
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
  COMPOUND_LOOKS,
  LOOK_SHIFT_1: LOOK_SHIFT[1]!,
  GRAIN_GAIN,
  GRAIN_THRESHOLD,
  GRAIN_OFFSET,
  MEMBRANE_CM,
  MYO_ANISO_FLOOR,
  MYO_HELIX_COS2,
  MYO_ANISO_RADIAL_EPS,
  MYO_HELIX_ENDO_DEG,
  MYO_HELIX_EPI_DEG,
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
  REVERB_DIFFUSE_DECAY_CM,
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
  FOCUS_HALF_APERTURE_MM,
  FOCUS_HALF_ELEVATION_MM,
  FOCUS_WAIST_LATERAL_MM,
  FOCUS_WAIST_ELEVATION_MM,
  BEAM_ATTEN_MAX_LINES,
  BEAM_ATTEN_MIN_ARC_CM,
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
