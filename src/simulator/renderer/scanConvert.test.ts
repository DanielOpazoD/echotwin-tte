import { describe, expect, it } from 'vitest';
import { buildScanLut, computeSectorMapping, LUT_TEXEL_INSIDE, packScanLutTexels, scanConvertLut, scanConvertLutReference } from './scanConvert';
import { DEFAULT_ACQUISITION, polarSpecFor } from './types';

describe('scan conversion fast path', () => {
  it('matches the float bilinear reference within one gray level and keeps the outside black', () => {
    for (const tier of ['low', 'medium', 'high'] as const) {
      const spec = polarSpecFor({ ...DEFAULT_ACQUISITION }, tier);
      const polar = new Uint8ClampedArray(spec.lines * spec.samples);
      // smooth ramps plus a hard edge and single bright samples: exercises interpolation and borders
      for (let l = 0; l < spec.lines; l++)
        for (let s = 0; s < spec.samples; s++) polar[l * spec.samples + s] = (l * 7 + s * 3) % 256 ^ (s === 100 ? 255 : 0);
      for (const [w, h, invert] of [[512, 440, false], [890, 680, true]] as const) {
        const lut = buildScanLut(spec, computeSectorMapping(spec, w, h, invert, 1));
        const fast = new Uint8ClampedArray(w * h * 4);
        const ref = new Uint8ClampedArray(w * h * 4);
        fast.fill(123); // stale content from a recycled buffer must be overwritten
        scanConvertLut(polar, lut, fast);
        scanConvertLutReference(polar, lut, ref);
        let maxDiff = 0;
        for (let i = 0; i < fast.length; i++) maxDiff = Math.max(maxDiff, Math.abs((fast[i] ?? 0) - (ref[i] ?? 0)));
        expect(maxDiff, `${tier} ${w}x${h}`).toBeLessThanOrEqual(1);
        const corner = 0; // top-left pixel is outside the sector
        expect([fast[corner], fast[corner + 1], fast[corner + 2], fast[corner + 3]]).toEqual([0, 0, 0, 255]);
      }
    }
  });

  it('packs the LUT into GPU texels whose integer gather reproduces the fast path exactly (decision 54)', () => {
    for (const tier of ['medium', 'high'] as const) {
      const spec = polarSpecFor({ ...DEFAULT_ACQUISITION }, tier);
      const polar = new Uint8ClampedArray(spec.lines * spec.samples);
      for (let i = 0; i < polar.length; i++) polar[i] = (i * 2654435761) >>> 24;
      const at = (s: number, l: number): number => polar[l * spec.samples + s] ?? -1;
      for (const [w, h, invert] of [[640, 520, false], [890, 680, true]] as const) {
        const lut = buildScanLut(spec, computeSectorMapping(spec, w, h, invert, 1));
        const ref = new Uint8ClampedArray(w * h * 4);
        scanConvertLut(polar, lut, ref);
        const t = packScanLutTexels(lut);
        let greyMismatch = 0,
          nearestMismatch = 0,
          inside = 0;
        for (let p = 0; p < w * h; p++) {
          const o = p * 4;
          let g = 0;
          const c2 = t[o + 2] ?? 0,
            c3 = t[o + 3] ?? 0;
          if (c2 & LUT_TEXEL_INSIDE) {
            inside++;
            // the arithmetic of GLSL_PRESENT_FRAG
            const l0 = t[o] ?? 0,
              s0 = t[o + 1] ?? 0;
            const lt = c2 & 1023,
              st = c3 & 1023;
            const dl = (c2 >> 10) & 1,
              ds = (c3 >> 10) & 1;
            g = ((at(s0, l0) * (1024 - lt) + at(s0, l0 + dl) * lt) * (1024 - st) + (at(s0 + ds, l0) * (1024 - lt) + at(s0 + ds, l0 + dl) * lt) * st) >>> 20;
            const li = Math.min(spec.lines - 1, l0 + (lt >= 512 ? 1 : 0));
            const si = Math.min(spec.samples - 1, s0 + (st >= 512 ? 1 : 0));
            if (li !== lut.li[p] || si !== lut.si[p]) nearestMismatch++;
          }
          if (g !== ref[o]) greyMismatch++;
        }
        expect(inside, `${tier} ${w}x${h}`).toBe(lut.inPix.length);
        expect(greyMismatch, `${tier} ${w}x${h} grey`).toBe(0);
        expect(nearestMismatch, `${tier} ${w}x${h} nearest sample for colour`).toBe(0);
      }
    }
  });
});
