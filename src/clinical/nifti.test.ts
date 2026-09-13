import { describe, expect, it } from 'vitest';
import { parseNifti } from './nifti';

/** Builds a NIfTI-1 file in memory, so the reader is proven before any clinical file is on disk. */
function buildNifti(opts: { dims: [number, number, number]; spacing: [number, number, number]; datatype: number; values: number[]; le: boolean; slope?: number; inter?: number }): Uint8Array {
  const bytesPer = { 2: 1, 4: 2, 16: 4 }[opts.datatype as 2 | 4 | 16];
  const offset = 352;
  const buf = new ArrayBuffer(offset + opts.values.length * bytesPer);
  const v = new DataView(buf);
  const le = opts.le;
  v.setInt32(0, 348, le);
  v.setInt16(40, 3, le);
  opts.dims.forEach((d, i) => v.setInt16(42 + 2 * i, d, le));
  v.setInt16(70, opts.datatype, le);
  v.setInt16(72, bytesPer * 8, le);
  opts.spacing.forEach((s, i) => v.setFloat32(80 + 4 * i, s, le));
  v.setFloat32(108, offset, le);
  v.setFloat32(112, opts.slope ?? 0, le);
  v.setFloat32(116, opts.inter ?? 0, le);
  new Uint8Array(buf, 344, 4).set([110, 43, 49, 0]); // "n+1\0"
  opts.values.forEach((x, i) => {
    const at = offset + i * bytesPer;
    if (opts.datatype === 2) v.setUint8(at, x);
    else if (opts.datatype === 4) v.setInt16(at, x, le);
    else v.setFloat32(at, x, le);
  });
  return new Uint8Array(buf);
}

describe('NIfTI-1 reader', () => {
  it('reads dims, spacing and uint8 voxels in column-major order', () => {
    const values = Array.from({ length: 2 * 3 * 1 }, (_, i) => i * 10);
    const vol = parseNifti(buildNifti({ dims: [2, 3, 1], spacing: [0.31, 0.28, 1], datatype: 2, values, le: true }));
    expect(vol.dims).toEqual([2, 3, 1]);
    expect(vol.spacing[0]).toBeCloseTo(0.31, 5);
    expect(vol.spacing[1]).toBeCloseTo(0.28, 5);
    expect(Array.from(vol.voxels)).toEqual(values); // x + y·nx: the file order is preserved
  });

  it('handles big-endian int16 and float32, and applies scl_slope / scl_inter', () => {
    const be = parseNifti(buildNifti({ dims: [2, 2, 1], spacing: [1, 1, 1], datatype: 4, values: [-3, 0, 7, 1000], le: false }));
    expect(Array.from(be.voxels)).toEqual([-3, 0, 7, 1000]);
    const scaled = parseNifti(buildNifti({ dims: [2, 1, 1], spacing: [1, 1, 1], datatype: 16, values: [1.5, 2], le: true, slope: 2, inter: 1 }));
    expect(Array.from(scaled.voxels)).toEqual([4, 5]);
  });

  it('refuses what it cannot read instead of returning garbage', () => {
    const good = buildNifti({ dims: [2, 2, 1], spacing: [1, 1, 1], datatype: 2, values: [1, 2, 3, 4], le: true });
    const badMagic = good.slice();
    badMagic[345] = 105; // "ni1": a two-file NIfTI
    expect(() => parseNifti(badMagic)).toThrow(/magic/);
    expect(() => parseNifti(good.slice(0, 100))).toThrow(/348-byte header/);
    const truncated = good.slice(0, 353); // header says 4 voxels, only one byte present
    expect(() => parseNifti(truncated)).toThrow(/past the end/);
  });
});
