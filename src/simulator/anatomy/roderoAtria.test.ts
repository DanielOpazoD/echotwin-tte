// @tier slow
/**
 * The shipped Rodero heart's atria as the app binds them (decision 358): walls 1.4–2 mm thick (CT 1.45, septum 2.0;
 * photon-counting CT 1.6–1.8 by region), closed, and the epicardial fat beside the left atrium in the atrioventricular
 * groove, not on its roof and around its veins. Since decision 364, one interatrial septum where the atria face each
 * other, the left atrium down to the mitral hinge, and no fat nor pericardium inside the heart.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { buildCaseModels, REST_PATIENT } from './caseModels';
import { computeHeartPose } from './heartModel';
import { loadRoderoVolume } from './roderoAsset';
import { edt, FAT, GROOVE_REACH_MM, SEPTUM_MM, volumeHeart } from './volumeHeart';

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

  it('builds one interatrial septum where the atria face each other (decision 364)', () => {
    // on the surface midway between the two cavities, where the directions to them are opposite: the cavities' distance
    const LA = new Set([33, 11, 12, 13, 14, 15]),
      RA = new Set([34, 16, 17]);
    const dL = edt(g.dims, (v) => LA.has(L[v]!));
    const dR = edt(g.dims, (v) => RA.has(L[v]!));
    const steps = [1, nx, nx * ny];
    const facing = (v: number): boolean => {
      const a = steps.map((s) => dL[v + s]! - dL[v - s]!),
        b = steps.map((s) => dR[v + s]! - dR[v - s]!);
      const n = Math.hypot(...a) * Math.hypot(...b);
      return n > 0 && (a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!) / n < -0.8;
    };
    const span: number[] = [];
    let gap = 0;
    for (let v = nx * ny; v < L.length - nx * ny; v++) {
      if (LA.has(L[v]!) || RA.has(L[v]!) || dL[v]! > 8 / vox || dR[v]! > 8 / vox || !facing(v))
        continue;
      if (Math.abs(dL[v]! - dR[v]!) <= 0.5) span.push((dL[v]! + dR[v]!) * vox);
      if (L[v] === 0) gap++;
    }
    span.sort((a, b) => a - b);
    // the septum plus half a voxel to each cavity: median 4.9 mm, 90th percentile 5.3 (6.3 and 7.6 with the mesh's two
    // walls and the gap between them, which reached 10 mm here and 16 where the atria do not quite face each other)
    expect(span[span.length >> 1]!).toBeLessThan(SEPTUM_MM + 1.5);
    expect(span[Math.floor(0.9 * (span.length - 1))]!).toBeLessThan(SEPTUM_MM + 2);
    // what is left of the gap where they face each other: 128 voxels at the septum's edges (2402 before)
    expect(gap).toBeLessThan(300);
    // the septum joins the atria only where they face each other: the right atrial wall 19.6 mL (17.9 with the gap;
    // 20.2 if the atria were joined wherever both lie near)
    const mL = (vox * g.k) ** 3; // one voxel, cm³ of the model
    const wall = (l: number): number => L.reduce((n, x) => n + (x === l ? 1 : 0), 0) * mL;
    expect(wall(4)).toBeLessThan(20);
  });

  it('ends the LV wall at the mitral hinge beside the left atrium, and keeps the atrioventricular septum (decision 364)', () => {
    // the mitral hinge per azimuth around the LV axis, from the annulus; LV myocardium past it on the atrial side
    const M = g.mesh;
    const anat = (v: number): [number, number, number] => {
      const i = v % nx,
        jj = Math.floor(v / nx) % ny,
        k = Math.floor(v / (nx * ny));
      const m = [
        g.gridOrigin[0] + (i + 0.5) * vox - M.o[0],
        g.gridOrigin[1] + (jj + 0.5) * vox - M.o[1],
        g.gridOrigin[2] + (k + 0.5) * vox - M.o[2],
      ];
      const d = (e: readonly number[]) => m[0]! * e[0]! + m[1]! * e[1]! + m[2]! * e[2]!;
      return [d(M.ex), d(M.ey), d(M.ez)];
    };
    const S = 36;
    const sector = (a: [number, number, number]) =>
      Math.floor(((Math.atan2(a[1], a[0]) + Math.PI) / (2 * Math.PI)) * S) % S;
    const hinge = new Array<number>(S).fill(Infinity);
    for (let v = 0; v < L.length; v++)
      if (L[v] === 37) {
        const a = anat(v);
        hinge[sector(a)] = Math.min(hinge[sector(a)]!, a[2]);
      }
    const dLa = edt(g.dims, (v) => L[v] === 33);
    const dRa = edt(g.dims, (v) => L[v] === 34);
    let leftSide = 0,
      rightSide = 0;
    for (let v = 0; v < L.length; v++) {
      if (L[v] !== 1) continue;
      const a = anat(v);
      if (a[2] > hinge[sector(a)]! - 0.5) continue;
      if (dLa[v]! <= dRa[v]! && dRa[v]! * vox > 6) leftSide++;
      else if (dRa[v]! < dLa[v]!) rightSide++;
    }
    const mL = (vox * g.k) ** 3;
    // on the left atrium's side: 0.21 mL left at the crux and the sector edges (3.29 in the mesh)
    expect(leftSide * mL).toBeLessThan(0.4);
    // on the right atrium's side the LV's basal septum faces the atrium above the tricuspid hinge: the atrioventricular
    // septum, kept (0.71 mL; 0.65 in the mesh)
    expect(rightSide * mL).toBeGreaterThan(0.4);
  });

  it('leaves no fat between both atria: inside the heart there is no fat (decisions 358, 364)', () => {
    const reach = GROOVE_REACH_MM / vox;
    const dLa = edt(g.dims, (v) => L[v] === 3);
    const dRa = edt(g.dims, (v) => L[v] === 4);
    let between = 0;
    for (let v = 0; v < L.length; v++)
      if (L[v] === FAT && dLa[v]! <= reach && dRa[v]! <= reach) between++;
    expect(between).toBe(0);
  });
});
