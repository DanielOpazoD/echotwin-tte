// @tier slow
/**
 * The mitral leaflets of the bound Rodero heart hinge on its own annulus (decision 374). The analytic leaflets it draws
 * hinged on the analytic annulus, 2–5 mm off the CT's in the HFrEF and up to 3.3 mm beside the aorta in the normal; the
 * anterior leaflet crossed the curtain and the annulus, which hold no leaflet, and broke in the long axis.
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
import { volumeHeart } from './volumeHeart';

const fromPublic = (path: string): Promise<ArrayBuffer> => {
  const b = readFileSync(join(process.cwd(), 'public', path));
  return Promise.resolve(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};

describe('the mitral leaflets of the bound Rodero heart hinge on its annulus (decision 374)', async () => {
  const volume = await loadRoderoVolume(fromPublic);
  for (const id of ['normal-excellent-window', 'hfref-severe-mr'])
    it(id, () => {
      const { heart, tables } = buildCaseModels(loadCaseById(id), REST_PATIENT);
      const es = tables.endSystoleS / tables.rrS;
      const ed = computeHeartPose(heart, cycleStateAt(tables, 0));
      const vh = volumeHeart(volume, heart, ed);
      // the CT's hinge per 10° sector around the analytic valve's centre, read off the volume's annulus at end diastole
      const N = 36,
        cx = ed.valves.mitral.cx,
        cy = ed.valves.mitral.cy;
      const rs: number[][] = Array.from({ length: N }, () => []);
      const zs = new Array<number>(N).fill(Infinity);
      for (let x = -3; x <= 3; x += 0.05)
        for (let y = -4; y <= 2.5; y += 0.05)
          for (let z = -1.5; z <= 1.5; z += 0.05) {
            if (vh.labelAt(x, y, z) !== 37) continue;
            const t = Math.floor(((Math.atan2(y - cy, x - cx) + Math.PI) / (2 * Math.PI)) * N) % N;
            rs[t]!.push(Math.hypot(x - cx, y - cy));
            zs[t] = Math.min(zs[t]!, z);
          }
      const q = makeSample();
      for (const phase of [0, es]) {
        const pose = computeHeartPose(heart, cycleStateAt(tables, phase));
        // the volume held at end diastole, where its annulus was read, and the analytic valve of the phase carried onto it
        const cls = vh.classifier({ apparatus: pose });
        let hinged = 0,
          sectors = 0;
        for (let t = 0; t < N; t++) {
          if (!rs[t]!.length) continue;
          sectors++;
          const r = [...rs[t]!].sort((a, b) => a - b)[Math.floor(0.1 * (rs[t]!.length - 1))]!;
          const a = -Math.PI + ((t + 0.5) * 2 * Math.PI) / N;
          // a leaflet within 0.5–2.5 mm inside the hinge, from 1 mm above it to 3 mm below
          let hit = false;
          for (let dr = 0.05; dr <= 0.25 && !hit; dr += 0.05)
            for (let dz = -0.1; dz <= 0.3 && !hit; dz += 0.05) {
              const x = cx + (r - dr) * Math.cos(a),
                y = cy + (r - dr) * Math.sin(a),
                z = zs[t]! + dz;
              if (
                cls(x, y, z, q) &&
                (q.structure === Structure.MitralAnterior ||
                  q.structure === Structure.MitralPosterior)
              )
                hit = true;
            }
          if (hit) hinged++;
        }
        expect(sectors).toBeGreaterThan(30);
        // 36 of 36 in the normal, 35 in the HFrEF; before, 29 and 11 at end diastole and none at end systole
        expect(hinged / sectors, `${id} at phase ${phase.toFixed(2)}`).toBeGreaterThan(0.9);
      }
    });
});
