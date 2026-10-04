// @tier slow
import { describe, expect, it } from 'vitest';
import { CASE_INPUTS, loadCaseById } from '@/cases';
import { buildCaseModels, REST_PATIENT } from './caseModels';
import { computeHeartPose, classifyHeart } from './heartModel';
import { anchorsCached } from './anchors';
import { ROOT_EXCURSION, ROOT_STJ_T } from './heartFrame';
import { classifyChambers } from './classify';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { makeSample, Structure, Tissue } from './tissue';
import { add, cross, normalize, scale, sub } from '@/core/vec3';
import { heartToTorso } from './heartFrame';
import { classifyThorax, descAortaScale } from './thoraxModel';

const artery = (s: Structure) =>
  s === Structure.AorticRoot || s === Structure.DescendingAorta || s >= Structure.AscendingAorta;

describe.each([
  REST_PATIENT,
  { ...REST_PATIENT, position: 'supine' as const, respiration: 'inspiration' as const },
  { ...REST_PATIENT, position: 'subcostal-supine' as const, respiration: 'inspiration' as const },
])('continuous thoracic aorta: $position / $respiration', (patient) => {
  for (const { id } of CASE_INPUTS)
    it(`${id}: open connected course, separate pulmonary and caval lumina throughout the beat`, () => {
      const { heart, thorax, tables } = buildCaseModels(loadCaseById(id), patient);
      const q = makeSample(),
        old = makeSample();
      const failures: string[] = [];
      for (const phase of [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9]) {
        const hp = computeHeartPose(heart, cycleStateAt(tables, phase));
        const path = hp.aorta.geometry.arch;
        // Circumcircles from the emitted polyline are independent of the cubic derivative constraint.
        for (let i = 1; i < path.length - 1; i++) {
          const a = sub(path[i]!.p, path[i - 1]!.p),
            b = sub(path[i + 1]!.p, path[i]!.p),
            c = sub(path[i + 1]!.p, path[i - 1]!.p),
            v = cross(a, b);
          const radius =
            (Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z) * Math.hypot(c.x, c.y, c.z)) /
            (2 * Math.hypot(v.x, v.y, v.z));
          expect(radius, `${id} phase ${phase} segment ${i}: folded outer wall`).toBeGreaterThan(
            path[i]!.radiusCm + 0.2,
          );
        }
        const A = anchorsCached(heart);
        const stj = add(A.avCenter, scale(A.avAxis, ROOT_STJ_T));
        stj.x += hp.swingX;
        stj.z += hp.zAnn * ROOT_EXCURSION;
        expect(classifyHeart(heart, hp, stj.x, stj.y, stj.z, q) && q.tissue === Tissue.Blood).toBe(
          true,
        );

        for (const [pathIndex, path] of [
          hp.aorta.geometry.arch,
          ...hp.aorta.geometry.branches,
        ].entries())
          for (let i = 1; i < path.length; i++) {
            const a = path[i - 1]!,
              b = path[i]!,
              delta = sub(b.p, a.p),
              dir = normalize(delta);
            const e1 = normalize(
                cross(dir, Math.abs(dir.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 }),
              ),
              e2 = cross(dir, e1);
            for (const u of [0.1, 0.5, 0.9]) {
              const p = add(a.p, scale(delta, u)),
                r = a.radiusCm + (b.radiusCm - a.radiusCm) * u;
              if (
                !classifyHeart(heart, hp, p.x, p.y, p.z, q) ||
                !artery(q.structure) ||
                q.tissue !== Tissue.Blood
              )
                failures.push(
                  `closed axis phase=${phase} path=${pathIndex} segment=${i} tissue=${q.tissue} structure=${q.structure}`,
                );
              // Independent chamber classifier: it has no new aortic priority to conceal a collision.
              for (let k = 0; k < 12; k++) {
                const angle = (k * Math.PI) / 6;
                const v = add(
                  p,
                  add(
                    scale(e1, (r + 0.1) * Math.cos(angle)),
                    scale(e2, (r + 0.1) * Math.sin(angle)),
                  ),
                );
                if (
                  classifyChambers(heart, hp, v.x, v.y, v.z, old) &&
                  [Structure.PulmonaryArtery, Structure.Svc].includes(old.structure)
                )
                  failures.push(
                    `vessel collision phase=${phase} path=${pathIndex} segment=${i} structure=${old.structure}`,
                  );
              }
            }
          }
        const end = heartToTorso(heart.frame, hp.aorta.geometry.arch.at(-1)!.p);
        for (const dy of [-0.01, 0.01]) {
          const hit = classifyThorax(
            thorax,
            end.x,
            end.y + dy,
            end.z,
            q,
            99,
            descAortaScale(thorax, hp.state.aorticPressure),
          );
          if (dy < 0)
            expect(
              hit && q.structure === Structure.DescendingAorta && q.tissue === Tissue.Blood,
            ).toBe(true);
          else expect(q.structure).not.toBe(Structure.DescendingAorta);
        }
      }
      expect(failures.slice(0, 30), `${failures.length} failures`).toEqual([]);
    });
});
