import { describe, expect, it } from 'vitest';
import { apicalGeometry } from './apicalGeometry';
import { LABEL, type RegionImage } from './regionStats';

const W = 320,
  H = 320,
  VX = 160,
  VY = 8,
  MM = 0.3;

/**
 * Apical four-chamber phantom with straight walls: an 80° sector from (VX, VY); an LV cavity between two lines through
 * its apex point (`apexX`, `apexY`) at `leftDeg` and `rightDeg` from vertical (positive toward image right), 180 px long;
 * 12 px of myocardium outside each wall (left 120, right 80 grey); the band outside the left wall dark, so it is septal.
 */
function phantom(apexX: number, apexY: number, leftDeg: number, rightDeg: number): RegionImage {
  const grey = new Float32Array(W * H),
    labels = new Uint8Array(W * H);
  const tl = Math.tan((leftDeg * Math.PI) / 180),
    tr = Math.tan((rightDeg * Math.PI) / 180);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = x + y * W;
      if (y <= VY || Math.abs(Math.atan2(x - VX, y - VY)) > (40 * Math.PI) / 180 || Math.hypot(x - VX, y - VY) > 300) continue;
      grey[i] = 60;
      const d = y - apexY;
      if (d < 0 || d > 180) continue;
      const xl = apexX + tl * d,
        xr = apexX + tr * d; // inner edges
      if (x > xl && x < xr) labels[i] = LABEL.cavity;
      else if (x <= xl && x > xl - 12) {
        labels[i] = LABEL.myocardium;
        grey[i] = 120;
      } else if (x >= xr && x < xr + 12) {
        labels[i] = LABEL.myocardium;
        grey[i] = 80;
      } else if (x <= xl - 12 && x > xl - 60) grey[i] = 15;
    }
  return { width: W, height: H, grey, labels, mmPerPx: [MM, MM] };
}

/** Expected wall–ray angle: wall centre line (x = apexX ± 6 + tan·d) at the middle of the mid-cavity rows, seen from the sector apex. */
function expectedRayAngle(apexX: number, apexY: number, wallDeg: number, side: -1 | 1): number {
  const d = 0.5 * 180; // middle of rows 30-70% of the cavity height
  const x = apexX + Math.tan((wallDeg * Math.PI) / 180) * d + side * 6;
  const rayDeg = (Math.atan2(x - VX, apexY + d - VY) * 180) / Math.PI;
  return Math.abs(wallDeg - rayDeg);
}

describe('apical geometry against the sector', () => {
  it('reads the apex offset and depth, the axis tilt and the septal side of a known phantom', () => {
    const g = apicalGeometry(phantom(VX + 20, VY + 60, -8, 24), '4CH');
    expect(Math.abs(g.apexOffsetMm - 20 * MM)).toBeLessThan(0.6);
    expect(Math.abs(g.apexDepthMm - 60 * MM)).toBeLessThan(0.6);
    // the long axis runs midway between the walls: 8° toward image right
    expect(Math.abs(g.axisTiltDeg - 8)).toBeLessThan(1);
    // the dark band marks the left wall as septal, the brighter one here
    expect(g.septalMinusLateralGrey).toBe(40);
    // mirrored image: the septum is on the right, and every signed quantity keeps pointing to the lateral wall
    const img = phantom(VX + 20, VY + 60, -8, 24);
    const m: RegionImage = { ...img, grey: new Float32Array(W * H), labels: new Uint8Array(W * H) };
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        m.grey[W - 1 - x + y * W] = img.grey[x + y * W]!;
        m.labels[W - 1 - x + y * W] = img.labels[x + y * W]!;
      }
    const gm = apicalGeometry(m, '4CH');
    expect(Math.abs(gm.apexOffsetMm - g.apexOffsetMm)).toBeLessThan(0.7);
    expect(Math.abs(gm.axisTiltDeg - g.axisTiltDeg)).toBeLessThan(1);
    expect(gm.septalMinusLateralGrey).toBe(40);
  });

  it('measures the angle between each wall and the scan line through it', () => {
    for (const [apexX, left, right] of [[VX, -12, 12], [VX + 40, -4, 26], [VX - 30, -20, 6]] as const) {
      const g = apicalGeometry(phantom(apexX, VY + 50, left, right), '4CH');
      expect(Math.abs(g.septalRayAngleDeg - expectedRayAngle(apexX, VY + 50, left, -1))).toBeLessThan(1);
      expect(Math.abs(g.lateralRayAngleDeg - expectedRayAngle(apexX, VY + 50, right, 1))).toBeLessThan(1);
    }
  });
});
