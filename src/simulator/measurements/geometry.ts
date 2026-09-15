import { pixelToPolar, polarToPixel, type SectorMapping } from '../renderer/scanConvert';

export function reprojectGeometry(
  points: { x: number; y: number }[],
  from: SectorMapping | undefined,
  to: SectorMapping,
): { x: number; y: number }[] {
  if (!from) return points;
  return points.map((p) => {
    const { rCm, thetaRad } = pixelToPolar(from, p.x, p.y);
    return polarToPixel(to, rCm, thetaRad);
  });
}
