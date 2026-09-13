import { describe, expect, it } from 'vitest';
import { identifyLabels, imageStats, orientApical, LABEL, type RegionImage } from './regionStats';

/** Apical-like phantom: LV cavity disk wrapped by a myocardial ring open at the base, atrium below it. */
function phantom(opts: { cavityGrey: number; myoGrey: number; atriumGrey: number; noise?: (x: number, y: number) => number }): RegionImage {
  const w = 160,
    h = 200;
  const grey = new Float32Array(w * h);
  const labels = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = x + y * w;
      const dLv = Math.hypot((x - 80) / 34, (y - 80) / 50);
      const dLa = Math.hypot((x - 80) / 28, (y - 158) / 24);
      if (dLv < 1) labels[i] = LABEL.cavity;
      else if (dLv < 1.35 && y < 118) labels[i] = LABEL.myocardium; // ring open toward the base
      else if (dLa < 1) labels[i] = LABEL.atrium;
      const base = labels[i] === LABEL.cavity ? opts.cavityGrey : labels[i] === LABEL.myocardium ? opts.myoGrey : labels[i] === LABEL.atrium ? opts.atriumGrey : 0;
      grey[i] = base + (opts.noise ? opts.noise(x, y) : 0);
    }
  return { width: w, height: h, grey, labels, mmPerPx: [0.3, 0.3] };
}

describe('clinical region statistics', () => {
  it('measures per-region grey and tissue/blood contrast exactly on a clean phantom', () => {
    const s = imageStats(phantom({ cavityGrey: 12, myoGrey: 110, atriumGrey: 20 }));
    expect(s.cavity.median).toBe(12);
    expect(s.myocardium.median).toBe(110);
    expect(s.atrium.median).toBe(20);
    expect(s.tissueBloodContrast).toBe(98);
    expect(s.myocardium.n).toBeGreaterThan(200);
  });

  it('accepts the CAMUS label convention and refuses a file where cavity and myocardium are swapped', () => {
    const ok = phantom({ cavityGrey: 0, myoGrey: 0, atriumGrey: 0 });
    expect(() => identifyLabels(ok.labels, ok.width, ok.height)).not.toThrow();
    const swapped = { ...ok, labels: ok.labels.map((l) => (l === 1 ? 2 : l === 2 ? 1 : l)) };
    expect(() => identifyLabels(swapped.labels, swapped.width, swapped.height)).toThrow(/cavity/);
  });

  it('orients a transposed or upside-down apical image so the atrium ends up deeper than the ventricle', () => {
    const img = phantom({ cavityGrey: 5, myoGrey: 100, atriumGrey: 30 });
    const flipped: RegionImage = { ...img, grey: new Float32Array(img.grey.length), labels: new Uint8Array(img.labels.length) };
    for (let y = 0; y < img.height; y++)
      for (let x = 0; x < img.width; x++) {
        flipped.grey[x + (img.height - 1 - y) * img.width] = img.grey[x + y * img.width]!;
        flipped.labels[x + (img.height - 1 - y) * img.width] = img.labels[x + y * img.width]!;
      }
    const back = orientApical(flipped);
    expect(imageStats(back).tissueBloodContrast).toBe(95);
    const centroidY = (im: RegionImage, l: number): number => {
      let s = 0, n = 0;
      for (let y = 0; y < im.height; y++) for (let x = 0; x < im.width; x++) if (im.labels[x + y * im.width] === l) { s += y; n++; }
      return s / n;
    };
    expect(centroidY(back, LABEL.atrium)).toBeGreaterThan(centroidY(back, LABEL.cavity));
  });

  it('recovers a speckle cell that is longer horizontally when the texture is correlated horizontally', () => {
    // deterministic noise correlated over ~6 px horizontally and ~1 px vertically
    const hash = (x: number, y: number): number => {
      let v = (x * 374761393 + y * 668265263) | 0;
      v = (v ^ (v >>> 13)) * 1274126177;
      return ((v ^ (v >>> 16)) >>> 0) / 4294967296;
    };
    const smooth = (x: number, y: number): number => {
      let s = 0;
      for (let k = 0; k < 6; k++) s += hash(x + k, y);
      return (s / 6) * 60;
    };
    const s = imageStats(phantom({ cavityGrey: 10, myoGrey: 80, atriumGrey: 20, noise: smooth }));
    expect(s.speckleCellMm.horizontal).toBeGreaterThan(2 * s.speckleCellMm.vertical);
    expect(s.myocardialLocalStd).toBeGreaterThan(1);
  });

  it('measures the same speckle cell in a thin wall and in a thick one', () => {
    // Decision 74: the first estimator subtracted the mean of each run, so across a 9 mm wall it read a 3 mm cell as
    // 1.6 mm and across a 20 mm wall as 2.05 mm — the wall thickness leaked into the texture measure.
    const hash = (x: number, y: number): number => {
      let v = (x * 374761393 + y * 668265263) | 0;
      v = (v ^ (v >>> 13)) * 1274126177;
      return ((v ^ (v >>> 16)) >>> 0) / 4294967296 - 0.5;
    };
    const w = 260,
      h = 240;
    // noise correlated with a Gaussian of 4 px horizontally and 1.5 px vertically
    const blur = (src: Float32Array, sigma: number, horizontal: boolean): Float32Array => {
      const R = Math.ceil(3 * sigma);
      const out = new Float32Array(src.length);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          let acc = 0;
          for (let j = -R; j <= R; j++) {
            const xx = horizontal ? Math.min(w - 1, Math.max(0, x + j)) : x,
              yy = horizontal ? y : Math.min(h - 1, Math.max(0, y + j));
            acc += Math.exp(-(j * j) / (2 * sigma * sigma)) * src[xx + yy * w]!;
          }
          out[x + y * w] = acc;
        }
      return out;
    };
    const white = new Float32Array(w * h).map((_, i) => hash(i % w, Math.floor(i / w)));
    const texture = blur(blur(white, 4, true), 1.5, false);
    const cell = (wallPx: number): number => {
      const grey = new Float32Array(w * h),
        labels = new Uint8Array(w * h);
      for (let y = 8; y < h - 8; y++)
        for (let x = 0; x < w; x++) {
          const d = Math.abs(x - w / 2);
          labels[x + y * w] = d < 40 ? LABEL.cavity : d < 40 + wallPx ? LABEL.myocardium : LABEL.background;
          grey[x + y * w] = 100 + 400 * texture[x + y * w]!;
        }
      return imageStats({ width: w, height: h, grey, labels, mmPerPx: [0.3, 0.3] }).speckleCellMm.horizontal;
    };
    const thin = cell(30),
      thick = cell(80);
    expect(Math.abs(thin - thick) / thick).toBeLessThan(0.1);
  });
});
