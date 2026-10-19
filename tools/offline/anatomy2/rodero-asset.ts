/**
 * The Rodero mean heart as the app ships it (decision 352): the 0.5 mm label volume of `rodero-voxelize.ts` reduced by
 * an integer factor, each coarse voxel taking a wall or ring label when at least WALL_SHARE of its fine voxels are one
 * (so the atrial walls, 2–3 mm, stay closed), else a valve plane when at least that share is one, else the commonest
 * label. Written run-length encoded along x, with its header, for `public/anatomy/` or a folder of the offline tools.
 *
 *   ANATOMY2_OUT=<folder of rodero-mean-labels.*> npx tsx tools/offline/anatomy2/rodero-asset.ts <factor> <out dir>
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodeLabelRuns } from '@/simulator/anatomy/labelVolumeCodec';

/** Fraction of the fine voxels of a coarse voxel that must be wall (or valve plane) for it to take that label. */
export const WALL_SHARE = 0.25;

const dir = process.env['ANATOMY2_OUT'];
const factor = Number(process.argv[2] ?? '2');
const out = process.argv[3];
if (!dir || !out || !(factor >= 1))
  throw new Error('usage: ANATOMY2_OUT=… rodero-asset.ts <factor> <out dir>');
const header = JSON.parse(readFileSync(join(dir, 'rodero-mean-labels.json'), 'utf8')) as {
  voxelMm: number;
  origin: [number, number, number];
  dims: [number, number, number];
  landmarks: Record<string, [number, number, number]>;
  source: string;
};
const fine = new Uint8Array(readFileSync(join(dir, 'rodero-mean-labels.bin')));
const [nx, ny, nz] = header.dims;
const dims = header.dims.map((n) => Math.floor(n / factor)) as [number, number, number];
const [mx, my, mz] = dims;
const coarse = new Uint8Array(mx * my * mz);
const isWall = (l: number): boolean => (l >= 1 && l <= 6) || (l >= 18 && l <= 24);
const isPlane = (l: number): boolean => l >= 7 && l <= 17;
const need = Math.ceil(WALL_SHARE * factor ** 3);
const count = new Uint16Array(256);
for (let k = 0; k < mz; k++)
  for (let j = 0; j < my; j++)
    for (let i = 0; i < mx; i++) {
      count.fill(0);
      for (let c = 0; c < factor; c++)
        for (let b = 0; b < factor; b++)
          for (let a = 0; a < factor; a++)
            count[fine[i * factor + a + nx * (j * factor + b + ny * (k * factor + c))]!]!++;
      let wall = -1,
        plane = -1,
        common = 0;
      for (let l = 0; l < 256; l++) {
        if (!count[l]) continue;
        if (isWall(l) && count[l]! >= need && (wall < 0 || count[l]! > count[wall]!)) wall = l;
        if (isPlane(l) && count[l]! >= need && (plane < 0 || count[l]! > count[plane]!)) plane = l;
        if (count[l]! > count[common]!) common = l;
      }
      coarse[i + mx * (j + my * k)] = wall >= 0 ? wall : plane >= 0 ? plane : common;
    }
void nz;
mkdirSync(out, { recursive: true });
const runs = encodeLabelRuns(coarse);
writeFileSync(join(out, 'rodero-mean-labels.runs'), runs);
writeFileSync(join(out, 'rodero-mean-labels.bin'), coarse);
const h = {
  ...header,
  voxelMm: header.voxelMm * factor,
  dims,
  reducedBy: factor,
  wallShare: WALL_SHARE,
};
writeFileSync(join(out, 'rodero-mean-labels.json'), JSON.stringify(h, null, 1));
console.info(
  `${dims.join('×')} at ${h.voxelMm} mm: ${coarse.length} voxels, ${runs.length} bytes run-length encoded`,
);
