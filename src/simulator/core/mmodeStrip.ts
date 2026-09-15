/**
 * M-mode acquisition (decision 84). A clinical M-mode fires its line 1000–2000 times a second and each column of the
 * trace is a millisecond or two of those pulses; the simulator cannot trace a fine line that often, so it keeps the lines
 * it has traced for the current probe, cursor and imaging settings in phase bins of the beat (the heart model is a
 * function of the cycle phase) and forms every column from the lines nearest to its own instant. While the bins fill
 * (the first beats after the cursor or the probe moves) a column is interpolated between the nearest traced lines; once
 * they are full every column is its own instant and no time is dropped.
 */

/** Sample length of an M-mode line (cm): a quarter of the axial pulse at 2.5 MHz (0.89 mm) and half a scatterer cell (0.4 mm). */
export const MMODE_SAMPLE_CM = 0.02;

/**
 * M-mode pulse repetition frequency (pulses/s): "around 1000 to 2000 pulses per second" (Anderson B, Echocardiography:
 * The Normal Examination and Echocardiographic Measurements, 3rd ed., ch. 3). The lower bound, because the 2D image
 * above the trace keeps sharing the pulses.
 */
export const MMODE_PRF_HZ = 1000;

/** Share of the simulated frame interval that tracing new M-mode lines may take per step. */
export const MMODE_TRACE_SHARE = 0.4;

export function mmodeLineSamples(depthCm: number): number {
  return Math.max(64, Math.ceil(depthCm / MMODE_SAMPLE_CM));
}

/** Phase bins per beat: the power of two nearest to the columns drawn in one beat, within [128, 2048]. */
export function mmodePhaseBins(columnsPerSecond: number, rrS: number): number {
  const perBeat = Math.max(1, columnsPerSecond * rrS);
  return Math.min(2048, Math.max(128, 2 ** Math.round(Math.log2(perBeat))));
}

/** Pulses that fall into one column: their envelopes are averaged, so receiver noise drops by √n and tissue echoes stay. */
export function mmodePulsesPerColumn(columnsPerSecond: number): number {
  return Math.max(1, Math.round(MMODE_PRF_HZ / Math.max(1, columnsPerSecond)));
}

export interface MmodeLine {
  /** Linear pre-console envelope on the line samples. */
  amp: Float32Array;
  /** Axial flow velocity on the frame samples (m/s, + toward the probe, NaN without flow or behind a shadow); colour M-mode only. */
  velocity: Float32Array | null;
}

/** Lines traced for one probe pose, cursor and imaging settings, one per phase bin. */
export class MmodeLineCache {
  key = '';
  bins = 0;
  filled = 0;
  /** Moving average of the time to trace one line (ms); −1 until measured. */
  traceMs = -1;
  private lines: (MmodeLine | undefined)[] = [];

  reset(key: string, bins: number): void {
    this.key = key;
    this.bins = bins;
    this.filled = 0;
    this.lines = new Array<MmodeLine | undefined>(bins);
  }

  get(bin: number): MmodeLine | undefined {
    return this.lines[((bin % this.bins) + this.bins) % this.bins];
  }

  set(bin: number, line: MmodeLine): void {
    const b = ((bin % this.bins) + this.bins) % this.bins;
    if (!this.lines[b]) this.filled++;
    this.lines[b] = line;
  }

  measure(ms: number): void {
    this.traceMs = this.traceMs < 0 ? ms : this.traceMs + 0.25 * (ms - this.traceMs);
  }

  /** Steps d ≥ 0 from `bin` in direction `dir` to the first traced bin, within `reach` steps; −1 if none. */
  distance(bin: number, dir: 1 | -1, reach: number): number {
    for (let d = 0; d <= reach; d++) if (this.get(bin + dir * d)) return d;
    return -1;
  }
}

export interface ColumnSource {
  lo: MmodeLine;
  hi: MmodeLine;
  /** Weight of `hi`. */
  t: number;
  /** Phase bins between the two lines (1 when they are neighbours, and the column is formed at full time resolution). */
  span: number;
}

/**
 * The traced lines a column at `phase` is formed from: the nearest bin at or before its instant and the nearest after it,
 * weighted by phase — the pulses of a column fall between them. With only one side within `reach`, that line alone.
 */
export function columnSource(
  cache: MmodeLineCache,
  phase: number,
  reach: number,
): ColumnSource | null {
  const B = cache.bins;
  const pos = (((phase % 1) + 1) % 1) * B;
  const b0 = Math.floor(pos);
  const frac = pos - b0;
  const dLo = cache.distance(b0, -1, reach);
  const dHi = cache.distance(b0 + 1, 1, reach);
  if (dLo >= 0 && dHi >= 0) {
    const span = dLo + 1 + dHi;
    return { lo: cache.get(b0 - dLo)!, hi: cache.get(b0 + 1 + dHi)!, t: (dLo + frac) / span, span };
  }
  if (dLo >= 0) {
    const l = cache.get(b0 - dLo)!;
    return { lo: l, hi: l, t: 0, span: 2 * reach + 1 };
  }
  if (dHi >= 0) {
    const l = cache.get(b0 + 1 + dHi)!;
    return { lo: l, hi: l, t: 0, span: 2 * reach + 1 };
  }
  return null;
}

/**
 * Bins to trace this step so that every due column has its two neighbouring bins: all of them when the budget allows,
 * otherwise `maxTraces` spread evenly over the missing ones, so the columns in between interpolate across short gaps.
 */
export function binsToTrace(
  cache: MmodeLineCache,
  phases: ArrayLike<number>,
  maxTraces: number,
): number[] {
  const B = cache.bins;
  const missing: number[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < phases.length; i++) {
    const b0 = Math.floor((((phases[i]! % 1) + 1) % 1) * B);
    for (const b of [b0, (b0 + 1) % B]) {
      if (seen.has(b)) continue;
      seen.add(b);
      if (!cache.get(b)) missing.push(b);
    }
  }
  if (missing.length <= maxTraces) return missing;
  const out: number[] = [];
  for (let i = 0; i < maxTraces; i++)
    out.push(missing[Math.floor(((i + 0.5) * missing.length) / maxTraces)]!);
  return out;
}

/**
 * Row weights of a strip `rows` tall showing `samples` line samples: the samples a row covers, weighted by overlap, when
 * rows are coarser than samples; linear interpolation between the two nearest samples otherwise. No row repeats a sample.
 */
export interface RowMap {
  rows: number;
  samples: number;
  taps: number;
  first: Int32Array;
  weights: Float32Array;
}

export function buildRowMap(rows: number, samples: number): RowMap {
  const ratio = samples / rows;
  const taps = ratio >= 1 ? Math.ceil(ratio) + 1 : 2;
  const first = new Int32Array(rows);
  const weights = new Float32Array(rows * taps);
  for (let y = 0; y < rows; y++) {
    if (ratio >= 1) {
      const a = y * ratio,
        b = (y + 1) * ratio;
      const i0 = Math.floor(a);
      first[y] = i0;
      for (let k = 0; k < taps; k++) {
        const i = i0 + k;
        const w = Math.max(0, Math.min(b, i + 1) - Math.max(a, i));
        weights[y * taps + k] = i < samples ? w / ratio : 0;
      }
    } else {
      const c = (y + 0.5) * ratio - 0.5;
      const i0 = Math.max(0, Math.min(samples - 2, Math.floor(c)));
      const t = Math.max(0, Math.min(1, c - i0));
      first[y] = i0;
      weights[y * taps] = 1 - t;
      weights[y * taps + 1] = t;
    }
  }
  return { rows, samples, taps, first, weights };
}
