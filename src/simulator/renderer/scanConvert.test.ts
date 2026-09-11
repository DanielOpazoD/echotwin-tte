import { describe, expect, it } from 'vitest';
import { buildScanLut, computeSectorMapping, scanConvertLut, scanConvertLutReference } from './scanConvert';
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
});
