import { describe, expect, it } from 'vitest';
import type { RegionImage } from './regionStats';
import { SECTOR_METRICS, sectorGeometry, sectorStats } from './sectorStats';

/**
 * The whole-sector statistics on phantoms of known truth (fidelity method, rule 16): a sector whose texture is built
 * with a known correlation along and across the beam, known depth bands, a known dark wedge and a thin bright line.
 * The same phantom at two pixel sizes must give the same numbers: the statistics are in millimetres, not pixels.
 */
function sector(
  mm: number,
  paint: (depthMm: number, angle: number, x: number, y: number) => number,
  depthMm = 140,
  halfAngleDeg = 40,
): RegionImage {
  const w = Math.round((2 * depthMm * Math.sin((halfAngleDeg * Math.PI) / 180)) / mm) + 20,
    h = Math.round(depthMm / mm) + 20;
  const grey = new Float32Array(w * h);
  const apexX = w / 2,
    apexY = 8;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = (x - apexX) * mm,
        dy = (y - apexY) * mm;
      if (dy < 0) continue;
      const angle = Math.atan2(dx, dy);
      const depth = Math.hypot(dx, dy);
      if (Math.abs(angle) > (halfAngleDeg * Math.PI) / 180 || depth > depthMm) continue;
      grey[x + y * w] = Math.max(1, Math.min(255, paint(depth, angle, x, y)));
    }
  return { width: w, height: h, grey, labels: new Uint8Array(w * h), mmPerPx: [mm, mm] };
}

/** Deterministic value noise on a lattice of `cellMm` along the beam and `cellAcrossMm` across it, 0–1. */
function beamNoise(cellMm: number, cellAcrossMm: number) {
  const hash = (i: number, j: number): number => {
    let x = (i * 374761393 + j * 668265263) | 0;
    x = ((x ^ (x >>> 13)) * 1274126177) | 0;
    return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
  };
  return (depthMm: number, angle: number): number => {
    // lattice coordinates: depth in cells along the beam, arc length in cells across it
    const u = depthMm / cellMm,
      v = (angle * 100) / cellAcrossMm;
    const i = Math.floor(u),
      j = Math.floor(v),
      fu = u - i,
      fv = v - j;
    const s = (t: number) => t * t * (3 - 2 * t);
    const a = hash(i, j) * (1 - s(fu)) + hash(i + 1, j) * s(fu);
    const b = hash(i, j + 1) * (1 - s(fu)) + hash(i + 1, j + 1) * s(fu);
    return a * (1 - s(fv)) + b * s(fv);
  };
}

describe('whole-sector statistics', () => {
  it('finds the sector apex and fills the wedge, dark dropouts included', () => {
    const img = sector(0.3, (d, a) => (Math.abs(a) < 0.1 && d > 60 && d < 80 ? 0.5 : 100));
    const geo = sectorGeometry(img);
    expect(Math.abs(geo.apexX - img.width / 2)).toBeLessThan(2);
    // the tip of the wedge lights fewer than three pixels per row: the apex is read a couple of rows below it
    expect(geo.apexY - 8).toBeGreaterThanOrEqual(0);
    expect(geo.apexY - 8).toBeLessThanOrEqual(3);
    expect(Math.abs(geo.depthMm - 140)).toBeLessThan(1);
    // the dark wedge inside the sector belongs to the mask
    const x = Math.round(img.width / 2),
      y = Math.round(8 + 70 / 0.3);
    expect(geo.mask[x + y * img.width]).toBe(1);
  });

  it('reads the correlation of a texture along and across the beam, in millimetres whatever the pixel size', () => {
    const noise = beamNoise(1.2, 3.5);
    const paint = (d: number, a: number) => 60 + 120 * noise(d, a);
    const fine = sectorStats(sector(0.25, paint));
    const coarse = sectorStats(sector(0.4, paint));
    // a cell of 1.2 mm along the beam and 3.5 mm across: the texture decorrelates sooner along the beam
    expect(fine.radialCorr1).toBeLessThan(fine.tangentialCorr1);
    expect(fine.radialCorr2).toBeLessThan(0.3);
    expect(fine.tangentialCorr2).toBeGreaterThan(fine.radialCorr2 + 0.25);
    expect(fine.tangentialCorr2).toBeGreaterThan(0.3);
    expect(fine.tangentialCorr8).toBeLessThan(0.3);
    for (const k of ['radialCorr1', 'radialCorr2', 'tangentialCorr1', 'tangentialCorr4'] as const)
      expect(Math.abs(fine[k] - coarse[k]), k).toBeLessThan(0.08);
    for (const k of ['localStd', 'detrendedStd', 'greyP50', 'gradientP50'] as const)
      expect(Math.abs(fine[k] - coarse[k]) / Math.max(1, fine[k]), k).toBeLessThan(0.15);
  });

  it('reads the depth bands, the dark fraction and the angular roll-off of a known field', () => {
    // brightness falls 10 grey per cm of depth, the outer eighths of the sector are half as bright, and a
    // wedge 6–8 cm deep on the left is black
    const paint = (d: number, a: number) =>
      a < -0.4 && d > 60 && d < 80 ? 2 : (180 - d) * (Math.abs(a) > 0.52 ? 0.5 : 1);
    const s = sectorStats(sector(0.3, paint));
    expect(s.bandGrey0).toBeGreaterThan(s.bandGrey4);
    expect(s.bandGrey4).toBeGreaterThan(s.bandGrey10);
    expect(Math.abs(s.bandGrey2 - 150)).toBeLessThan(8);
    expect(s.bandDark6).toBeGreaterThan(0.1);
    expect(s.bandDark2).toBe(0);
    expect(s.darkFraction).toBeGreaterThan(0.01);
    expect(s.edgeRollOff).toBeLessThan(0.7);
    expect(s.edgeRollOff).toBeGreaterThan(0.4);
  });

  it('counts a thin bright line as ridge pixels and a broad band as none', () => {
    const line = sectorStats(sector(0.3, (d) => (Math.abs(d - 70) < 0.5 ? 220 : 60)));
    const band = sectorStats(sector(0.3, (d) => (Math.abs(d - 70) < 6 ? 220 : 60)));
    expect(line.ridgeFraction).toBeGreaterThan(0.002);
    expect(band.ridgeFraction).toBeLessThan(line.ridgeFraction / 3);
  });

  it('returns every metric as a finite number on a plain sector', () => {
    const s = sectorStats(sector(0.3, (d, a) => 80 + 40 * Math.sin(d / 3) * Math.cos(a * 40)));
    for (const k of SECTOR_METRICS) expect(Number.isFinite(s[k]), k).toBe(true);
  });
});
