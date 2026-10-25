// @tier slow
/**
 * The aortic valve of the bound Rodero heart (decision 373): the CT's valve plane was a closed disc 3.8 mm thick that
 * never opened. It is the root's blood now, and the analytic heart's cusps are drawn over the CT's annulus, so the valve
 * opens in systole and closes on its coaptation line in diastole.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { buildCaseModels, REST_PATIENT } from './caseModels';
import { computeHeartPose } from './heartModel';
import { loadRoderoVolume } from './roderoAsset';
import { makeSample, Structure } from './tissue';
import { AORTIC_VALVE_LABEL, volumeHeart } from './volumeHeart';

const fromPublic = (path: string): Promise<ArrayBuffer> => {
  const b = readFileSync(join(process.cwd(), 'public', path));
  return Promise.resolve(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};

describe('the aortic valve of the bound Rodero heart (decision 373)', async () => {
  const volume = await loadRoderoVolume(fromPublic);
  for (const id of ['normal-excellent-window', 'hfref-severe-mr'])
    it(id, () => {
      const { heart, tables } = buildCaseModels(loadCaseById(id), REST_PATIENT);
      const es = tables.endSystoleS / tables.rrS;
      const ed = computeHeartPose(heart, cycleStateAt(tables, 0));
      const vh = volumeHeart(volume, heart, ed);
      // no voxel of the disc is left
      expect(vh.gpu().labels.filter((l) => l === AORTIC_VALVE_LABEL).length).toBe(0);
      const w = vh.aorticWarp(ed)!;
      const q = makeSample();
      /** Millimetres of valve along the CT valve's axis through its centre, from 4 mm below it to 2 cm above. */
      const onAxis = (phase: number): number => {
        const pose = computeHeartPose(heart, cycleStateAt(tables, phase));
        const cls = vh.classifier({ apparatus: pose, motion: { pose, endDiastole: ed } });
        let n = 0;
        for (let t = -0.4; t <= 2; t += 0.025) {
          const p = [0, 1, 2].map((c) => w.centre[c]! + t * w.axis[c]!);
          if (cls(p[0]!, p[1]!, p[2]!, q) && q.structure === Structure.AorticValve) n++;
        }
        return n * 0.25;
      };
      // closed in diastole: the axis runs down the cusps' coaptation line (5.75 mm in the normal, 6.5 in the HFrEF)
      expect(onAxis(0)).toBeGreaterThan(4);
      // open in mid-systole: nothing in the orifice (the disc filled 3.8 mm of it in every phase)
      expect(onAxis(0.5 * es)).toBe(0);
    });
});
