/**
 * Minimal NIfTI-1 reader for the clinical reference comparison (decision 69). Pure: it takes the bytes of an
 * uncompressed .nii and returns voxels as Float32 plus the geometry, so it has no Node dependency and cannot
 * reach the browser bundle through an import. Decompressing .nii.gz is the caller's job (node:zlib in
 * tools/clinical).
 *
 * Only what the CAMUS release needs is supported: single-file NIfTI-1 ("n+1"), little or big endian, the
 * integer and float voxel types, and the scl_slope/scl_inter intensity scaling. Voxel order is NIfTI's
 * column-major one: index = x + y·nx + z·nx·ny.
 */
export interface NiftiVolume {
  /** Sizes along x, y, z (z = 1 for a 2D image, or the frame count for a 2D sequence). */
  dims: [number, number, number];
  /** Voxel size along x, y, z in the file's units (millimetres in CAMUS). */
  spacing: [number, number, number];
  voxels: Float32Array;
}

const DATATYPE_BYTES: Record<number, number> = {
  2: 1,
  4: 2,
  8: 4,
  16: 4,
  64: 8,
  256: 1,
  512: 2,
  768: 4,
};

export function parseNifti(bytes: Uint8Array): NiftiVolume {
  if (bytes.length < 348)
    throw new Error(`NIfTI: ${bytes.length} bytes is shorter than the 348-byte header`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let le: boolean;
  if (view.getInt32(0, true) === 348) le = true;
  else if (view.getInt32(0, false) === 348) le = false;
  else throw new Error('NIfTI: sizeof_hdr is not 348 in either byte order — not a NIfTI-1 file');
  const magic = String.fromCharCode(bytes[344]!, bytes[345]!, bytes[346]!);
  if (magic !== 'n+1')
    throw new Error(`NIfTI: magic "${magic}" — only single-file NIfTI-1 ("n+1") is supported`);
  const ndim = view.getInt16(40, le);
  const dim = (i: number): number => (i <= ndim ? Math.max(1, view.getInt16(40 + 2 * i, le)) : 1);
  const dims: [number, number, number] = [dim(1), dim(2), dim(3)];
  const pix = (i: number): number => {
    const v = view.getFloat32(76 + 4 * i, le);
    return Number.isFinite(v) && v > 0 ? v : 1;
  };
  const spacing: [number, number, number] = [pix(1), pix(2), pix(3)];
  const datatype = view.getInt16(70, le);
  const size = DATATYPE_BYTES[datatype];
  if (size === undefined) throw new Error(`NIfTI: unsupported datatype ${datatype}`);
  const offset = Math.round(view.getFloat32(108, le));
  const count = dims[0] * dims[1] * dims[2];
  if (offset + count * size > bytes.length)
    throw new Error(`NIfTI: header announces ${count} voxels past the end of the data`);
  let slope = view.getFloat32(112, le);
  const inter = view.getFloat32(116, le);
  if (!Number.isFinite(slope) || slope === 0) slope = 1; // 0 means "no scaling" in the standard
  const voxels = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const at = offset + i * size;
    let v: number;
    switch (datatype) {
      case 2:
        v = view.getUint8(at);
        break;
      case 4:
        v = view.getInt16(at, le);
        break;
      case 8:
        v = view.getInt32(at, le);
        break;
      case 16:
        v = view.getFloat32(at, le);
        break;
      case 64:
        v = view.getFloat64(at, le);
        break;
      case 256:
        v = view.getInt8(at);
        break;
      case 512:
        v = view.getUint16(at, le);
        break;
      default:
        v = view.getUint32(at, le);
    }
    voxels[i] = v * slope + (Number.isFinite(inter) ? inter : 0);
  }
  return { dims, spacing, voxels };
}
