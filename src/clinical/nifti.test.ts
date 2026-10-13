import { describe, expect, it } from 'vitest';
import { parseNifti, voxelToWorld } from './nifti';

/** Builds a NIfTI-1 file in memory, so the reader is proven before any clinical file is on disk. */
function buildNifti(opts: {
  dims: [number, number, number];
  spacing: [number, number, number];
  datatype: number;
  values: number[];
  le: boolean;
  slope?: number;
  inter?: number;
  /** Writes the sform rows (and sform_code 1). */
  srow?: number[];
  /** Writes the quaternion b, c, d, the offsets and qform_code 1, with pixdim[0] = qfac. */
  quatern?: { b: number; c: number; d: number; off: [number, number, number]; qfac: number };
}): Uint8Array {
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
  if (opts.srow) {
    v.setInt16(254, 1, le);
    opts.srow.forEach((x, i) => v.setFloat32(280 + 4 * i, x, le));
  }
  if (opts.quatern) {
    const q = opts.quatern;
    v.setInt16(252, 1, le);
    v.setFloat32(76, q.qfac, le);
    [q.b, q.c, q.d, ...q.off].forEach((x, i) => v.setFloat32(256 + 4 * i, x, le));
  }
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
    const vol = parseNifti(
      buildNifti({ dims: [2, 3, 1], spacing: [0.31, 0.28, 1], datatype: 2, values, le: true }),
    );
    expect(vol.dims).toEqual([2, 3, 1]);
    expect(vol.spacing[0]).toBeCloseTo(0.31, 5);
    expect(vol.spacing[1]).toBeCloseTo(0.28, 5);
    expect(Array.from(vol.voxels)).toEqual(values); // x + y·nx: the file order is preserved
  });

  it('handles big-endian int16 and float32, and applies scl_slope / scl_inter', () => {
    const be = parseNifti(
      buildNifti({
        dims: [2, 2, 1],
        spacing: [1, 1, 1],
        datatype: 4,
        values: [-3, 0, 7, 1000],
        le: false,
      }),
    );
    expect(Array.from(be.voxels)).toEqual([-3, 0, 7, 1000]);
    const scaled = parseNifti(
      buildNifti({
        dims: [2, 1, 1],
        spacing: [1, 1, 1],
        datatype: 16,
        values: [1.5, 2],
        le: true,
        slope: 2,
        inter: 1,
      }),
    );
    expect(Array.from(scaled.voxels)).toEqual([4, 5]);
  });

  it('refuses what it cannot read instead of returning garbage', () => {
    const good = buildNifti({
      dims: [2, 2, 1],
      spacing: [1, 1, 1],
      datatype: 2,
      values: [1, 2, 3, 4],
      le: true,
    });
    const badMagic = good.slice();
    badMagic[345] = 105; // "ni1": a two-file NIfTI
    expect(() => parseNifti(badMagic)).toThrow(/magic/);
    expect(() => parseNifti(good.slice(0, 100))).toThrow(/348-byte header/);
    const truncated = good.slice(0, 353); // header says 4 voxels, only one byte present
    expect(() => parseNifti(truncated)).toThrow(/past the end/);
  });

  it('maps voxels to RAS millimetres from the sform, the quaternion qform, or the voxel sizes', () => {
    const base = {
      dims: [2, 2, 2] as [number, number, number],
      spacing: [0.8, 0.8, 1.5] as [number, number, number],
      datatype: 2,
      values: [0, 0, 0, 0, 0, 0, 0, 0],
      le: true,
    };
    // sform: a flip of x and an offset, as CT volumes stored in LPS order carry
    const s = parseNifti(
      buildNifti({ ...base, srow: [-0.8, 0, 0, 100, 0, 0.8, 0, -50, 0, 0, 1.5, 20] }),
    );
    expect(voxelToWorld(s, 1, 1, 1)).toEqual([
      expect.closeTo(99.2, 4),
      expect.closeTo(-49.2, 4),
      expect.closeTo(21.5, 4),
    ]);
    // qform: 180° about z (b = c = 0, d = 1) turns +i into −x and +j into −y; qfac −1 flips k
    const q = parseNifti(
      buildNifti({ ...base, quatern: { b: 0, c: 0, d: 1, off: [10, 20, 30], qfac: -1 } }),
    );
    const w = voxelToWorld(q, 1, 1, 1);
    expect(w[0]).toBeCloseTo(9.2, 4);
    expect(w[1]).toBeCloseTo(19.2, 4);
    expect(w[2]).toBeCloseTo(28.5, 4);
    // neither: the voxel sizes alone
    expect(voxelToWorld(parseNifti(buildNifti(base)), 1, 1, 1)).toEqual([
      expect.closeTo(0.8, 4),
      expect.closeTo(0.8, 4),
      expect.closeTo(1.5, 4),
    ]);
  });
});
