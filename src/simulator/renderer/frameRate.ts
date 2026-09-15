import { SPEED_OF_SOUND_MPS } from '@/core/units';
import type { PolarFrameSpec } from './types';

/**
 * Simulated echo frame rate (spec 35): lines × two-way time per line (× colour packet cost).
 * Teaches the depth / sector / density / colour trade-off; not vendor-specific.
 */
export function simulatedFrameRate(
  spec: PolarFrameSpec,
  opts: { colorLines?: number; packetSize?: number; focalZones?: number } = {},
): number {
  const lineTimeS = (2 * (spec.depthCm / 100)) / SPEED_OF_SOUND_MPS + 0.00002; // + overhead
  const focal = opts.focalZones ?? 1;
  const bmode = spec.lines * lineTimeS * focal;
  const color = (opts.colorLines ?? 0) * (opts.packetSize ?? 8) * lineTimeS;
  const fps = 1 / (bmode + color);
  return Math.min(90, fps);
}
