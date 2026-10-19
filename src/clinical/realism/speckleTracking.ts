/**
 * A plain 2-D speckle tracker for the realism bench (decision 344): block matching by normalized cross-correlation
 * between consecutive frames, with a parabolic sub-pixel peak, points carried frame to frame along a contour, and the
 * global longitudinal strain of that contour as the change of its length from end-diastole. It is the method vendors
 * started from (Leitman et al., JASE 2004), without their regularization: the bench wants to know whether the
 * simulator's speckle moves with its tissue, and a tracker that smooths hard would hide that.
 *
 * Images are grey levels, row-major (index x + y·width), in pixels; distances in the caller's pixel units.
 */

export interface GreyFrame {
  width: number;
  height: number;
  grey: Float32Array;
}

export interface MatchOptions {
  /** Half side of the square kernel (px): the block is (2h+1)². */
  halfKernel: number;
  /** Largest displacement searched along each axis (px). */
  search: number;
}

export interface Match {
  dx: number;
  dy: number;
  /** Normalized cross-correlation at the integer peak. */
  peak: number;
  /** Correlation of the block with the same place in the next frame (no motion compensation). */
  zeroShift: number;
}

/** NCC of the block of `a` centred at (ax, ay) with the block of `b` centred at (bx, by); NaN if either leaves the frame. */
export function blockNcc(
  a: GreyFrame,
  ax: number,
  ay: number,
  b: GreyFrame,
  bx: number,
  by: number,
  h: number,
): number {
  if (ax - h < 0 || ay - h < 0 || ax + h >= a.width || ay + h >= a.height) return NaN;
  if (bx - h < 0 || by - h < 0 || bx + h >= b.width || by + h >= b.height) return NaN;
  let sa = 0,
    sb = 0,
    saa = 0,
    sbb = 0,
    sab = 0;
  const n = (2 * h + 1) ** 2;
  for (let dy = -h; dy <= h; dy++) {
    const ra = (ay + dy) * a.width,
      rb = (by + dy) * b.width;
    for (let dx = -h; dx <= h; dx++) {
      const va = a.grey[ra + ax + dx]!,
        vb = b.grey[rb + bx + dx]!;
      sa += va;
      sb += vb;
      saa += va * va;
      sbb += vb * vb;
      sab += va * vb;
    }
  }
  const cov = sab - (sa * sb) / n,
    va = saa - (sa * sa) / n,
    vb = sbb - (sb * sb) / n;
  return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : NaN;
}

/** Vertex of the parabola through (−1, l), (0, c), (1, r): the sub-sample offset of a peak, within ±½. */
export function parabolicOffset(l: number, c: number, r: number): number {
  const d = l - 2 * c + r;
  if (!(d < 0)) return 0;
  return Math.max(-0.5, Math.min(0.5, (0.5 * (l - r)) / d));
}

/**
 * Displacement of the block of `prev` around (x, y) (rounded to the pixel) into `next`: the integer shift of highest
 * NCC within ±search, refined by a parabola along each axis. Null when the block leaves either frame.
 */
export function matchBlock(
  prev: GreyFrame,
  next: GreyFrame,
  x: number,
  y: number,
  o: MatchOptions,
): Match | null {
  const cx = Math.round(x),
    cy = Math.round(y);
  const s = o.search,
    side = 2 * s + 1;
  const grid = new Float64Array(side * side).fill(NaN);
  let best = -Infinity,
    bi = -1,
    bj = -1;
  for (let j = -s; j <= s; j++)
    for (let i = -s; i <= s; i++) {
      const v = blockNcc(prev, cx, cy, next, cx + i, cy + j, o.halfKernel);
      grid[(j + s) * side + (i + s)] = v;
      if (v > best) {
        best = v;
        bi = i;
        bj = j;
      }
    }
  if (!Number.isFinite(best)) return null;
  const at = (i: number, j: number): number => {
    if (Math.abs(i) > s || Math.abs(j) > s) return NaN;
    return grid[(j + s) * side + (i + s)]!;
  };
  const sub = (l: number, c: number, r: number): number =>
    Number.isFinite(l) && Number.isFinite(r) ? parabolicOffset(l, c, r) : 0;
  return {
    dx: cx - x + bi + sub(at(bi - 1, bj), best, at(bi + 1, bj)),
    dy: cy - y + bj + sub(at(bi, bj - 1), best, at(bi, bj + 1)),
    peak: best,
    zeroShift: at(0, 0),
  };
}

export interface Track {
  /** Positions per frame and point: tracks[f][k] = {x, y}. */
  positions: { x: number; y: number }[][];
  /** Mean NCC peak of the points over each frame pair (frame f → f+1). */
  meanPeak: number[];
  /** Mean NCC without motion compensation over each frame pair. */
  meanZeroShift: number[];
  /** Points whose block left the frame at some step (they keep their last displacement). */
  lost: number;
}

/**
 * Carries points from the first frame through the sequence, frame to frame. A point whose block leaves the frame keeps
 * the mean displacement of its two neighbours along the contour for that step, so the contour does not tear.
 */
export function trackPoints(
  frames: readonly GreyFrame[],
  start: readonly { x: number; y: number }[],
  o: MatchOptions,
): Track {
  const positions = [start.map((p) => ({ ...p }))];
  const meanPeak: number[] = [],
    meanZeroShift: number[] = [];
  const lostSet = new Set<number>();
  for (let f = 0; f + 1 < frames.length; f++) {
    const cur = positions[f]!;
    const moves = cur.map((p) => matchBlock(frames[f]!, frames[f + 1]!, p.x, p.y, o));
    let sp = 0,
      sz = 0,
      n = 0,
      nz = 0;
    const next = cur.map((p, k) => {
      const m = moves[k];
      if (m) {
        sp += m.peak;
        n++;
        if (Number.isFinite(m.zeroShift)) {
          sz += m.zeroShift;
          nz++;
        }
        return { x: p.x + m.dx, y: p.y + m.dy };
      }
      lostSet.add(k);
      const nb = [moves[k - 1], moves[k + 1]].filter((v): v is Match => !!v);
      const dx = nb.length ? nb.reduce((a, v) => a + v.dx, 0) / nb.length : 0;
      const dy = nb.length ? nb.reduce((a, v) => a + v.dy, 0) / nb.length : 0;
      return { x: p.x + dx, y: p.y + dy };
    });
    positions.push(next);
    meanPeak.push(n ? sp / n : NaN);
    meanZeroShift.push(nz ? sz / nz : NaN);
  }
  return { positions, meanPeak, meanZeroShift, lost: lostSet.size };
}

/** Length of a polyline, in the units of its coordinates (optionally scaled per axis). */
export function polylineLength(
  points: readonly { x: number; y: number }[],
  sx = 1,
  sy = 1,
): number {
  let L = 0;
  for (let i = 1; i < points.length; i++)
    L += Math.hypot((points[i]!.x - points[i - 1]!.x) * sx, (points[i]!.y - points[i - 1]!.y) * sy);
  return L;
}

/** Lagrangian strain (%) of a length against its reference: 100 (L − L₀) / L₀. */
export function strainPercent(L0: number, L: number): number {
  return (100 * (L - L0)) / L0;
}

/** Peak (most negative) strain of a length curve against its first value, and the frame where it falls. */
export function peakStrain(lengths: readonly number[]): { strain: number; frame: number } {
  let best = Infinity,
    frame = 0;
  for (let f = 0; f < lengths.length; f++) {
    const e = strainPercent(lengths[0]!, lengths[f]!);
    if (e < best) {
      best = e;
      frame = f;
    }
  }
  return { strain: best, frame };
}

/**
 * Resamples a polyline to `n` points evenly spaced along its length (the contour of a tracker starts evenly spaced, so
 * every segment counts the same in its length).
 */
export function resamplePolyline(
  points: readonly { x: number; y: number }[],
  n: number,
): { x: number; y: number }[] {
  const L = polylineLength(points);
  if (points.length < 2 || !(L > 0)) return points.map((p) => ({ ...p }));
  const out: { x: number; y: number }[] = [];
  let seg = 1,
    acc = 0;
  for (let k = 0; k < n; k++) {
    const target = (k * L) / (n - 1);
    while (seg < points.length - 1) {
      const d = Math.hypot(
        points[seg]!.x - points[seg - 1]!.x,
        points[seg]!.y - points[seg - 1]!.y,
      );
      if (acc + d >= target) break;
      acc += d;
      seg++;
    }
    const a = points[seg - 1]!,
      b = points[seg]!;
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const u = d > 0 ? Math.min(1, Math.max(0, (target - acc) / d)) : 0;
    out.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
  }
  return out;
}

/**
 * Frame-to-frame correlation of tissue blocks chosen by grey alone, so it runs the same on a clinical video without
 * labels and on the simulator's frames in the same format: `points` pixels drawn at random per frame pair among those
 * brighter than `minGrey` and at least `marginPx` from the edges, each block matched into the next frame.
 */
export function tissueDecorrelation(
  frames: readonly GreyFrame[],
  o: MatchOptions & { points: number; minGrey: number; marginPx: number; rand: () => number },
): { peak: number; zeroShift: number; pairs: number } {
  let sp = 0,
    sz = 0,
    n = 0;
  for (let f = 0; f + 1 < frames.length; f++) {
    const a = frames[f]!;
    const lit: number[] = [];
    const m = o.marginPx + o.halfKernel + o.search;
    for (let y = m; y < a.height - m; y++)
      for (let x = m; x < a.width - m; x++)
        if (a.grey[x + y * a.width]! >= o.minGrey) lit.push(x + y * a.width);
    if (!lit.length) continue;
    for (let k = 0; k < o.points; k++) {
      const i = lit[Math.floor(o.rand() * lit.length)]!;
      const r = matchBlock(a, frames[f + 1]!, i % a.width, Math.floor(i / a.width), o);
      if (!r || !Number.isFinite(r.zeroShift)) continue;
      sp += r.peak;
      sz += r.zeroShift;
      n++;
    }
  }
  return { peak: sp / n, zeroShift: sz / n, pairs: n };
}
