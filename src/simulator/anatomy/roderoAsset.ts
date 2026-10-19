/**
 * The Rodero mean heart the app ships (decision 352): `public/anatomy/rodero-mean.json` (header: source, licence, grid
 * and the landmarks of the anatomical frame) and `rodero-mean.runs` (the 1 mm label volume, run-length coded), derived
 * from the CC BY 4.0 mean shape of Rodero et al. 2021 by `tools/offline/anatomy2/rodero-voxelize.ts` and
 * `rodero-asset.ts`. Fetched only when the experimental anatomy is chosen; the fetch is the caller's (the worker's
 * `fetch`, the tests' file system).
 */
import { decodeLabelRuns } from './labelVolumeCodec';
import type { LabelVolume, LabelVolumeHeader } from './volumeHeart';

/** The asset's paths under the app's base URL. */
export const RODERO_HEADER_PATH = 'anatomy/rodero-mean.json';
export const RODERO_RUNS_PATH = 'anatomy/rodero-mean.runs';

/** Fetches one of the asset's files (a path under the app's base URL) as bytes. */
export type AssetFetcher = (path: string) => Promise<ArrayBuffer>;

const LANDMARKS = ['mitral', 'tricuspid', 'aortic', 'pulmonary', 'apex'] as const;

/** The shipped label volume, checked: three positive dimensions, the five landmarks and as many labels as voxels. */
export async function loadRoderoVolume(fetchAsset: AssetFetcher): Promise<LabelVolume> {
  const [headerBytes, runs] = await Promise.all([
    fetchAsset(RODERO_HEADER_PATH),
    fetchAsset(RODERO_RUNS_PATH),
  ]);
  const header = JSON.parse(new TextDecoder().decode(headerBytes)) as LabelVolumeHeader;
  const d = header.dims;
  if (!Array.isArray(d) || d.length !== 3 || d.some((n) => !(Number.isInteger(n) && n > 0)))
    throw new Error('rodero asset: bad grid');
  if (!(header.voxelMm > 0)) throw new Error('rodero asset: bad voxel size');
  for (const k of LANDMARKS)
    if (!Array.isArray(header.landmarks?.[k]) || header.landmarks[k].length !== 3)
      throw new Error(`rodero asset: missing landmark ${k}`);
  return { header, labels: decodeLabelRuns(new Uint8Array(runs), d[0] * d[1] * d[2]) };
}
