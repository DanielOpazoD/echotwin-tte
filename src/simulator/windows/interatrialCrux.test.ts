// @tier slow
import { describe, expect, it } from 'vitest';
import { CASE_INPUTS, loadCaseById } from '@/cases';
import { SimulatorCore } from '@/simulator/core/simulatorCore';
import { baseInput } from '@/simulator/core/baseInput';
import { classifyHeart, computeHeartPose, heartAnchors } from '@/simulator/anatomy/heartModel';
import { makeSample } from '@/simulator/anatomy/tissue';
import { Structure } from '@/simulator/anatomy/tissue';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import { ProceduralSliceRenderer } from '@/simulator/renderer/procedural/sliceRenderer';
import { scenePhysicsFor } from '@/simulator/renderer/scenePhysics';
import {
  allocPolarFrame,
  CALIBRATED_TIER,
  DEFAULT_ACQUISITION,
  polarSpecFor,
} from '@/simulator/renderer/types';

/**
 * Between the atria of the four-chamber view lies the interatrial septum, 4-6 mm thick, and nothing else (decision 318).
 * A reviewer pointed at a wedge under the septal hinge of the mitral valve that should not be there: 13.5 mm of right
 * atrial wall, septum, 2-5 mm of fat and the left atrium's own wall running beside the septum, because the atrium, an
 * ellipsoid, met the septum only around its equator. On the drawn plane, from 0.6 to 2.5 cm beyond the deepest annulus
 * sample, across the lines from the right atrial blood to the left atrial blood: at most 9 mm of tissue and no fat.
 *
 * Declared: the difficult window and the artifact challenge, whose four-chamber plane cuts the superior vena cava between
 * the atria (a plane, not a septum, to be measured on its own), and the tamponade at end-diastole.
 */
const KNOWN_INTERATRIAL_TISSUE: Record<string, string> = {
  'normal-difficult-window': 'the plane cuts the superior vena cava between the atria',
  'artifact-challenge': 'the plane cuts the superior vena cava between the atria',
  'pericardial-effusion-tamponade @0': 'fat between the atria at end-diastole',
};
const MAX_MM = 9;

function between(id: string, phase: number): { widthMm: number; fat: boolean } {
  const c = loadCaseById(id);
  const { heart, thorax, tables } = new SimulatorCore(c, baseInput()).models;
  const spec = polarSpecFor(DEFAULT_ACQUISITION, CALIBRATED_TIER);
  const beam = beamFrameFromPose(
    poseFromControl(thorax, canonicalControl(getViewTarget('a4c'), heart, thorax)),
    1,
  );
  const f = allocPolarFrame(spec);
  new ProceduralSliceRenderer().render(
    {
      heart,
      heartPose: computeHeartPose(heart, cycleStateAt(tables, phase)),
      thorax,
      physics: scenePhysicsFor(c, DEFAULT_ACQUISITION),
    },
    beam,
    spec,
    phase,
    f,
  );
  const S = spec.samples,
    dr = spec.depthCm / S,
    dth = spec.sectorRad / spec.lines;
  let ann = 0;
  for (let i = 0; i < f.structure.length; i++)
    if (f.structure[i] === Structure.MitralAnnulus) ann = Math.max(ann, (i % S) * dr);
  let widthMm = 0,
    fat = false;
  for (let depth = ann + 0.6; depth <= ann + 2.5; depth += 0.1) {
    const s = Math.round(depth / dr);
    let lastRa = -1;
    for (let li = 0; li < spec.lines; li++) {
      const st = f.structure[li * S + s];
      if (st === Structure.RaCavity) lastRa = li;
      if (st === Structure.LaCavity && lastRa >= 0) {
        widthMm = Math.max(widthMm, (li - lastRa - 1) * dth * depth * 10);
        for (let k = lastRa + 1; k < li; k++)
          if (f.structure[k * S + s] === Structure.EpicardialFat) fat = true;
        break;
      }
    }
  }
  return { widthMm, fat };
}

describe('between the atria of the four-chamber view only the septum (decision 318)', () => {
  for (const { id } of CASE_INPUTS)
    for (const phase of [0, 0.35])
      it(`${id} @${phase}`, () => {
        const m = between(id, phase);
        const ok = m.widthMm <= MAX_MM && !m.fat;
        const declared =
          KNOWN_INTERATRIAL_TISSUE[id] ?? KNOWN_INTERATRIAL_TISSUE[`${id} @${phase}`];
        // a declared case must still need it: once it holds, the entry is stale
        expect(
          ok,
          `${m.widthMm.toFixed(1)} mm${m.fat ? ' with fat' : ''}${declared ? ` (declared: ${declared})` : ''}`,
        ).toBe(!declared);
      });
});

/**
 * The fossa ovalis is a membrane between the two atrial cavities (decision 319): its floor is the one true septum, the
 * window of a patent foramen ovale or a secundum defect. It sat where only the left atrium reached the septum, under the
 * superior vena cava and 5 mm of fat on the right: 11 mm from blood to blood. Across the septum at its centre and 0.2 cm
 * around it, from the right atrial blood to the left: at most 4.5 mm, a millimetre thinner than the model's muscular
 * septum (5.5 mm): a 1.2 mm membrane and the right atrium's thin wall, all of it septum or right atrial wall. Declared: the tamponade at end-diastole, when the right atrium collapses
 * away from the septum and fat fills the gap.
 */
const KNOWN_FOSSA: Record<string, string> = {
  'pericardial-effusion-tamponade @0': 'the right atrium collapses away from the septum',
};

describe('the fossa ovalis is a membrane between the atria (decision 319)', () => {
  for (const { id } of CASE_INPUTS)
    it(id, () => {
      const c = loadCaseById(id);
      const { heart, tables } = new SimulatorCore(c, baseInput()).models;
      const A = heartAnchors(heart);
      const s = makeSample();
      const problems: string[] = [];
      for (const phase of [0, 0.35]) {
        if (KNOWN_FOSSA[`${id} @${phase}`]) continue;
        const pose = computeHeartPose(heart, cycleStateAt(tables, phase));
        for (const [dy, dz] of [
          [0, 0],
          [0.2, 0],
          [-0.2, 0],
          [0, 0.2],
          [0, -0.2],
        ] as const) {
          const y = A.fossaY + dy,
            z = A.fossaZ + dz;
          let lastRa = NaN,
            firstLa = NaN;
          const between = new Set<number>();
          for (let x = A.iasX - 1.5; x <= A.iasX + 1.5; x += 0.02) {
            const st = classifyHeart(heart, pose, x, y, z, s) ? s.structure : -1;
            if (st === Structure.RaCavity) {
              lastRa = x;
              between.clear();
            } else if (st === Structure.LaCavity) {
              firstLa = x;
              break;
            } else if (Number.isFinite(lastRa)) between.add(st);
          }
          const mm = (firstLa - lastRa - 0.02) * 10;
          const others = [...between].filter(
            (st) => st !== Structure.InteratrialSeptum && st !== Structure.RaWall,
          );
          if (!(mm <= 4.5) || others.length)
            problems.push(
              `@${phase} (${dy}, ${dz}): ${mm.toFixed(1)} mm, other tissue ${others.join(',') || '-'}`,
            );
        }
      }
      expect(problems).toEqual([]);
    });
});
