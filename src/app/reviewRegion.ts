/**
 * Regions of review mode (decision 340), on the frame's own polar structure map (line-major, `SimOutput.structure`):
 * the connected piece of the structure under a click, which the image outlines so the reader sees what was picked, and
 * the cells inside a lasso drawn by hand, with what they hold. Pure functions: no store, no DOM.
 */

/** The polar geometry of a frame and its per-sample structure ids. */
export interface PolarMap {
  lines: number;
  samples: number;
  sectorRad: number;
  depthCm: number;
  structure: Uint8Array;
}

/** A point of a lasso in the sector, polar: it reprojects with zoom and flips and replays offline with the report. */
export interface LassoPoint {
  rCm: number;
  thetaRad: number;
}

/** What a region holds: its area on the plane, the structures inside by share of it, and the grey drawn there. */
export interface RegionSummary {
  areaCm2: number;
  structures: { id: number; share: number }[];
  /** Displayed grey (0–255) inside: 10th percentile, median, 90th; null when the pixels could not be read. */
  grey: { p10: number; median: number; p90: number } | null;
}

/** Most points a lasso keeps (the hand draws hundreds); the step between kept points grows to fit. */
export const LASSO_MAX_POINTS = 120;
/** Fewest cells a region needs before its summary means anything. */
const MIN_CELLS = 1;

/** The cell (polar index) at a polar position, or −1 outside the frame. Same rule as `structureAtPixel`. */
export function cellAt(p: PolarMap, rCm: number, thetaRad: number): number {
  if (rCm < 0 || rCm > p.depthCm || Math.abs(thetaRad) > p.sectorRad / 2) return -1;
  const li = Math.min(
    p.lines - 1,
    Math.max(0, Math.floor(((thetaRad + p.sectorRad / 2) / p.sectorRad) * p.lines)),
  );
  const si = Math.min(p.samples - 1, Math.max(0, Math.floor((rCm / p.depthCm) * p.samples)));
  return li * p.samples + si;
}

/** The centre of a cell, polar. */
export function cellCentre(p: PolarMap, cell: number): LassoPoint {
  const li = Math.floor(cell / p.samples),
    si = cell % p.samples;
  return {
    rCm: ((si + 0.5) / p.samples) * p.depthCm,
    thetaRad: ((li + 0.5) / p.lines - 0.5) * p.sectorRad,
  };
}

/** Area of a cell on the plane (cm²): r·dθ·dr at its centre. */
export function cellAreaCm2(p: PolarMap, cell: number): number {
  const dr = p.depthCm / p.samples,
    dt = p.sectorRad / p.lines;
  return cellCentre(p, cell).rCm * dt * dr;
}

/** The connected piece (4-neighbours) of the structure at `start`: the cells the image outlines for a click. */
export function structureComponent(p: PolarMap, start: number): Int32Array {
  if (start < 0) return new Int32Array(0);
  const id = p.structure[start]!;
  const seen = new Uint8Array(p.lines * p.samples);
  const out: number[] = [];
  const stack = [start];
  seen[start] = 1;
  while (stack.length) {
    const c = stack.pop()!;
    out.push(c);
    const li = Math.floor(c / p.samples),
      si = c % p.samples;
    const next = [
      si > 0 ? c - 1 : -1,
      si < p.samples - 1 ? c + 1 : -1,
      li > 0 ? c - p.samples : -1,
      li < p.lines - 1 ? c + p.samples : -1,
    ];
    for (const n of next)
      if (n >= 0 && !seen[n] && p.structure[n] === id) {
        seen[n] = 1;
        stack.push(n);
      }
  }
  return Int32Array.from(out);
}

/** The cells of a region with a 4-neighbour outside it (or on the frame's edge): its outline. */
export function regionOutline(p: PolarMap, cells: Int32Array): Int32Array {
  const inside = new Uint8Array(p.lines * p.samples);
  for (const c of cells) inside[c] = 1;
  const out: number[] = [];
  for (const c of cells) {
    const li = Math.floor(c / p.samples),
      si = c % p.samples;
    if (
      si === 0 ||
      si === p.samples - 1 ||
      li === 0 ||
      li === p.lines - 1 ||
      !inside[c - 1] ||
      !inside[c + 1] ||
      !inside[c - p.samples] ||
      !inside[c + p.samples]
    )
      out.push(c);
  }
  return Int32Array.from(out);
}

/** Whether a polar point lies inside a lasso, by ray casting on the plane (x = r·sinθ, y = r·cosθ). */
export function insideLasso(poly: readonly LassoPoint[], rCm: number, thetaRad: number): boolean {
  const x = rCm * Math.sin(thetaRad),
    y = rCm * Math.cos(thetaRad);
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!,
      b = poly[j]!;
    const xa = a.rCm * Math.sin(a.thetaRad),
      ya = a.rCm * Math.cos(a.thetaRad);
    const xb = b.rCm * Math.sin(b.thetaRad),
      yb = b.rCm * Math.cos(b.thetaRad);
    if (ya > y !== yb > y && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) inside = !inside;
  }
  return inside;
}

/** The cells whose centre lies inside a lasso. */
export function lassoCells(p: PolarMap, poly: readonly LassoPoint[]): Int32Array {
  if (poly.length < 3) return new Int32Array(0);
  let r0 = Infinity,
    r1 = -Infinity,
    t0 = Infinity,
    t1 = -Infinity;
  for (const q of poly) {
    r0 = Math.min(r0, q.rCm);
    r1 = Math.max(r1, q.rCm);
    t0 = Math.min(t0, q.thetaRad);
    t1 = Math.max(t1, q.thetaRad);
  }
  const l0 = Math.max(0, Math.floor(((t0 + p.sectorRad / 2) / p.sectorRad) * p.lines));
  const l1 = Math.min(p.lines - 1, Math.floor(((t1 + p.sectorRad / 2) / p.sectorRad) * p.lines));
  const s0 = Math.max(0, Math.floor((r0 / p.depthCm) * p.samples));
  const s1 = Math.min(p.samples - 1, Math.floor((r1 / p.depthCm) * p.samples));
  const out: number[] = [];
  for (let li = l0; li <= l1; li++)
    for (let si = s0; si <= s1; si++) {
      const c = li * p.samples + si;
      const q = cellCentre(p, c);
      if (insideLasso(poly, q.rCm, q.thetaRad)) out.push(c);
    }
  return Int32Array.from(out);
}

/**
 * What a region holds: area, the structures by share of it (largest first) and, when `greyAt` reads the displayed
 * image, the grey there.
 */
export function regionSummary(
  p: PolarMap,
  cells: Int32Array,
  greyAt?: (pt: LassoPoint) => number | null,
): RegionSummary | null {
  if (cells.length < MIN_CELLS) return null;
  let area = 0;
  const by = new Map<number, number>();
  const greys: number[] = [];
  for (const c of cells) {
    const a = cellAreaCm2(p, c);
    area += a;
    const id = p.structure[c]!;
    by.set(id, (by.get(id) ?? 0) + a);
    if (greyAt) {
      const g = greyAt(cellCentre(p, c));
      if (g !== null) greys.push(g);
    }
  }
  const structures = [...by.entries()]
    .map(([id, a]) => ({ id, share: a / area }))
    .sort((x, y) => y.share - x.share);
  greys.sort((x, y) => x - y);
  const q = (f: number): number => greys[Math.min(greys.length - 1, Math.floor(f * greys.length))]!;
  return {
    areaCm2: area,
    structures,
    grey: greys.length ? { p10: q(0.1), median: q(0.5), p90: q(0.9) } : null,
  };
}

/** A hand-drawn path thinned to at most LASSO_MAX_POINTS, evenly along its length. */
export function thinLasso(points: readonly LassoPoint[]): LassoPoint[] {
  if (points.length <= LASSO_MAX_POINTS) return points.slice();
  const step = points.length / LASSO_MAX_POINTS;
  const out: LassoPoint[] = [];
  for (let i = 0; i < LASSO_MAX_POINTS; i++) out.push(points[Math.floor(i * step)]!);
  return out;
}

/** The centroid of a lasso's cells, polar: where its marker number sits. */
export function lassoCentroid(
  p: PolarMap,
  cells: Int32Array,
  poly: readonly LassoPoint[],
): LassoPoint {
  let x = 0,
    y = 0,
    n = 0;
  const pts = cells.length ? Array.from(cells, (c) => cellCentre(p, c)) : poly;
  for (const q of pts) {
    x += q.rCm * Math.sin(q.thetaRad);
    y += q.rCm * Math.cos(q.thetaRad);
    n++;
  }
  x /= Math.max(1, n);
  y /= Math.max(1, n);
  return { rCm: Math.hypot(x, y), thetaRad: Math.atan2(x, y) };
}
