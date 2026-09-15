import { aliasVelocity } from '@/clinical/formulas';
import { hash3 } from '@/core/random';
import { APERTURE_MM } from '@/simulator/renderer/acoustic/psf';

/**
 * Spectral Doppler column generation (spec 62): velocity distribution → histogram over the
 * displayed velocity range, with intrinsic spectral broadening, turbulence broadening, wall
 * filter, aliasing wrap, gain and noise. Deterministic per column index.
 */
export interface SpectralSettings {
  scaleMps: number; // ±Nyquist (before baseline shift)
  baselineShiftMps: number; // positive shifts the baseline down (more room for positive velocities)
  wallFilterMps: number;
  gainDb: number;
  sweepSpeedMmPerS: number; // 25 / 50 / 100
  gateLengthCm: number; // PW only
  invert: boolean;
  audioOn: boolean;
  volume: number;
}

export const DEFAULT_SPECTRAL: SpectralSettings = {
  scaleMps: 1.0,
  baselineShiftMps: 0,
  wallFilterMps: 0.08,
  gainDb: 0,
  sweepSpeedMmPerS: 50,
  gateLengthCm: 0.4,
  invert: false,
  audioOn: false,
  volume: 0.5,
};

export const SPECTRAL_BINS = 128;

/** Velocity range shown: [vMin, vMax] given scale and baseline shift. */
export function spectralRange(s: SpectralSettings): { vMin: number; vMax: number } {
  const lo = -s.scaleMps + s.baselineShiftMps;
  const hi = s.scaleMps + s.baselineShiftMps;
  return { vMin: lo, vMax: hi };
}

export interface VelocitySample {
  v: number; // axial velocity m/s (positive = toward the transducer)
  weight: number;
  dispersion: number;
  /** Speed across the beam (m/s) and depth (cm) of the sample: they set its geometric spectral broadening. Omitted: none. */
  vPerp?: number;
  depthCm?: number;
}

/** Spectral resolution as a fraction of a display bin: an estimate over as many pulses as the display has bins. */
const RESOLUTION_BINS = 0.6;
/** Turbulent spread (fraction of the sample speed per unit of flow dispersion), drawn toward the baseline only. */
const TURBULENT_SPREAD = 0.9;

/**
 * Standard deviations (m/s) of one sample's spectral line above and below its velocity (decision 96). Above: the spectral
 * resolution, which follows the scale because the pulse repetition frequency does, and the geometric broadening of an
 * aperture seen from the sample (Newhouse et al. 1980: a spread of v⊥·D/F in velocity, here uniform, σ = v⊥·D/(F·√12)).
 * Below, toward the baseline: also the turbulent spread, which fills the spectral window under the envelope instead of
 * lifting it. The envelope used to be a symmetric Gaussian of 0.035·scale + 0.02 m/s plus 0.9·dispersion·|v|: at the
 * mitral tips its outer edge read 0.97 m/s for a 0.75 m/s flow, tissue Doppler 0.15 m/s at a septal base moving at 0.096 m/s, and a
 * 3.8 m/s stenotic jet reached the top of a 6 m/s scale.
 */
export function spectralSpread(
  smp: VelocitySample,
  s: SpectralSettings,
): { up: number; down: number } {
  const { vMin, vMax } = spectralRange(s);
  const resolution = (RESOLUTION_BINS * (vMax - vMin)) / SPECTRAL_BINS;
  const geometric =
    smp.vPerp && smp.depthCm
      ? (Math.abs(smp.vPerp) * (APERTURE_MM / 10)) / (smp.depthCm * Math.sqrt(12))
      : 0;
  const up = Math.hypot(resolution, geometric);
  return { up, down: Math.hypot(up, TURBULENT_SPREAD * smp.dispersion * Math.abs(smp.v)) };
}

/**
 * Raw spectral distribution of one column (SPECTRAL_BINS values, index 0 = vMax at top) before gain and compression.
 * Each sample adds a line with the spread of `spectralSpread` on each side (decisions 87 and 96):
 * - PW (`aliasing`): centred on the aliased velocity and summed around the displayed span, so the part of the distribution
 *   that crosses Nyquist reappears at the other end. It used to fold only the centre and cut the Gaussian at the screen
 *   edge, so energy near Nyquist was lost.
 * - CW: centred on the true velocity, and only the part inside the displayed range is drawn. The velocity used to be
 *   clamped to the range first, so an out-of-range jet stacked at the edge and a wider scale did not move it back.
 */
export function accumulateSpectrum(
  samples: readonly VelocitySample[],
  s: SpectralSettings,
  aliasing: boolean,
  out: Float32Array,
): void {
  const { vMin, vMax } = spectralRange(s);
  const span = vMax - vMin;
  out.fill(0);
  for (const smp of samples) {
    if (smp.weight <= 0) continue;
    if (Math.abs(smp.v) < s.wallFilterMps) continue; // wall filter on true velocity
    let v = s.invert ? -smp.v : smp.v;
    if (aliasing) v = aliasVelocity(v, s.scaleMps, s.baselineShiftMps);
    const spread = spectralSpread(smp, s);
    const centerBin = ((vMax - v) / span) * SPECTRAL_BINS;
    const upBins = (spread.up / span) * SPECTRAL_BINS;
    const downBins = (spread.down / span) * SPECTRAL_BINS;
    // turbulence spreads toward lower speed: bins grow as the displayed velocity falls, so that side is +bins for a flow
    // displayed toward the transducer, and stays so once it aliases (a slower flow wraps to a lower displayed velocity)
    const baselineSide = smp.v >= 0 !== s.invert ? 1 : -1;
    const loSpan = baselineSide > 0 ? upBins : downBins;
    const hiSpan = baselineSide > 0 ? downBins : upBins;
    let lo = Math.floor(centerBin - 3 * loSpan);
    let hi = Math.ceil(centerBin + 3 * hiSpan);
    if (!aliasing) {
      lo = Math.max(0, lo);
      hi = Math.min(SPECTRAL_BINS - 1, hi);
    }
    for (let b = lo; b <= hi; b++) {
      const o = b + 0.5 - centerBin;
      const d = o / (o * baselineSide > 0 ? downBins : upBins);
      const k = aliasing ? ((b % SPECTRAL_BINS) + SPECTRAL_BINS) % SPECTRAL_BINS : b;
      out[k] = (out[k] ?? 0) + smp.weight * Math.exp(-0.5 * d * d);
    }
  }
}

/**
 * Valve clicks (decision 103). A leaflet sweeping through the sample volume as its valve opens or closes returns a brief,
 * strong signal over a wide band of velocities, drawn as a vertical line at the event: the marks that bound flows in time,
 * such as the aortic closure and mitral opening that delimit the isovolumic relaxation time in the apical five-chamber
 * view. A click is 1 for a leaflet inside the sample volume; it is drawn at CLICK_LEVEL of the display before gain,
 * independently of the flow in its column (normalised with the column, a weak click in a column without flow became as
 * bright as a strong one). Its duration (`CLICK_SIGMA_S`, Gaussian), level and spread over the scale are declared
 * values: a brief line of a few milliseconds that reaches most of the displayed range.
 */
export const CLICK_SIGMA_S = 0.002;
const CLICK_LEVEL = 1.5;
const CLICK_SPREAD = 0.7;

/** Noise floor of a spectral column before gain: each bin adds up to this much, uniformly distributed. */
const SPECTRAL_NOISE = 0.05;

/**
 * Display level above which a bin belongs to the envelope (decision 96): 35% of the column's brightest bin, and 1.5× the
 * brightest the noise can draw at this gain, so a column without flow has no envelope. A floor of 0.12 sat under the
 * noise ceiling (0.123 at 0 dB), and an auto-trace starting from the brightest bin read noise as velocities up to 1.1 m/s.
 */
export function envelopeThreshold(columnMax: number, s: SpectralSettings): number {
  return Math.max(
    1.5 * Math.pow(SPECTRAL_NOISE * Math.pow(10, s.gainDb / 20), 0.7),
    0.35 * columnMax,
  );
}

/**
 * The spectrum on the screen is an estimate (decision 115). A spectrum estimated from a finite run of echoes has, at each
 * frequency, exponential statistics around the expected power, correlated over the frequency resolution of the estimate and
 * over its duration, and scanners show it on a logarithmic scale. The column on the screen used to be the expected spectrum
 * itself, normalised and compressed almost linearly: a steady laminar flow drew a white band saturated in every column
 * (standard deviation 0.000), the noise floor was independent from column to column (correlation 0.03) and a CW jet showed
 * the fan of its separate velocity samples. The envelope of the machine is still read from the expected spectrum, as
 * decision 96 calibrated it: read on the grain, it followed bright grains past the flow and dark ones inside it.
 *
 * Duration of one estimate (s): as many pulses as the display has bins (the resolution of `spectralSpread`), at the pulse
 * repetition frequency the scale needs at a nominal 2.5 MHz, T = BINS·c/(4·f0·scale): 16 ms at ±1.2 m/s, within 6-30 ms.
 */
function estimateDurationS(s: SpectralSettings): number {
  return Math.min(
    0.03,
    Math.max(0.006, (SPECTRAL_BINS * 1540) / (4 * 2.5e6 * Math.max(0.05, s.scaleMps))),
  );
}
/** Frequency extent (display bins) of one speckle cell: the resolution of the estimate, whose line has σ = RESOLUTION_BINS. */
const SPECKLE_BINS = 2.5 * RESOLUTION_BINS;
/** Dynamic range (dB) of the display from black to white, and the level (dB) above a normalised peak of 1 that is white (declared). */
const DISPLAY_RANGE_DB = 40;
const WHITE_DB = 6;
/** Receiver noise power relative to a normalised peak of 1 (dB): a dark floor with sparse grain (declared). */
const NOISE_DB = -36;

/** Bin-direction lattice of the speckle: for every display bin, its five nearest lattice nodes and their Gaussian weights. */
const SPECKLE_NODE_OFFSET = 2;
const SPECKLE_NODES =
  Math.round((SPECTRAL_BINS - 0.5) / SPECKLE_BINS) + 2 * SPECKLE_NODE_OFFSET + 1;
const speckleBinNode = new Int16Array(SPECTRAL_BINS * 5);
const speckleBinWeight = new Float64Array(SPECTRAL_BINS * 5);
for (let b = 0; b < SPECTRAL_BINS; b++) {
  const bCells = (b + 0.5) / SPECKLE_BINS;
  const b0 = Math.round(bCells);
  for (let k = 0; k < 5; k++) {
    const e = b0 + k - 2 - bCells;
    speckleBinNode[b * 5 + k] = b0 + k - 2 + SPECKLE_NODE_OFFSET;
    speckleBinWeight[b * 5 + k] = Math.exp(-2 * e * e);
  }
}

/** Lattice rows of complex Gaussian values (re, im per node) at one time index, kept while consecutive columns reuse them. */
const speckleRows = new Map<string, Float64Array>();
function speckleRow(t: number, seed: number, stream: number): Float64Array {
  const key = `${seed}:${stream}:${t}`;
  let row = speckleRows.get(key);
  if (!row) {
    row = new Float64Array(2 * SPECKLE_NODES);
    for (let j = 0; j < SPECKLE_NODES; j++) {
      const node = j - SPECKLE_NODE_OFFSET;
      const u1 = hash3(t, node, stream, seed);
      const u2 = hash3(t, node, stream + 1, seed);
      const r = Math.sqrt(-2 * Math.log(Math.max(1e-12, u1)));
      row[2 * j] = r * Math.cos(2 * Math.PI * u2);
      row[2 * j + 1] = r * Math.sin(2 * Math.PI * u2);
    }
    if (speckleRows.size > 64) speckleRows.delete(speckleRows.keys().next().value as string);
    speckleRows.set(key, row);
  }
  return row;
}

/**
 * Speckle of the estimate over one column: at each bin, the power of a complex Gaussian field, the sum of independent lattice
 * values one estimate apart in time and one speckle cell apart in frequency under a Gaussian kernel of half a cell, normalised
 * to unit mean (exponential). Bilinear weights between four lattice values drew the cells as blocks. The kernel is separable:
 * the five lattice rows of the column are shared with the columns next to it (computed bin by bin, 1.3 ms per column).
 */
function estimateSpeckleColumn(
  tCells: number,
  seed: number,
  stream: number,
  out: Float64Array,
): void {
  const t0 = Math.round(tCells);
  const wt = [0, 0, 0, 0, 0];
  let wt2 = 0;
  const rows: Float64Array[] = [];
  for (let k = 0; k < 5; k++) {
    const e = t0 + k - 2 - tCells;
    wt[k] = Math.exp(-2 * e * e);
    wt2 += wt[k]! * wt[k]!;
    rows.push(speckleRow(t0 + k - 2, seed, stream));
  }
  for (let b = 0; b < SPECTRAL_BINS; b++) {
    let re = 0,
      im = 0,
      wb2 = 0;
    for (let j = 0; j < 5; j++) {
      const node = speckleBinNode[b * 5 + j]!;
      const w = speckleBinWeight[b * 5 + j]!;
      wb2 += w * w;
      let nr = 0,
        ni = 0;
      for (let k = 0; k < 5; k++) {
        nr += wt[k]! * rows[k]![2 * node]!;
        ni += wt[k]! * rows[k]![2 * node + 1]!;
      }
      re += w * nr;
      im += w * ni;
    }
    out[b] = (re * re + im * im) / (2 * wt2 * wb2);
  }
}

/**
 * The column the screen shows (decision 115), from the expected spectrum of `accumulateSpectrum` (not modified): softly
 * normalised as the envelope column is, times the speckle of the estimate, plus receiver noise with its own speckle and the
 * valve click, on a logarithmic scale of `DISPLAY_RANGE_DB` with the gain of the settings.
 */
const speckleFlow = new Float64Array(SPECTRAL_BINS);
const speckleNoise = new Float64Array(SPECTRAL_BINS);

export function displaySpectrum(
  expected: ArrayLike<number>,
  s: SpectralSettings,
  seed: number,
  click: number,
  timeS: number,
  out: Float32Array,
): void {
  const { vMin, vMax } = spectralRange(s);
  let max = 0;
  for (let b = 0; b < SPECTRAL_BINS; b++) max = Math.max(max, expected[b] ?? 0);
  const norm = max > 0 ? 1 / (max * 0.8 + 0.2) : 0;
  const tCells = timeS / estimateDurationS(s);
  const noise = Math.pow(10, NOISE_DB / 10);
  estimateSpeckleColumn(tCells, seed, 17, speckleFlow);
  estimateSpeckleColumn(tCells, seed, 29, speckleNoise);
  for (let b = 0; b < SPECTRAL_BINS; b++) {
    const v = vMax - ((b + 0.5) / SPECTRAL_BINS) * (vMax - vMin);
    const clickLevel =
      click > 0 && Math.abs(v) >= s.wallFilterMps
        ? click * CLICK_LEVEL * Math.exp(-0.5 * (v / (CLICK_SPREAD * s.scaleMps)) ** 2)
        : 0;
    const flow = (expected[b] ?? 0) * norm;
    const power = flow * speckleFlow[b]! + noise * speckleNoise[b]! + clickLevel;
    const db = 10 * Math.log10(Math.max(1e-12, power)) + s.gainDb;
    out[b] = Math.min(1, Math.max(0, 1 + (db - WHITE_DB) / DISPLAY_RANGE_DB));
  }
}

/**
 * Build one spectral column (SPECTRAL_BINS values 0..1, index 0 = vMax at top) from samples: the expected spectrum the envelope
 * of the machine is read from (decisions 96 and 115). `aliasing=false` for CW (Nyquist far above the range → velocities beyond
 * the display leave it). With `display`, it also draws the column the screen shows: the estimate with its grain on a
 * logarithmic scale (`displaySpectrum`), at `timeS`.
 */
export function buildSpectralColumn(
  samples: readonly VelocitySample[],
  s: SpectralSettings,
  columnIndex: number,
  seed: number,
  aliasing: boolean,
  out: Float32Array,
  click = 0,
  display?: Float32Array,
  timeS = columnIndex * 0.004,
): void {
  accumulateSpectrum(samples, s, aliasing, out);
  if (display) displaySpectrum(out, s, seed, click, timeS, display);
  const gainLin = Math.pow(10, s.gainDb / 20);
  const { vMin, vMax } = spectralRange(s);
  // normalise softly, apply gain + noise floor + compression
  let max = 0;
  for (let b = 0; b < SPECTRAL_BINS; b++) max = Math.max(max, out[b] ?? 0);
  const norm = max > 0 ? 1 / (max * 0.8 + 0.2) : 0;
  for (let b = 0; b < SPECTRAL_BINS; b++) {
    const noise = SPECTRAL_NOISE * hash3(b, columnIndex, 3, seed);
    const v = vMax - ((b + 0.5) / SPECTRAL_BINS) * (vMax - vMin);
    // a valve click: broadband across the displayed range outside the wall filter, fading toward its ends
    const clickLevel =
      click > 0 && Math.abs(v) >= s.wallFilterMps
        ? click * CLICK_LEVEL * Math.exp(-0.5 * (v / (CLICK_SPREAD * s.scaleMps)) ** 2)
        : 0;
    const y = ((out[b] ?? 0) * norm + clickLevel + noise) * gainLin;
    out[b] = Math.min(1, Math.pow(Math.max(0, y), 0.7));
  }
}

/**
 * A valve click, not a flow (decision 103): a column bright above its envelope threshold over more than 60% of the displayed
 * range outside the wall filter. Such a column has no envelope to read; a laminar or stenotic flow fills at most one side.
 */
export function isClickColumn(col: ArrayLike<number>, s: SpectralSettings): boolean {
  const { vMin, vMax } = spectralRange(s);
  let max = 0;
  for (let b = 0; b < SPECTRAL_BINS; b++) max = Math.max(max, col[b] ?? 0);
  const thr = envelopeThreshold(max, s);
  let n = 0,
    bright = 0;
  for (let b = 0; b < SPECTRAL_BINS; b++) {
    if (Math.abs(vMax - ((b + 0.5) / SPECTRAL_BINS) * (vMax - vMin)) < s.wallFilterMps) continue;
    n++;
    if ((col[b] ?? 0) > thr) bright++;
  }
  return bright > 0.6 * n;
}

/** Column time step (s) and columns per second for the strip width given the sweep speed. */
export function columnsPerSecond(
  sweepMmPerS: number,
  stripWidthPx: number,
  stripWidthMm: number,
): number {
  // strip physical width in mm at the given sweep speed → seconds shown = stripWidthMm / sweep
  const seconds = stripWidthMm / sweepMmPerS;
  return stripWidthPx / seconds;
}
