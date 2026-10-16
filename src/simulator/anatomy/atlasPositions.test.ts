// @tier slow
import { describe, expect, it } from 'vitest';
import { CASE_INPUTS, loadCaseById } from '@/cases';
import { SimulatorCore } from '@/simulator/core/simulatorCore';
import { baseInput } from '@/simulator/core/baseInput';
import { computeHeartPose } from '@/simulator/anatomy/heartModel';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { atlasMarks, type AtlasMarks } from '@/simulator/anatomy/atlasFrame';
import { HEART_ATLAS_POSITIONS, HEART_ATLAS_VESSELS } from '@/clinical/reference-values/heartAtlas';

/**
 * Where the structures of the heart are, against twenty healthy hearts of a four-chamber CT atlas (decision 322). Sizes
 * can all be in range while a structure sits in the wrong place: the right pulmonary veins ran 58° and 61° from the
 * atlas, beyond every one of its hearts, and the dilated right atrium of pulmonary hypertension took up the right
 * inferior vein's lumen. Both sides are measured in a frame built from the anatomy alone (`atlasFrame.ts`).
 *
 * - Vessels, in every case at end-diastole: the direction of each pulmonary vein, the appendage and the venae cavae within
 *   the largest angle of the atlas hearts from their mean.
 * - Positions, in the normal cases at end-diastole: the centroid of the right ventricle and the atria and the centre of
 *   the aortic, pulmonary and tricuspid valves, over the LV length, within the atlas's 10th-90th percentiles on each axis.
 *
 * Declared, with what the atlas measured:
 */
const KNOWN_ATLAS_POSITIONS: Record<string, string> = {
  'normal-difficult-window:rightAtrium.y':
    'the right atrium 1.2 cm behind the 10th percentile: the thick chest wall turns the base (see the aortic valve)',
  'rightVentricle.x':
    'the right ventricular myocardium reaches 0.1-0.6 cm further right than the atlas hearts',
  'normal-excellent-window:leftAtrium.y':
    'the atrium 0.04 cm behind the 10th percentile (small appendage)',
  'normal-excellent-window:leftAtrium.x':
    'the atrium meets the septum flat (decision 327), and the septum does not count as atrial wall in this census: its wall centroid 0.05 cm past the 90th percentile toward the lateral wall',
  'normal-difficult-window:leftAtrium.x':
    'the same, with the posterior wall drawn across the atrium down to the groove (decision 330): its wall centroid 0.02 cm past the 90th percentile toward the lateral wall',
  'normal-difficult-window:leftAtrium.z':
    'the same: its wall centroid 0.1 cm toward the base of the 90th percentile',
  'normal-excellent-window:leftAtrium.z': 'and 0.01 cm toward the apex of the 90th percentile',
  'normal-excellent-window:pulmonaryValve.y': '0.01 cm behind the 10th percentile',
  'normal-difficult-window:leftAtrium.y':
    'the atrium 0.3 cm behind the 10th percentile (small appendage)',
  'normal-difficult-window:aorticValve.x':
    'the thick chest wall turns the base: aortic valve 0.2 cm, pulmonary 0.5 cm and right ventricle 0.4 cm off',
  'normal-difficult-window:pulmonaryValve.x': 'see the aortic valve',
  'normal-difficult-window:pulmonaryValve.y': 'see the aortic valve',
  'normal-difficult-window:rightVentricle.y': 'see the aortic valve',
};
const KNOWN_ATLAS_VESSELS: Record<string, string> = {
  'normal-difficult-window:appendage': '31° against 30.1°',
  'normal-difficult-window:inferiorVenaCava': '42° against 41.1°',
};
const NORMAL = new Set(['normal-excellent-window', 'normal-difficult-window']);

const marks = new Map<string, AtlasMarks>();
function measured(id: string): AtlasMarks {
  let m = marks.get(id);
  if (!m) {
    const { heart, tables } = new SimulatorCore(loadCaseById(id), baseInput()).models;
    m = atlasMarks(heart, computeHeartPose(heart, cycleStateAt(tables, 0)));
    marks.set(id, m);
  }
  return m;
}

const angleDeg = (a: readonly number[], b: readonly number[]): number =>
  (Math.acos(Math.max(-1, Math.min(1, a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!))) * 180) /
  Math.PI;

describe('the vessels leave the heart where the atlas hearts do (decision 322)', () => {
  for (const { id } of CASE_INPUTS)
    it(id, () => {
      const m = measured(id);
      const problems: string[] = [];
      for (const [k, ref] of Object.entries(HEART_ATLAS_VESSELS)) {
        const a = angleDeg(m.vessels[k]!, ref.mean);
        const out = a > ref.maxDeg;
        const declared = KNOWN_ATLAS_VESSELS[`${id}:${k}`] ?? KNOWN_ATLAS_VESSELS[k];
        if (out !== !!declared)
          problems.push(
            `${id}:${k}: ${a.toFixed(0)}° from the atlas mean (its hearts up to ${ref.maxDeg}°)${declared ? `, declared: ${declared}` : ''}`,
          );
      }
      expect(problems).toEqual([]);
    });
});

describe('the normal heart has its chambers and valves where the atlas hearts do (decision 322)', () => {
  for (const id of NORMAL)
    it(id, () => {
      const m = measured(id);
      const problems: string[] = [];
      for (const [k, ref] of Object.entries(HEART_ATLAS_POSITIONS))
        (['x', 'y', 'z'] as const).forEach((axis, i) => {
          const v = m.positions[k]![i]!;
          const d = ref[axis];
          // the frame's own construction fixes a coordinate (the tricuspid centre has y = 0)
          if (d.p10 === d.p90) return;
          const out = v < d.p10 || v > d.p90;
          const declared =
            KNOWN_ATLAS_POSITIONS[`${id}:${k}.${axis}`] ?? KNOWN_ATLAS_POSITIONS[`${k}.${axis}`];
          if (out !== !!declared)
            problems.push(
              `${id}:${k}.${axis}: ${v.toFixed(3)} against ${d.p10}..${d.p90} (median ${d.median})${declared ? `, declared: ${declared}` : ''}`,
            );
        });
      expect(problems).toEqual([]);
    });
});
