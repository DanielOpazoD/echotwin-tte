import type { PolarFrameSpec } from '@/simulator/renderer/types';

type Point = readonly [number, number];
type Edge = readonly [Point, Point];

/** Independent image-mask measurement oracle. Follow cell boundaries, then intersect
 * the contour at disc midplanes. Extrema of pixel centres shrink small chambers;
 * taking extrema across whole slabs instead overstates each disc's diameter.
 * This helper does not query the anatomical model or the declared volume.
 */
export function polarMaskDiscs(
  mask: ArrayLike<number>,
  spec: Pick<PolarFrameSpec, 'lines' | 'samples' | 'sectorRad' | 'depthCm'>,
  structure: number,
  n = 20,
): { diametersCm: number[]; longAxisCm: number } {
  const { lines, samples, sectorRad, depthCm } = spec;
  if (mask.length !== lines * samples || !Number.isInteger(n) || n < 2)
    throw new Error('Invalid mask or disc count');
  const inside = (l: number, s: number) =>
    l >= 0 && l < lines && s >= 0 && s < samples && mask[l * samples + s] === structure;
  const point = (l: number, s: number): Point => {
    const theta = -sectorRad / 2 + (l * sectorRad) / lines;
    const r = (s * depthCm) / samples;
    return [r * Math.sin(theta), r * Math.cos(theta)];
  };
  const edges: Edge[] = [];
  let weight = 0,
    sx = 0,
    sy = 0,
    sxx = 0,
    syy = 0,
    sxy = 0;
  for (let l = 0; l < lines; l++)
    for (let s = 0; s < samples; s++) {
      if (!inside(l, s)) continue;
      const [x, y] = point(l + 0.5, s + 0.5);
      // Polar cells have area proportional to radius. Uniform physical-area moments
      // avoid rotating the axis merely because the far wall has fewer angular pixels.
      const w = s + 0.5;
      weight += w;
      sx += w * x;
      sy += w * y;
      sxx += w * x * x;
      syy += w * y * y;
      sxy += w * x * y;
      if (!inside(l - 1, s)) edges.push([point(l, s), point(l, s + 1)]);
      if (!inside(l + 1, s)) edges.push([point(l + 1, s), point(l + 1, s + 1)]);
      if (!inside(l, s - 1)) edges.push([point(l, s), point(l + 1, s)]);
      if (!inside(l, s + 1)) edges.push([point(l, s + 1), point(l + 1, s + 1)]);
    }
  if (!weight) throw new Error('Empty chamber mask cannot be measured');
  const mx = sx / weight,
    my = sy / weight;
  const angle =
    0.5 *
    Math.atan2(2 * (sxy / weight - mx * my), sxx / weight - mx * mx - (syy / weight - my * my));
  // Both apical planes must enumerate discs from shallow annulus to deep roof.
  // A PCA eigenvector has arbitrary sign: preserve ordering when its tilt changes sign.
  const direction = Math.sin(angle) < 0 ? -1 : 1;
  const ux = direction * Math.cos(angle),
    uy = direction * Math.sin(angle);
  const project = ([x, y]: Point): Point => [
    (x - mx) * ux + (y - my) * uy,
    -(x - mx) * uy + (y - my) * ux,
  ];
  const projected = edges.map(([a, b]): Edge => [project(a), project(b)]);
  let lo = Infinity,
    hi = -Infinity;
  for (const [a, b] of projected) {
    lo = Math.min(lo, a[0], b[0]);
    hi = Math.max(hi, a[0], b[0]);
  }
  const diametersCm = Array.from({ length: n }, (_, i) => {
    const t = lo + ((i + 0.5) * (hi - lo)) / n;
    let left = Infinity,
      right = -Infinity;
    for (const [a, b] of projected) {
      if (!((a[0] <= t && t < b[0]) || (b[0] <= t && t < a[0]))) continue;
      const s = a[1] + ((b[1] - a[1]) * (t - a[0])) / (b[0] - a[0]);
      left = Math.min(left, s);
      right = Math.max(right, s);
    }
    if (!Number.isFinite(left) || right <= left) throw new Error('Incomplete chamber contour');
    return right - left;
  });
  return { diametersCm, longAxisCm: hi - lo };
}
