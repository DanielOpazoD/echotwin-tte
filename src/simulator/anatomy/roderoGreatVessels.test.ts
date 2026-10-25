// @tier slow
/**
 * The great vessels of the bound Rodero heart (decision 372): the CT segmentation cut the aorta 4.5 cm past its valve and
 * the pulmonary trunk 1.8 cm past its own, so the suprasternal view held no arch and the parasternal short axis no trunk.
 * Where the volume has nothing they carry on as the analytic heart's; where it has tissue, the volume's stays.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { anchorsCached } from './anchors';
import { AORTIC_ASCENDING_SEGMENTS } from './aorticExtension';
import { buildCaseModels, REST_PATIENT } from './caseModels';
import { computeHeartPose } from './heartModel';
import { loadRoderoVolume } from './roderoAsset';
import { makeSample, Structure, Tissue } from './tissue';
import { LABELS, volumeHeart } from './volumeHeart';

const fromPublic = (path: string): Promise<ArrayBuffer> => {
  const b = readFileSync(join(process.cwd(), 'public', path));
  return Promise.resolve(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};

describe('the great vessels of the bound Rodero heart (decision 372)', async () => {
  const volume = await loadRoderoVolume(fromPublic);
  for (const id of ['normal-excellent-window', 'hfref-severe-mr'])
    it(id, () => {
      const { heart, tables } = buildCaseModels(loadCaseById(id), REST_PATIENT);
      const es = tables.endSystoleS / tables.rrS;
      const ed = computeHeartPose(heart, cycleStateAt(tables, 0));
      const vh = volumeHeart(volume, heart, ed);
      const q = makeSample();
      for (const phase of [0, es]) {
        const pose = computeHeartPose(heart, cycleStateAt(tables, phase));
        const cls = vh.classifier({ apparatus: pose, motion: { pose, endDiastole: ed } });
        // the arch: every point on its centreline past the ascending segments is aortic blood
        const arch = pose.aorta.geometry.arch;
        let archBlood = 0,
          archPoints = 0;
        for (let i = AORTIC_ASCENDING_SEGMENTS + 1; i < arch.length; i++) {
          const p = arch[i]!.p;
          archPoints++;
          if (
            cls(p.x, p.y, p.z, q) &&
            q.tissue === Tissue.Blood &&
            q.structure === Structure.AorticArch
          )
            archBlood++;
        }
        expect(archBlood, `arch at phase ${phase.toFixed(2)}`).toBe(archPoints);
        // the trunk: its centreline from the sinotubular junction to the bifurcation is pulmonary arterial blood
        const A = anchorsCached(heart);
        let trunkBlood = 0;
        for (let t = 0; t <= 1; t += 0.1) {
          const x = A.paStj.x + t * (A.paEnd.x - A.paStj.x),
            y = A.paStj.y + t * (A.paEnd.y - A.paStj.y),
            z = A.paStj.z + pose.pvZ * (1 - t) + t * (A.paEnd.z - A.paStj.z);
          if (
            cls(x, y, z, q) &&
            q.tissue === Tissue.Blood &&
            q.structure === Structure.PulmonaryArtery
          )
            trunkBlood++;
        }
        // eleven points: the first lies in the volume's own outflow where the CT still has it
        expect(trunkBlood, `trunk at phase ${phase.toFixed(2)}`).toBeGreaterThanOrEqual(10);
      }
      // where the volume has tissue, the volume's own label is drawn: its aortic and pulmonary walls (both valve planes
      // are blood since decisions 373 and 375)
      const cls = vh.classifier({ apparatus: ed });
      let own = 0,
        kept = 0;
      for (let x = -5; x <= 5; x += 0.25)
        for (let y = -4; y <= 8; y += 0.25)
          for (let z = -9; z <= 2; z += 0.25) {
            const l = vh.labelAt(x, y, z);
            if (l !== 5 && l !== 6) continue;
            own++;
            if (cls(x, y, z, q) && q.structure === LABELS[l]![1]) kept++;
          }
      expect(own).toBeGreaterThan(500);
      expect(kept).toBe(own);
    });
});
