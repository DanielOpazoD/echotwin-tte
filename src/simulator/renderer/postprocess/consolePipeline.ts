import type { AcquisitionSettings, PolarFrame } from '../types';
import { hash3 } from '@/core/random';

/**
 * Console post-processing (spec 7.7): linear envelope amplitude → displayed polar intensity 0..255.
 * Steps: baseline depth compensation + user TGC + gain → Rayleigh electronic noise (amplified with the
 * compensation, so it rises with depth and gain) → log compression / dynamic range → edge enhancement →
 * persistence → gray map. Axial and lateral resolution are not console effects: the renderer forms them
 * with the PSF before envelope detection (decision 52). Pure CPU, deterministic per (frameIndex, seed).
 */
export interface ConsoleState {
  prev: Float32Array | null; // persistence buffer (0..1)
  frameIndex: number;
  seed: number;
}

/** Electronic noise before amplification (mean envelope, amplitude units). */
export const NOISE_FLOOR = 0.0018;
/** White point: envelope amplitude 10^(REF_DB/20) maps to full white at 0 dB gain. */
export const REF_DB = 8;
const RAYLEIGH_MEAN = Math.sqrt(Math.PI / 2);

export function createConsoleState(seed: number): ConsoleState {
  return { prev: null, frameIndex: 0, seed };
}

const scratchA = { buf: new Float32Array(0) };
const scratchB = { buf: new Float32Array(0) };

function ensure(s: { buf: Float32Array }, n: number): Float32Array {
  if (s.buf.length !== n) s.buf = new Float32Array(n);
  return s.buf;
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

export function applyConsole(frame: PolarFrame, settings: AcquisitionSettings, state: ConsoleState, outU8: Uint8ClampedArray, artifacts: ArtifactSettings = NO_ARTIFACTS): void {
  const { lines, samples, depthCm } = frame.spec;
  const n = lines * samples;
  const dr = depthCm / samples;
  const f = settings.frequencyMHz;
  const baselineDbPerCm = 0.38 * f; // default depth compensation of the (fictional) console
  const gainLin = Math.pow(10, settings.gainDb / 20);
  const dr_ = settings.dynamicRangeDb;
  const a = ensure(scratchA, n);
  const b = ensure(scratchB, n);
  const fi = state.frameIndex;
  // 1) amplification + noise, per sample depth
  for (let si = 0; si < samples; si++) {
    const r = (si + 0.5) * dr;
    const compDb = baselineDbPerCm * r + tgcAtDepth(settings, r);
    const comp = Math.pow(10, Math.min(compDb, 60) / 20) * gainLin;
    for (let li = 0; li < lines; li++) {
      const idx = li * samples + si;
      // Rayleigh-distributed envelope of complex Gaussian receiver noise, new every frame
      const noise = (NOISE_FLOOR / RAYLEIGH_MEAN) * Math.sqrt(-2 * Math.log(1 - 0.999999 * hash3(li, si, fi, state.seed)));
      a[idx] = ((frame.amplitude[idx] ?? 0) + noise) * comp;
    }
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
        a[base + si] = (a[base + si] ?? 0) + (a[base + src] ?? 0) * gain * Math.exp(-(si - s0) * dr * 0.12);
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
    const db = 20 * Math.log10((b[i] ?? 0) + 1e-6) - REF_DB;
    const y = (db + dr_) / dr_;
    a[i] = y < 0 ? 0 : y > 1 ? 1 : y;
  }
  // 4) lateral resolution and beam width are formed by the renderer PSF (decision 52)
  b.set(a);
  // 5) edge enhancement (unsharp along samples, mild)
  if (settings.edgeEnhance > 0) {
    const e = settings.edgeEnhance * 0.8;
    for (let li = 0; li < lines; li++) {
      const base = li * samples;
      for (let si = 1; si < samples - 1; si++) {
        const c = b[base + si] ?? 0;
        const m = ((b[base + si - 1] ?? 0) + (b[base + si + 1] ?? 0)) / 2;
        a[base + si] = Math.min(1, Math.max(0, c + (c - m) * e));
      }
      a[base] = b[base] ?? 0;
      a[base + samples - 1] = b[base + samples - 1] ?? 0;
    }
  } else a.set(b);
  // 6) persistence
  const p = settings.persistence;
  if (state.prev && state.prev.length === n && p > 0) {
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
    if (settings.grayMap === 's-curve') y = y * y * (3 - 2 * y) * 0.85 + y * 0.15;
    else if (settings.grayMap === 'high-contrast') y = Math.pow(y, 1.6);
    outU8[i] = Math.round(y * 255);
  }
  state.frameIndex++;
}
