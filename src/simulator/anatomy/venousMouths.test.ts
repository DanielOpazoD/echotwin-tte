// @tier fast
import { describe, expect, it } from 'vitest';
import { CASE_INPUTS, loadCaseById } from '@/cases';
import { SimulatorCore } from '@/simulator/core/simulatorCore';
import { baseInput } from '@/simulator/core/baseInput';
import { classifyHeart, computeHeartPose, heartAnchors } from '@/simulator/anatomy/heartModel';
import { makeSample, Structure, Tissue } from '@/simulator/anatomy/tissue';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { pulmonaryVeinSegment } from '@/simulator/anatomy/pulmonaryVeins';
import { atrialScale } from '@/simulator/anatomy/classify/atria';

/**
 * The veins and the appendage open into the left atrium (decision 320). The atrial wall and the interatrial septum were
 * classified before them, so 2.5-6 mm of wall closed each pulmonary vein and the appendage at its mouth: a 3D census of
 * the classifier found the atrium's blood meeting the veins' over 0.4 cm² at end-diastole and none at end-systole, against
 * four ostia of 0.9-1.3 cm (CT, Kim et al., Radiology 2005;235:43). From the atrium's centre to the ostium of each vein and of the appendage and 0.8 cm on along its
 * axis, every sample is blood, at end-diastole and at end-systole.
 *
 * Declared: the left superior vein of the six dilated atria, which run into the descending aorta (`KNOWN_LA_IN_AORTA` in
 * `posteriorColumn.test.ts`, decision 273): the vein yields to the aorta there, so its mouth lies inside the column.
 * Making the atrium yield too kept its volume but narrowed it in the four-chamber view by 0.9-1.5 cm, because its centre
 * is fixed and it grew toward the apex instead of to the right and upwards, as a dilating atrium does.
 */
const KNOWN_CLOSED_MOUTHS: Record<string, string> = {
  'hfref-severe-mr': 'left superior vein',
  'aortic-stenosis-severe': 'left superior vein',
  'hocm-sam': 'left superior vein',
  'mvp-primary-mr': 'left superior vein',
  'af-diastolic': 'left superior vein',
};
const NAMES = [
  'right superior vein',
  'left superior vein',
  'right inferior vein',
  'left inferior vein',
];

function mouths(id: string, phase: number): string[] {
  const { heart, tables } = new SimulatorCore(loadCaseById(id), baseInput()).models;
  const hp = computeHeartPose(heart, cycleStateAt(tables, phase));
  const A = heartAnchors(heart);
  const la = A.laCenter,
    lr = A.laR;
  const zTop = la.z - lr.z,
    zBottom = hp.zAnn + 0.25;
  const czL = (zTop + zBottom) / 2,
    rzL = (zBottom - zTop) / 2;
  const bo = atrialScale(hp.laBooster, A.laReservoir, hp.state.contraction);
  const s = makeSample();
  const closed: string[] = [];
  // from the atrium's centre (on the axis through the ostium) to the ostium, then 0.8 cm along the vessel
  const walk = (name: string, o: number[], e: number[]) => {
    const len = Math.hypot(e[0]! - o[0]!, e[1]! - o[1]!, e[2]! - o[2]!);
    const c = [la.x, la.y, czL];
    const met = new Set<string>();
    const probe = (p: number[]) => {
      // the classifier takes the swing of the tamponade heart off x itself
      const hit = classifyHeart(heart, hp, p[0]! + hp.swingX, p[1]!, p[2]!, s);
      if (!hit || s.tissue !== Tissue.Blood) met.add(hit ? String(s.structure) : 'none');
    };
    for (let t = 0; t <= 1; t += 0.01) probe(c.map((v, k) => v + (o[k]! - v) * t));
    for (let t = 0; t <= 0.8; t += 0.01) probe(o.map((v, k) => v + ((e[k]! - v) * t) / len));
    if (met.size) closed.push(`${name}: ${[...met].map((m) => STRUCTURE_NAME[m] ?? m).join(', ')}`);
  };
  const seg = new Float64Array(6);
  for (let i = 0; i < 4; i++) {
    pulmonaryVeinSegment(i, la, lr, bo, czL, rzL, seg);
    walk(NAMES[i]!, [seg[0]!, seg[1]!, seg[2]!], [seg[3]!, seg[4]!, seg[5]!]);
  }
  walk(
    'appendage',
    [la.x + lr.x * 0.55, la.y + lr.y * 0.55, czL + 0.4],
    [la.x + lr.x * 0.95, la.y + lr.y * 0.55 + 2.0, czL + 0.9],
  );
  return closed;
}

const STRUCTURE_NAME: Record<string, string> = {
  [String(Structure.LaWall)]: 'left atrial wall',
  [String(Structure.RaWall)]: 'right atrial wall',
  [String(Structure.InteratrialSeptum)]: 'interatrial septum',
  [String(Structure.PulmonaryVein)]: 'vein wall',
  [String(Structure.Pericardium)]: 'pericardium',
  [String(Structure.EpicardialFat)]: 'fat',
};

describe('the pulmonary veins and the appendage open into the left atrium (decision 320)', () => {
  for (const { id } of CASE_INPUTS)
    it(id, () => {
      const closed = [0, 0.35].flatMap((phase) => mouths(id, phase).map((m) => `@${phase} ${m}`));
      const declared = KNOWN_CLOSED_MOUTHS[id];
      const unexpected = closed.filter((m) => !declared || !m.includes(declared));
      expect(unexpected).toEqual([]);
      // a declared mouth that opens makes the entry stale
      if (declared)
        expect(closed.length, `${id}: ${declared} declared closed, and it opens`).toBeGreaterThan(
          0,
        );
    });
});

/**
 * The right pulmonary veins run behind the right atrium into the interatrial groove, outside it (decision 320): the dilated
 * atrium of pulmonary hypertension took up to 46 % of the right inferior vein's first 2 cm, its cavity and wall drawn
 * across the lumen. Over the beat, no sample of the first 2 cm of any vein's lumen is right atrium or vena cava.
 */
describe('the right atrium leaves room for the pulmonary veins (decision 320)', () => {
  const RIGHT = new Set<number>([
    Structure.RaCavity,
    Structure.RaWall,
    Structure.Svc,
    Structure.Ivc,
  ]);
  for (const { id } of CASE_INPUTS)
    it(id, () => {
      const { heart, tables } = new SimulatorCore(loadCaseById(id), baseInput()).models;
      const A = heartAnchors(heart);
      const la = A.laCenter,
        lr = A.laR;
      const s = makeSample();
      const seg = new Float64Array(6);
      const found: string[] = [];
      for (let phase = 0; phase < 1; phase += 0.1) {
        const hp = computeHeartPose(heart, cycleStateAt(tables, phase));
        const zTop = la.z - lr.z,
          zBottom = hp.zAnn + 0.25;
        const czL = (zTop + zBottom) / 2,
          rzL = (zBottom - zTop) / 2;
        const bo = atrialScale(hp.laBooster, A.laReservoir, hp.state.contraction);
        for (let i = 0; i < 4; i++) {
          pulmonaryVeinSegment(i, la, lr, bo, czL, rzL, seg);
          const o = [seg[0]!, seg[1]!, seg[2]!],
            e = [seg[3]!, seg[4]!, seg[5]!];
          const len = Math.hypot(e[0]! - o[0]!, e[1]! - o[1]!, e[2]! - o[2]!);
          const u = o.map((v, k) => (e[k]! - v) / len);
          const w = Math.abs(u[2]!) < 0.9 ? [u[1]!, -u[0]!, 0] : [0, u[2]!, -u[1]!];
          const wl = Math.hypot(w[0]!, w[1]!, w[2]!);
          const v1 = w.map((q) => q / wl);
          const v2 = [
            u[1]! * v1[2]! - u[2]! * v1[1]!,
            u[2]! * v1[0]! - u[0]! * v1[2]!,
            u[0]! * v1[1]! - u[1]! * v1[0]!,
          ];
          let n = 0;
          for (let t = 0.2; t <= Math.min(2, len); t += 0.2)
            for (let a = 0; a < 16; a++)
              for (const r of [0, 0.2, 0.4]) {
                const ang = (a / 16) * 2 * Math.PI;
                const p = o.map(
                  (v, k) => v + u[k]! * t + r * (Math.cos(ang) * v1[k]! + Math.sin(ang) * v2[k]!),
                );
                if (
                  classifyHeart(heart, hp, p[0]! + hp.swingX, p[1]!, p[2]!, s) &&
                  RIGHT.has(s.structure)
                )
                  n++;
              }
          if (n) found.push(`${NAMES[i]} @${phase.toFixed(1)}: ${n} samples`);
        }
      }
      expect(found).toEqual([]);
    });
});
