// @tier slow
/**
 * The shipped Rodero heart's atria as the app binds them (decision 358): walls 1.4–2 mm thick (CT 1.45, septum 2.0;
 * photon-counting CT 1.6–1.8 by region), closed, and the epicardial fat beside the left atrium in the atrioventricular
 * groove, not on its roof and around its veins nor between both atria.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { buildCaseModels, REST_PATIENT } from './caseModels';
import { computeHeartPose } from './heartModel';
import { loadRoderoVolume } from './roderoAsset';
import { edt, FAT, GROOVE_REACH_MM, volumeHeart } from './volumeHeart';

const fromPublic = (path: string): Promise<ArrayBuffer> => {
  const b = readFileSync(join(process.cwd(), 'public', path));
  return Promise.resolve(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};

describe('the bound Rodero atria (decision 358)', async () => {
  const { heart, tables } = buildCaseModels(loadCaseById('normal-excellent-window'), REST_PATIENT);
  const ed = computeHeartPose(heart, cycleStateAt(tables, 0));
  const g = volumeHeart(await loadRoderoVolume(fromPublic), heart, ed).gpu();
  const L = g.labels;
  const [nx, ny] = g.dims;
  const vox = g.voxelMm;
  const faces = [1, -1, nx, -nx, nx * ny, -nx * ny];

  /** Median thickness (mm) of a wall lining a cavity: at its middle voxels, the distances to both sides less one voxel. */
  const thickness = (wall: number, cavity: number): number => {
    const dCav = edt(g.dims, (v) => L[v] === cavity);
    const dOut = edt(g.dims, (v) => L[v] !== wall && L[v] !== cavity);
    const t: number[] = [];
    for (let v = 0; v < L.length; v++)
      if (L[v] === wall && dCav[v]! <= 6 / vox && Math.abs(dCav[v]! - dOut[v]!) <= 1)
        t.push((dCav[v]! + dOut[v]! - 1) * vox);
    t.sort((a, b) => a - b);
    return t[t.length >> 1]!;
  };

  it('draws the atrial walls 1.4–2 mm thick', () => {
    for (const [wall, cavity] of [
      [3, 33],
      [4, 34],
    ] as const) {
      const t = thickness(wall, cavity);
      expect(t, `wall ${wall}`).toBeGreaterThan(1.4);
      expect(t, `wall ${wall}`).toBeLessThanOrEqual(2);
    }
  });

  it('keeps them closed: no atrial blood touches the outside', () => {
    let open = 0;
    for (let v = 0; v < L.length; v++)
      if ((L[v] === 33 || L[v] === 34) && faces.some((s) => L[v + s] === 0)) open++;
    expect(open).toBe(0);
  });

  it('keeps the fat beside the left atrium in the atrioventricular groove', () => {
    const dMitral = edt(g.dims, (v) => L[v] === 37 || L[v] === 7);
    const d: number[] = [];
    for (let v = 0; v < L.length; v++)
      if (L[v] === 3 && faces.some((s) => L[v + s] === FAT)) d.push(dMitral[v]! * vox);
    expect(d.length).toBeGreaterThan(100);
    // within 2 cm of the mitral annulus: 91 % (33 % when the closing filled every gap)
    expect(d.filter((x) => x <= 20).length / d.length).toBeGreaterThan(0.8);
  });

  it('leaves no fat between both atria, where the septum is', () => {
    const reach = GROOVE_REACH_MM / vox;
    const dLa = edt(g.dims, (v) => L[v] === 3);
    const dRa = edt(g.dims, (v) => L[v] === 4);
    let between = 0;
    for (let v = 0; v < L.length; v++)
      if (L[v] === FAT && dLa[v]! <= reach && dRa[v]! <= reach) between++;
    expect(between).toBe(0);
  });
});
