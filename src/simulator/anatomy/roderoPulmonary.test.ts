// @tier slow
/**
 * The pulmonary valve and trunk of the bound Rodero heart (decision 375): the CT's pulmonary valve plane was a closed
 * disc 3.0 mm thick, like the aortic one (decision 373); it is the trunk's blood now and the analytic pulmonary cusps are
 * drawn over it, closed in diastole and open in systole. Around the trunk the thorax reads the same distance as around
 * the analytic heart's, the mediastinal fat in front of it included (decision 336), so the lung keeps off it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { anchorsCached } from './anchors';
import { buildCaseModels, REST_PATIENT } from './caseModels';
import { pulmonaryTrunkEpiDistance, trunkFrontDistance } from './greatVessels';
import { computeHeartPose } from './heartModel';
import { loadRoderoVolume } from './roderoAsset';
import { makeSample, Structure } from './tissue';
import { PULMONARY_VALVE_LABEL, volumeHeart } from './volumeHeart';

const fromPublic = (path: string): Promise<ArrayBuffer> => {
  const b = readFileSync(join(process.cwd(), 'public', path));
  return Promise.resolve(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};

describe('the pulmonary valve and trunk of the bound Rodero heart (decision 375)', async () => {
  const volume = await loadRoderoVolume(fromPublic);
  for (const id of ['normal-excellent-window', 'hfref-severe-mr'])
    it(id, () => {
      const { heart, tables } = buildCaseModels(loadCaseById(id), REST_PATIENT);
      const es = tables.endSystoleS / tables.rrS;
      const ed = computeHeartPose(heart, cycleStateAt(tables, 0));
      const vh = volumeHeart(volume, heart, ed);
      expect(vh.gpu().labels.filter((l) => l === PULMONARY_VALVE_LABEL).length).toBe(0);
      const w = vh.pulmonaryWarp(ed)!;
      const q = makeSample();
      // the valve's samples in a slab around the CT's valve plane, from 5 mm below it to 2 cm above
      const e1 = (() => {
        const u = [w.axis[1], -w.axis[0], 0];
        const l = Math.hypot(...u);
        return u.map((x) => x / l);
      })();
      const e2 = [
        w.axis[1] * e1[2]! - w.axis[2] * e1[1]!,
        w.axis[2] * e1[0]! - w.axis[0] * e1[2]!,
        w.axis[0] * e1[1]! - w.axis[1] * e1[0]!,
      ];
      const valve = (phase: number): number => {
        const pose = computeHeartPose(heart, cycleStateAt(tables, phase));
        const cls = vh.classifier({ apparatus: pose });
        let n = 0;
        for (let t = -0.5; t <= 2; t += 0.05)
          for (let a = -1.6; a <= 1.6; a += 0.05)
            for (let b = -1.6; b <= 1.6; b += 0.05) {
              const p = [0, 1, 2].map(
                (c) => w.centre[c]! + t * w.axis[c]! + a * e1[c]! + b * e2[c]!,
              );
              if (cls(p[0]!, p[1]!, p[2]!, q) && q.structure === Structure.PulmonaryValve) n++;
            }
        return n;
      };
      // closed in diastole, open in mid-systole: about eight times the cusps' samples (1599 and 204 in the normal)
      const closed = valve(0),
        open = valve(0.5 * es);
      expect(closed).toBeGreaterThan(500);
      expect(closed).toBeGreaterThan(4 * open);
      // around the trunk, where the volume has nothing, the thorax reads at most the analytic heart's distance, the
      // mediastinal fat in front of the trunk included
      const A = anchorsCached(heart);
      const ax = [A.paStj.x - A.rvotB.x, A.paStj.y - A.rvotB.y, A.paStj.z - A.rvotB.z];
      const al = Math.hypot(...ax);
      const n = ax.map((v) => v / al);
      const p1 = (() => {
        const u = [n[1]!, -n[0]!, 0];
        const l = Math.hypot(...u);
        return u.map((v) => v / l);
      })();
      const p2 = [
        n[1]! * p1[2]! - n[2]! * p1[1]!,
        n[2]! * p1[0]! - n[0]! * p1[2]!,
        n[0]! * p1[1]! - n[1]! * p1[0]!,
      ];
      const cls = vh.classifier({ apparatus: ed });
      let checked = 0;
      for (let s = 0; s <= 1; s += 0.25)
        for (let ang = 0; ang < 2 * Math.PI; ang += Math.PI / 8)
          for (let d = A.paR + 0.3; d <= A.paR + 1.1; d += 0.2) {
            const [x, y, z] = [0, 1, 2].map(
              (k) =>
                [A.rvotB.x, A.rvotB.y, A.rvotB.z][k]! +
                s * ax[k]! +
                d * (Math.cos(ang) * p1[k]! + Math.sin(ang) * p2[k]!),
            ) as [number, number, number];
            if (cls(x, y, z, q)) continue;
            checked++;
            const front = trunkFrontDistance(
              heart,
              A,
              x,
              y,
              z,
              pulmonaryTrunkEpiDistance(A, x, y, z),
            );
            expect(q.sdf).toBeLessThanOrEqual(front + 1e-9);
          }
      expect(checked).toBeGreaterThan(10);
    });
});
