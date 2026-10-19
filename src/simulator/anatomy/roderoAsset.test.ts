/**
 * The Rodero mean heart the app ships (decision 352): the 1 mm label volume in public/anatomy decodes to its grid with
 * the chambers, walls and valve planes of the mesh, the landmarks of the anatomical frame and the licence it is shared
 * under.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadRoderoVolume } from './roderoAsset';

const fromPublic = (path: string): Promise<ArrayBuffer> => {
  const b = readFileSync(join(process.cwd(), 'public', path));
  return Promise.resolve(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};

describe('shipped Rodero heart (decision 352)', () => {
  it('decodes to its grid with the mesh’s walls, valve planes and cavities', async () => {
    const vol = await loadRoderoVolume(fromPublic);
    const [nx, ny, nz] = vol.header.dims;
    expect(vol.labels.length).toBe(nx * ny * nz);
    expect(vol.header.voxelMm).toBe(1);
    const count = new Map<number, number>();
    for (const l of vol.labels) count.set(l, (count.get(l) ?? 0) + 1);
    for (const l of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 31, 32, 33, 34])
      expect(count.get(l) ?? 0, `label ${l}`).toBeGreaterThan(0);
    // the LV cavity of the mean heart: 126.6 mL voxelised at 0.5 mm
    const lv = (count.get(31) ?? 0) / 1000;
    expect(lv).toBeGreaterThan(120);
    expect(lv).toBeLessThan(133);
  });

  it('carries the landmarks of the anatomical frame and its source and licence', async () => {
    const vol = await loadRoderoVolume(fromPublic);
    const L = vol.header.landmarks;
    const length = Math.hypot(...[0, 1, 2].map((i) => L.apex[i]! - L.mitral[i]!));
    expect(length).toBeGreaterThan(85);
    expect(length).toBeLessThan(95);
    const h = JSON.parse(
      readFileSync(join(process.cwd(), 'public/anatomy/rodero-mean.json'), 'utf8'),
    ) as {
      source: string;
      license: string;
    };
    expect(h.source).toMatch(/Rodero/);
    expect(h.license).toMatch(/CC BY 4\.0/);
  });

  it('refuses a header without a grid or without the landmarks', async () => {
    const withHeader = (json: string) => (path: string) =>
      path.endsWith('.json')
        ? Promise.resolve(new TextEncoder().encode(json).buffer)
        : fromPublic(path);
    const good = JSON.parse(
      readFileSync(join(process.cwd(), 'public/anatomy/rodero-mean.json'), 'utf8'),
    ) as Record<string, unknown>;
    await expect(
      loadRoderoVolume(withHeader(JSON.stringify({ ...good, dims: [1, 2] }))),
    ).rejects.toThrow(/grid/);
    await expect(
      loadRoderoVolume(withHeader(JSON.stringify({ ...good, landmarks: {} }))),
    ).rejects.toThrow(/landmark/);
  });
});
