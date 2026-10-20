/**
 * The model's own strain for the realism bench (decision 361): points of tissue followed through a cine by their
 * material coordinates, the coordinates every sample of the simulator carries to anchor its speckle. A contour drawn on
 * each frame's structure map counts its pixel and voxel steps as length, and its strain changed by several points with
 * how much it was smoothed; the same tissue at end diastole and at end systole does not.
 *
 * Positions are canvas pixels (x right, y down); material coordinates are whatever the field returns, compared as
 * vectors.
 */

export interface Point {
  x: number;
  y: number;
}

/** Material coordinates of the tissue under a canvas point (px) in one frame, or null where nothing is classified. */
export type MaterialField = (x: number, y: number) => readonly [number, number, number] | null;

/** Step (px) of the central differences of the field. */
const STEP_PX = 0.5;
const ITERATIONS = 12;
/** Convergence: the step (px) below which a point is where its tissue is. */
const TOLERANCE_PX = 0.01;

/**
 * Where, in each frame, the tissue that lay under each start point in the first frame lies now: the in-plane position
 * whose material coordinates are closest to the start point's (Gauss–Newton on the position, from where the point was
 * in the frame before, with the field's central differences). When the tissue has left the plane, the point is where
 * the plane comes closest to it. A point is lost where the field ends under it, or where its solution lies more than
 * `maxMovePx` from where it was in the frame before: across the border between two structures whose material
 * coordinates do not join, Gauss–Newton can land on unrelated tissue. A lost point keeps its last position, `kept` is
 * false for it, and `lost` counts it once.
 */
export function followMaterial(
  fields: readonly MaterialField[],
  start: readonly Point[],
  maxMovePx = Infinity,
): { positions: Point[][]; kept: boolean[]; lost: number } {
  const m0 = fields[0];
  if (!m0) return { positions: [], kept: [], lost: 0 };
  const targets = start.map((p) => m0(p.x, p.y));
  let lost = 0;
  const dropped = new Set<number>();
  const positions: Point[][] = [start.map((p) => ({ ...p }))];
  for (let f = 1; f < fields.length; f++) {
    const field = fields[f]!;
    const prev = positions[f - 1]!;
    positions.push(
      prev.map((p, i) => {
        const t = targets[i];
        if (!t || dropped.has(i)) return { ...p };
        const q = settle(field, t, p);
        if (!q || Math.hypot(q.x - p.x, q.y - p.y) > maxMovePx) {
          dropped.add(i);
          lost++;
          return { ...p };
        }
        return q;
      }),
    );
  }
  for (let i = 0; i < start.length; i++) if (!targets[i]) lost++;
  return { positions, kept: start.map((_, i) => !!targets[i] && !dropped.has(i)), lost };
}

/** Gauss–Newton from `p` toward the position whose material coordinates are `t`; null where the field ends. */
function settle(field: MaterialField, t: readonly number[], p: Point): Point | null {
  let x = p.x,
    y = p.y;
  for (let it = 0; it < ITERATIONS; it++) {
    const m = field(x, y),
      xp = field(x + STEP_PX, y),
      xm = field(x - STEP_PX, y),
      yp = field(x, y + STEP_PX),
      ym = field(x, y - STEP_PX);
    if (!m || !xp || !xm || !yp || !ym) return null;
    // J (3×2) by central differences, the residual r = m − t, and the normal equations JᵀJ δ = −Jᵀr
    let a = 0,
      b = 0,
      d = 0,
      gx = 0,
      gy = 0;
    for (let k = 0; k < 3; k++) {
      const jx = (xp[k]! - xm[k]!) / (2 * STEP_PX),
        jy = (yp[k]! - ym[k]!) / (2 * STEP_PX),
        r = m[k]! - t[k]!;
      a += jx * jx;
      b += jx * jy;
      d += jy * jy;
      gx += jx * r;
      gy += jy * r;
    }
    const det = a * d - b * b;
    if (!(Math.abs(det) > 1e-18)) return null;
    const dx = -(d * gx - b * gy) / det,
      dy = -(a * gy - b * gx) / det;
    x += dx;
    y += dy;
    if (Math.hypot(dx, dy) < TOLERANCE_PX) break;
  }
  return { x, y };
}
