import type { AcquisitionSettings, PolarFrame } from '../types';
import { hash3 } from '@/core/random';

/**
 * Console post-processing (spec 7.7): raw linear polar amplitude → displayed polar intensity 0..255.
 * Steps: baseline depth compensation + user TGC + gain → electronic noise floor → axial resolution
 * (frequency-dependent) → log compression / dynamic range → lateral resolution by focus →
 * persistence → gray map. Pure CPU, deterministic per (frameIndex, seed).
 */
export interface ConsoleState {
  prev: Float32Array | null; // persistence buffer (0..1)
  frameIndex: number;
  seed: number;
}

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

export function applyConsole(frame: PolarFrame, settings: AcquisitionSettings, state: ConsoleState, outU8: Uint8ClampedArray): void {
  const { lines, samples, depthCm } = frame.spec;
  const n = lines * samples;
  const dr = depthCm / samples;
  const f = settings.frequencyMHz;
  const baselineDbPerCm = 0.38 * f; // default depth compensation of the (fictional) console
  const REF_DB = 15; // white point: amplitude 10^(15/20) ≈ 5.6 maps to full white at 0 dB gain
  const gainLin = Math.pow(10, settings.gainDb / 20);
  const dr_ = settings.dynamicRangeDb;
  const noiseFloor = 0.0035; // electronic noise before amplification: TGC/gain raise it with depth as on a real console
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
      const noise = noiseFloor * (0.5 + hash3(li, si, fi, state.seed));
      a[idx] = ((frame.amplitude[idx] ?? 0) + noise) * comp;
    }
  }
  // 2) axial resolution: box blur along samples with width ∝ 1/f
  const axialCm = 0.09 * (2.5 / f) * (settings.harmonics ? 0.75 : 1);
  const k = Math.max(0, Math.round(axialCm / dr / 2));
  if (k > 0) {
    for (let li = 0; li < lines; li++) {
      const base = li * samples;
      for (let si = 0; si < samples; si++) {
        let sum = 0,
          cnt = 0;
        for (let j = -k; j <= k; j++) {
          const q = si + j;
          if (q >= 0 && q < samples) {
            sum += a[base + q] ?? 0;
            cnt++;
          }
        }
        b[base + si] = sum / cnt;
      }
    }
  } else b.set(a);
  // 3) log compression / dynamic range → 0..1
  for (let i = 0; i < n; i++) {
    const db = 20 * Math.log10((b[i] ?? 0) + 1e-6) - REF_DB;
    const y = (db + dr_) / dr_;
    a[i] = y < 0 ? 0 : y > 1 ? 1 : y;
  }
  // 4) lateral resolution by focus: blur across lines, width grows away from the focal depth
  const focus = settings.focusCm;
  for (let si = 0; si < samples; si++) {
    const r = (si + 0.5) * dr;
    const dist = Math.abs(r - focus);
    // beam width (in lines) ≈ base + growth; wider sector → fewer lines per degree → more visible
    const linesPerDeg = lines / ((frame.spec.sectorRad * 180) / Math.PI);
    // beam width grows away from the focal depth; kept moderate so speckle stays granular, not streaky
    const widthDeg = 0.55 + 0.2 * dist * (2.5 / f) * (settings.harmonics ? 0.85 : 1);
    const sigma = Math.max(0.3, widthDeg * linesPerDeg * 0.5);
    const kk = Math.min(6, Math.ceil(sigma * 1.5));
    if (kk < 1) {
      for (let li = 0; li < lines; li++) b[li * samples + si] = a[li * samples + si] ?? 0;
      continue;
    }
    // gaussian weights
    let wsum = 0;
    const w: number[] = [];
    for (let j = -kk; j <= kk; j++) {
      const g = Math.exp(-(j * j) / (2 * sigma * sigma));
      w.push(g);
      wsum += g;
    }
    for (let li = 0; li < lines; li++) {
      let sum = 0;
      for (let j = -kk; j <= kk; j++) {
        const q = Math.min(lines - 1, Math.max(0, li + j));
        sum += (a[q * samples + si] ?? 0) * (w[j + kk] ?? 0);
      }
      b[li * samples + si] = sum / wsum;
    }
  }
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
