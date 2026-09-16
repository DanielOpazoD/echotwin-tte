import type { AcquisitionSettings, PolarFrame, PolarFrameSpec } from '../types';
import { hash3 } from '@/core/random';
import { buildNoiseKernels, ENVELOPE_NORM, filterComplex, type PsfKernels } from '../acoustic/psf';

/**
 * Console post-processing (spec 7.7): linear envelope amplitude → displayed polar intensity 0..255.
 * Steps: complex receiver noise, band-limited by the receive response and detected together with the echo
 * (decision 91) → baseline depth compensation + user TGC + gain, which amplify noise and echo alike, so the
 * noise rises with depth and gain → log compression / dynamic range → edge enhancement → persistence → gray
 * map. Axial and lateral resolution are not console effects: the renderer forms them with the PSF before
 * envelope detection (decision 52). Pure CPU, deterministic per (frameIndex, seed). The GPU console
 * (gpu/glslImage.ts, decision 54) evaluates the same steps except the mirror and side-lobe artifacts, with the
 * same compensation table, noise hashes, kernels and constants.
 */
export interface ConsoleState {
  prev: Float32Array | null; // persistence buffer of the CPU console (0..1)
  /** True while the GPU console's history texture holds the previous output of this state (decision 54). */
  gpuHistory: boolean;
  frameIndex: number;
  seed: number;
}

/** Mean envelope of receiver noise alone, before amplification (amplitude units). */
export const NOISE_FLOOR = 0.0018;
/**
 * RMS of the white complex receiver noise before the receive response (decision 91). The response has unit energy, so it
 * keeps E|n|², and a complex Gaussian detects to a mean envelope of √π/2 times its RMS: noise alone reads NOISE_FLOOR.
 */
export const NOISE_RMS = NOISE_FLOOR * ENVELOPE_NORM;
/**
 * White point: envelope amplitude 10^(REF_DB/20) maps to full white at 0 dB gain. 12 dB under the 8 it was since decision
 * 52, set with the clinical grey map and the complex receiver noise against CAMUS Good (decision 91).
 */
export const REF_DB = -4;
/**
 * Convexity C of the clinical grey map, grey = ((1 + C)^y − 1) / C of the compressed level y (decision 91): exponential
 * in dB, it expands the bright end, as the grey std of CAMUS Good images grows with grey level (decision 90).
 */
export const CLINICAL_GREY_CURVE = 3.5;
const CLINICAL_GREY_LOG = Math.log1p(CLINICAL_GREY_CURVE);
/** S-curve grey map: smoothstep weighted against the identity. */
export const S_CURVE_MIX = 0.85;
/** High-contrast grey map exponent. */
export const HIGH_CONTRAST_GAMMA = 1.6;
/** Floor added before the log so a zero envelope compresses to −∞ dB without NaN. */
export const LOG_FLOOR = 1e-6;
/**
 * Receiver-noise magnitude table: the Rayleigh tail is truncated at this fraction of the CDF (3.3 RMS), the
 * magnitude comes from the high 16 bits of the hash and the phase from its low 10 bits (decision 91).
 */
export const NOISE_TAIL = 0.999999;
export const NOISE_MAGNITUDE_BINS = 65536;
export const NOISE_PHASE_BINS = 1024;

/**
 * Persistence weight of a frame that arrives `elapsedS` after the previous one, for a scanner whose frame interval is
 * `intervalS` (decision 94, external audit F12). The setting is the weight of the history per acquired frame, so over
 * any stretch of time the history keeps persistence^(elapsed / interval): a frame the renderer could not produce on time
 * still counts as elapsed time, and the image does not smear longer on a slow device. A frame that follows the previous
 * one by less than a quarter of the interval (a late step followed by an early one) weighs as a quarter, so it still
 * contributes.
 */
export function persistenceOverTime(
  persistence: number,
  elapsedS: number,
  intervalS: number,
): number {
  if (!(persistence > 0) || !(intervalS > 0)) return 0;
  return Math.pow(persistence, Math.max(0.25, elapsedS / intervalS));
}

export function createConsoleState(seed: number): ConsoleState {
  return { prev: null, gpuHistory: false, frameIndex: 0, seed };
}

const scratchA = { buf: new Float32Array(0) };
const scratchB = { buf: new Float32Array(0) };
const scratchComp = { buf: new Float64Array(0) };
const scratchNoiseRe = { buf: new Float32Array(0) };
const scratchNoiseIm = { buf: new Float32Array(0) };
const scratchTmpRe = { buf: new Float32Array(0) };
const scratchTmpIm = { buf: new Float32Array(0) };
const noiseKernelCache = new Map<string, PsfKernels>();
/**
 * One 32-bit hash per noise sample: its high 16 bits draw the magnitude (Rayleigh, E|z|² = NOISE_RMS², tail truncated at
 * 3.3 RMS, where |z|² exceeds it with probability 1.5·10⁻⁵) and its low 10 bits the phase; the GPU passes evaluate the
 * same expressions on the same bits.
 */
const NOISE_MAGNITUDE = Float32Array.from(
  { length: NOISE_MAGNITUDE_BINS },
  (_, i) => NOISE_RMS * Math.sqrt(-Math.log(1 - NOISE_TAIL * (i / NOISE_MAGNITUDE_BINS))),
);
const NOISE_COS = Float32Array.from({ length: NOISE_PHASE_BINS }, (_, i) =>
  Math.cos((2 * Math.PI * i) / NOISE_PHASE_BINS),
);
const NOISE_SIN = Float32Array.from({ length: NOISE_PHASE_BINS }, (_, i) =>
  Math.sin((2 * Math.PI * i) / NOISE_PHASE_BINS),
);

/** Receive response of the noise for a frame or M-mode line geometry (a few geometries alternate: frames and lines). */
function noiseKernels(spec: PolarFrameSpec, settings: AcquisitionSettings): PsfKernels {
  const key = `${spec.lines}x${spec.samples}|${spec.depthCm}|${spec.sectorRad}|${spec.focusCm}|${settings.frequencyMHz}|${settings.harmonics ? 1 : 0}`;
  let k = noiseKernelCache.get(key);
  if (!k) {
    if (noiseKernelCache.size >= 8) noiseKernelCache.clear();
    k = buildNoiseKernels(spec, settings.frequencyMHz, settings.harmonics);
    noiseKernelCache.set(key, k);
  }
  return k;
}

/**
 * Receiver noise of one frame or pulse, in place in `re`/`im` (decision 91): white complex Gaussian samples per line,
 * sample, frame index and seed, filtered by the receive response.
 */
export function receiverNoise(
  k: PsfKernels,
  lines: number,
  samples: number,
  frameIndex: number,
  seed: number,
  re: Float32Array,
  im: Float32Array,
  tmpRe: Float32Array,
  tmpIm: Float32Array,
): void {
  for (let li = 0; li < lines; li++)
    for (let si = 0; si < samples; si++) {
      const h = hash3(li, si, frameIndex, seed) * 4294967296;
      const r = NOISE_MAGNITUDE[h >>> 16]!,
        q = h & (NOISE_PHASE_BINS - 1);
      re[li * samples + si] = r * NOISE_COS[q]!;
      im[li * samples + si] = r * NOISE_SIN[q]!;
    }
  filterComplex(re, im, lines, samples, k, tmpRe, tmpIm);
}

/** A view of n samples on a scratch buffer that only grows: frames and M-mode lines alternate without reallocating. */
function ensure(s: { buf: Float32Array }, n: number): Float32Array {
  if (s.buf.length < n) s.buf = new Float32Array(n);
  return s.buf.length === n ? s.buf : s.buf.subarray(0, n);
}

/**
 * Per-sample amplification of the console: default depth compensation (0.38 dB/cm/MHz) plus the TGC curve,
 * capped at 60 dB, times the overall gain. The CPU console uses it in float64, the GPU console as a texture.
 */
export function consoleCompensation(
  settings: AcquisitionSettings,
  spec: PolarFrameSpec,
  out: Float32Array | Float64Array,
): void {
  const dr = spec.depthCm / spec.samples;
  // 0.45, raised from 0.38 when the heart was moved behind the chest wall (decision 66): the extra 1.2 cm of
  // chest wall on the path attenuate more than the old compensation returned, and myocardial grey fell from
  // 100+ to 94 at 0 dB gain. The compensation has to cover the real path, chest wall included.
  const baselineDbPerCm = 0.45 * settings.frequencyMHz; // default depth compensation of the (fictional) console
  const gainLin = Math.pow(10, settings.gainDb / 20);
  for (let si = 0; si < spec.samples; si++) {
    const r = (si + 0.5) * dr;
    const compDb = baselineDbPerCm * r + tgcAtDepth(settings, r);
    out[si] = Math.pow(10, Math.min(compDb, 60) / 20) * gainLin;
  }
}

export function tgcAtDepth(settings: AcquisitionSettings, r: number): number {
  const bands = settings.tgcDb;
  const pos = (r / settings.depthCm) * (bands.length - 1);
  const i0 = Math.max(0, Math.min(bands.length - 1, Math.floor(pos)));
  const i1 = Math.min(bands.length - 1, i0 + 1);
  const t = pos - i0;
  return (bands[i0] ?? 0) * (1 - t) + (bands[i1] ?? 0) * t;
}

/**
 * Case-configurable artifacts applied in the polar domain (spec 12, case 12): intensities 0..1.
 * side-lobe: strong reflectors leak into neighbouring lines; mirror: the image beyond a strong
 * specular interface (pericardium/lung) repeats the shallower image; beam-width is applied by the renderer
 * PSF (it widens the lateral beam away from the focus) and is carried here only for completeness.
 */
export interface ArtifactSettings {
  sideLobe: number;
  mirror: number;
  beamWidth: number;
}
export const NO_ARTIFACTS: ArtifactSettings = { sideLobe: 0, mirror: 0, beamWidth: 0 };

/**
 * Options of an M-mode column (decision 84): `noisePulses` pulses of one column, each detected with its own receiver noise
 * and averaged per sample (decision 91), `edgeStep` samples between the centre and the neighbours of the edge enhancement
 * (a line finer than a frame keeps the frame's enhancement length), and no persistence history.
 */
export interface ConsoleLineOptions {
  noisePulses: number;
  edgeStep: number;
}

export function applyConsole(
  frame: PolarFrame,
  settings: AcquisitionSettings,
  state: ConsoleState,
  outU8: Uint8ClampedArray,
  artifacts: ArtifactSettings = NO_ARTIFACTS,
  line: ConsoleLineOptions | null = null,
): void {
  const { lines, samples, depthCm } = frame.spec;
  const n = lines * samples;
  const dr = depthCm / samples;
  const dr_ = settings.dynamicRangeDb;
  const a = ensure(scratchA, n);
  const b = ensure(scratchB, n);
  const fi = state.frameIndex;
  if (scratchComp.buf.length < samples) scratchComp.buf = new Float64Array(samples);
  const compensation = scratchComp.buf;
  consoleCompensation(settings, frame.spec, compensation);
  const pulses = line ? Math.max(1, Math.round(line.noisePulses)) : 1;
  // 1) receiver noise joins the echo before detection (decision 91). Adding its envelope to the detected echo, as before,
  // filled every speckle null with a positive offset; white noise per sample drew a grain finer than the resolution.
  // |A + n| with n complex has the distribution of |A·e^{iθ} + n| for any echo phase θ, so the detected echo serves as
  // A. The pulses of an M-mode column average their detected envelopes. Amplification follows, for noise and echo alike.
  const k = noiseKernels(frame.spec, settings);
  const nRe = ensure(scratchNoiseRe, n),
    nIm = ensure(scratchNoiseIm, n),
    tRe = ensure(scratchTmpRe, n),
    tIm = ensure(scratchTmpIm, n);
  a.fill(0);
  for (let p = 0; p < pulses; p++) {
    receiverNoise(k, lines, samples, fi + p, state.seed, nRe, nIm, tRe, tIm);
    for (let i = 0; i < n; i++) {
      const x = (frame.amplitude[i] ?? 0) + nRe[i]!,
        y = nIm[i]!;
      a[i]! += Math.sqrt(x * x + y * y);
    }
  }
  for (let si = 0; si < samples; si++) {
    const g = (compensation[si] ?? 1) / pulses;
    for (let li = 0; li < lines; li++) a[li * samples + si]! *= g;
  }
  // 1b) mirror artifact: beyond the first strong specular interface deeper than 5 cm (pericardium / pleura)
  // the shallower image is duplicated at mirrored depth, attenuated
  if (artifacts.mirror > 0) {
    const minSi = Math.floor(5 / dr);
    for (let li = 0; li < lines; li++) {
      const base = li * samples;
      let s0 = -1;
      for (let si = minSi; si < samples; si++) {
        const ti = frame.tissue[base + si] ?? 0;
        if ((ti === 4 || ti === 9) && (frame.amplitude[base + si] ?? 0) > 0.3) {
          s0 = si;
          break;
        }
      }
      if (s0 < 0) continue;
      const gain = 0.45 * artifacts.mirror;
      for (let si = s0 + 1; si < samples; si++) {
        const src = 2 * s0 - si;
        if (src < 0) break;
        a[base + si] =
          (a[base + si] ?? 0) + (a[base + src] ?? 0) * gain * Math.exp(-(si - s0) * dr * 0.12);
      }
    }
  }
  // 1c) side lobes: strong reflectors leak into neighbouring lines (±3), decaying with distance
  if (artifacts.sideLobe > 0) {
    const thr = 1.2;
    const leak = 0.18 * artifacts.sideLobe;
    b.set(a);
    for (let li = 0; li < lines; li++) {
      for (let si = 0; si < samples; si++) {
        const v = a[li * samples + si] ?? 0;
        if (v < thr) continue;
        for (let j = -3; j <= 3; j++) {
          if (j === 0) continue;
          const q = li + j;
          if (q < 0 || q >= lines) continue;
          const idx = q * samples + si;
          b[idx] = Math.max(b[idx] ?? 0, v * leak * (1 - Math.abs(j) / 4));
        }
      }
    }
    a.set(b);
  }
  // 2) axial resolution is formed by the renderer PSF (decision 52)
  b.set(a);
  // 3) log compression / dynamic range → 0..1
  for (let i = 0; i < n; i++) {
    const db = 20 * Math.log10((b[i] ?? 0) + LOG_FLOOR) - REF_DB;
    const y = (db + dr_) / dr_;
    a[i] = y < 0 ? 0 : y > 1 ? 1 : y;
  }
  // 4) lateral resolution and beam width are formed by the renderer PSF (decision 52)
  b.set(a);
  // 5) edge enhancement (unsharp along samples, mild)
  if (settings.edgeEnhance > 0) {
    const e = settings.edgeEnhance * 0.8;
    const k = line ? Math.max(1, Math.round(line.edgeStep)) : 1;
    for (let li = 0; li < lines; li++) {
      const base = li * samples;
      for (let si = k; si < samples - k; si++) {
        const c = b[base + si] ?? 0;
        const m = ((b[base + si - k] ?? 0) + (b[base + si + k] ?? 0)) / 2;
        a[base + si] = Math.min(1, Math.max(0, c + (c - m) * e));
      }
      for (let si = 0; si < k; si++) {
        a[base + si] = b[base + si] ?? 0;
        a[base + samples - 1 - si] = b[base + samples - 1 - si] ?? 0;
      }
    }
  } else a.set(b);
  // 6) persistence
  const p = line ? 0 : settings.persistence;
  if (line) {
    // an M-mode column has no history: each column is its own instant
  } else if (state.prev && state.prev.length === n && p > 0) {
    const prev = state.prev;
    for (let i = 0; i < n; i++) {
      const y = (a[i] ?? 0) * (1 - p) + (prev[i] ?? 0) * p;
      a[i] = y;
      prev[i] = y;
    }
  } else {
    state.prev = new Float32Array(a);
  }
  // 7) gray map
  for (let i = 0; i < n; i++) {
    let y = a[i] ?? 0;
    if (settings.grayMap === 's-curve')
      y = y * y * (3 - 2 * y) * S_CURVE_MIX + y * (1 - S_CURVE_MIX);
    else if (settings.grayMap === 'high-contrast') y = Math.pow(y, HIGH_CONTRAST_GAMMA);
    else if (settings.grayMap === 'clinical')
      y = Math.expm1(y * CLINICAL_GREY_LOG) / CLINICAL_GREY_CURVE;
    outU8[i] = Math.round(y * 255);
  }
  state.gpuHistory = false;
  state.frameIndex++;
}
