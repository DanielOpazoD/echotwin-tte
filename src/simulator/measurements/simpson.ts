import { simpsonSinglePlaneVolume } from '@/clinical/formulas';

/**
 * Method of discs from a traced endocardial contour (spec 16.4). The contour runs from one side of
 * the mitral annulus to the other through the apex (display pixels, any orientation). The long axis
 * goes from the annulus midpoint (first↔last point) to the contour point farthest from it; 20 discs
 * perpendicular to that axis take the width of the contour at each level.
 */
export interface DiscProfile {
  /** disc diameters (cm) from base to apex */
  diametersCm: number[];
  longAxisCm: number;
  /** annulus midpoint and apex in the input coordinates */
  base: { x: number; y: number };
  apex: { x: number; y: number };
}

export function discProfileFromContour(
  points: readonly { x: number; y: number }[],
  pxPerCm: number,
  discs = 20,
): DiscProfile | null {
  if (points.length < 5) return null;
  const first = points[0]!,
    last = points[points.length - 1]!;
  const base = { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 };
  let apex = first;
  let best = -1;
  for (const p of points) {
    const d = Math.hypot(p.x - base.x, p.y - base.y);
    if (d > best) {
      best = d;
      apex = p;
    }
  }
  const L = best;
  if (L < 1e-6) return null;
  const ax = (apex.x - base.x) / L,
    ay = (apex.y - base.y) / L; // long axis unit vector
  const px = -ay,
    py = ax; // perpendicular
  // closed polygon: contour + straight base segment
  const poly = [...points, first];
  const diametersCm: number[] = [];
  for (let i = 0; i < discs; i++) {
    const t = ((i + 0.5) / discs) * L;
    const cx = base.x + ax * t,
      cy = base.y + ay * t;
    // intersect the polygon with the line through (cx,cy) along (px,py): solve for s in c + s·p on each edge
    let sMin = Infinity,
      sMax = -Infinity;
    for (let k = 0; k < poly.length - 1; k++) {
      const a = poly[k]!,
        b = poly[k + 1]!;
      // edge param u ∈ [0,1]: a + u(b−a) = c + s p  → along the axis direction the edge crosses level t
      const aT = (a.x - base.x) * ax + (a.y - base.y) * ay;
      const bT = (b.x - base.x) * ax + (b.y - base.y) * ay;
      if ((aT - t) * (bT - t) > 0 || aT === bT) continue;
      const u = (t - aT) / (bT - aT);
      const ix = a.x + (b.x - a.x) * u,
        iy = a.y + (b.y - a.y) * u;
      const s = (ix - cx) * px + (iy - cy) * py;
      sMin = Math.min(sMin, s);
      sMax = Math.max(sMax, s);
    }
    diametersCm.push(Number.isFinite(sMin) && Number.isFinite(sMax) ? (sMax - sMin) / pxPerCm : 0);
  }
  return { diametersCm, longAxisCm: L / pxPerCm, base, apex };
}

/** Single-plane method-of-discs volume of a traced profile (mL). */
export function volumeFromProfileMl(profile: DiscProfile): number {
  return simpsonSinglePlaneVolume(profile.diametersCm, profile.longAxisCm);
}
