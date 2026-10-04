// @tier slow
import { describe, expect, it } from 'vitest';
import { CASE_INPUTS, loadCaseById } from '@/cases';
import { SimulatorCore } from '@/simulator/core/simulatorCore';
import { baseInput } from '@/simulator/core/baseInput';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import { ProceduralSliceRenderer } from '@/simulator/renderer/procedural/sliceRenderer';
import { allocPolarFrame, DEFAULT_ACQUISITION, polarSpecFor } from '@/simulator/renderer/types';
import { classifyHeart } from './classify';
import { torsoToHeart } from './heartFrame';
import { computeHeartPose } from './heartPose';
import {
  DESC_AORTA_R,
  DESC_AORTA_WALL,
  DESC_AORTA_X,
  DESC_AORTA_Z,
  SPINE_R,
  SPINE_Z,
} from './thoraxModel';
import { makeSample, Structure } from './tissue';

/**
 * The heart against the posterior column (decision 273). Behind the left atrium lie the oesophagus, the descending aorta
 * and the vertebral body; the atrium rests on them a few millimetres away (4.8 ± 5.1 mm from the vertebral body, MRI,
 * Yamashita et al., J Interv Card Electrophysiol 2018) and the aorta touches it or the left pulmonary veins in 50 of 65
 * subjects (CT, Cury et al., Heart Rhythm 2005). Before: the left atrium, its veins, its sac and the effusion of the
 * tamponade ran through the aorta and the vertebral body in nine of the twelve cases; a fixed shell 0.25 cm over the
 * atrium's largest size left 4–5 mm of fat between its posterior wall and the pericardium at end-diastole; and tongues of
 * lung between the pericardium and the aorta hid up to a quarter of the aorta's circle in the long axis.
 */
const PHASES = [0, 0.2, 0.35, 0.6, 0.85];

/**
 * Cases whose left atrial cavity or wall still runs into the descending aorta (decision 273, `docs/LIMITATIONS.md`): the
 * enlarged atria, and the borderline ones by a few samples. Making the atrium yield took its volume (the regurgitant
 * case's 98 mL drew 79): a real atrium grows elsewhere, which the ellipsoid cannot.
 */
const KNOWN_LA_IN_AORTA = new Set([
  'hfref-severe-mr',
  'inferior-rwma',
  'aortic-stenosis-moderate',
  'aortic-stenosis-severe',
  'hocm-sam',
  'mvp-primary-mr',
  'af-diastolic',
  'artifact-challenge',
]);
const LA_STRUCTURES = new Set<number>([Structure.LaCavity, Structure.LaWall]);

function models(id: string) {
  return new SimulatorCore(loadCaseById(id), baseInput()).models;
}

/** Heart samples inside the vertebral body or the descending aorta (lumen and wall), over the beat. */
function heartInColumn(id: string): Record<string, number> {
  const { heart, tables, thorax } = models(id);
  const s = makeSample();
  const found: Record<string, number> = {};
  const cs = thorax.columnShiftCm;
  const column = [
    [0, SPINE_Z + cs, SPINE_R, 'vertebral body'],
    [DESC_AORTA_X, DESC_AORTA_Z + cs, DESC_AORTA_R + DESC_AORTA_WALL, 'aorta'],
  ] as const;
  for (const phase of PHASES) {
    const hp = computeHeartPose(heart, cycleStateAt(tables, phase));
    for (let y = -8; y <= 6; y += 0.25)
      for (const [cx, cz, r, name] of column)
        for (let k = 0; k < 24; k++) {
          const a = (k / 24) * 2 * Math.PI;
          for (const f of [0.3, 0.7, 0.97]) {
            const h = torsoToHeart(heart.frame, {
              x: cx + r * f * Math.cos(a),
              y,
              z: cz + r * f * Math.sin(a),
            });
            if (classifyHeart(heart, hp, h.x, h.y, h.z, s)) {
              // The arch now joins this lumen; it is not an intruding cardiac chamber.
              if (name === 'aorta' && s.structure === Structure.AorticArch) continue;
              const atrium = LA_STRUCTURES.has(s.structure) && name === 'aorta';
              const key = atrium
                ? 'atrium in the aorta'
                : `structure ${s.structure} in the ${name}`;
              found[key] = (found[key] ?? 0) + 1;
            }
          }
        }
  }
  return found;
}

function plax(id: string) {
  const { heart, thorax, tables } = models(id);
  const spec = polarSpecFor(DEFAULT_ACQUISITION, 'medium');
  const beam = beamFrameFromPose(
    poseFromControl(thorax, canonicalControl(getViewTarget('plax'), heart, thorax)),
    1,
  );
  const f = allocPolarFrame(spec);
  const r = new ProceduralSliceRenderer();
  const render = (phase: number) =>
    r.render(
      {
        heart,
        heartPose: computeHeartPose(heart, cycleStateAt(tables, phase)),
        thorax,
        physics: {
          frequencyMHz: DEFAULT_ACQUISITION.frequencyMHz,
          harmonics: DEFAULT_ACQUISITION.harmonics,
          clutterLevel: 0,
          windowAttenuation: 0,
          seed: 1,
        },
      },
      beam,
      spec,
      phase,
      f,
    );
  return { spec, beam, f, render, thorax };
}

describe('the heart against the posterior column (decision 273)', () => {
  it('no part of the heart, its veins or its sac lies inside the vertebral body or the descending aorta, but the declared atria', () => {
    const problems: string[] = [];
    for (const { id } of CASE_INPUTS) {
      const found = heartInColumn(id);
      const declared = KNOWN_LA_IN_AORTA.has(id);
      for (const [k, n] of Object.entries(found))
        if (!(declared && k === 'atrium in the aorta'))
          problems.push(`${id}: ${n} samples of ${k}`);
      if (declared && !found['atrium in the aorta'])
        problems.push(`${id}: declared in KNOWN_LA_IN_AORTA, and its atrium is clear of the aorta`);
    }
    expect(problems).toEqual([]);
  });

  it('the pericardium lies on the posterior wall of the left atrium in the long axis, with no layer of fat between', () => {
    const problems: string[] = [];
    for (const { id } of CASE_INPUTS) {
      const { spec, f, render } = plax(id);
      const N = spec.samples,
        dr = spec.depthCm / N;
      for (const phase of [0, 0.35]) {
        render(phase);
        const fats: number[] = [];
        for (let li = 0; li < spec.lines; li++) {
          let last = -1;
          for (let s = 0; s < N; s++) if (f.structure[li * N + s] === Structure.LaCavity) last = s;
          if (last < 0) continue;
          let s = last + 1,
            wall = 0,
            fat = 0;
          while (s < N && f.structure[li * N + s] === Structure.LaWall) {
            wall++;
            s++;
          }
          // the lines through the atrioventricular groove keep its fat
          if (wall === 0) continue;
          while (s < N && f.structure[li * N + s] === Structure.EpicardialFat) {
            fat++;
            s++;
          }
          fats.push(fat * dr);
        }
        fats.sort((a, b) => a - b);
        const median = fats[fats.length >> 1] ?? 0;
        if (median > 0.1)
          problems.push(
            `${id} @${phase}: ${(median * 10).toFixed(1)} mm of fat behind the atrial wall`,
          );
      }
    }
    expect(problems).toEqual([]);
  });

  it('no lung lies in front of the descending aorta in the long axis to hide it', () => {
    const problems: string[] = [];
    for (const { id } of CASE_INPUTS) {
      const { spec, beam, f, render, thorax } = plax(id);
      const N = spec.samples,
        dr = spec.depthCm / N;
      const R = DESC_AORTA_R + DESC_AORTA_WALL,
        cz = DESC_AORTA_Z + thorax.columnShiftCm;
      for (const phase of PHASES) {
        render(phase);
        let inside = 0,
          lung = 0;
        for (let li = 0; li < spec.lines; li++) {
          const th = -spec.sectorRad / 2 + ((li + 0.5) / spec.lines) * spec.sectorRad;
          const ca = Math.cos(th),
            sa = Math.sin(th);
          for (let s = 0; s < N; s++) {
            const r = (s + 0.5) * dr;
            const x = beam.origin.x + r * (ca * beam.forward.x + sa * beam.lateral.x),
              z = beam.origin.z + r * (ca * beam.forward.z + sa * beam.lateral.z);
            if ((x - DESC_AORTA_X) ** 2 + (z - cz) ** 2 > R * R) continue;
            inside++;
            if (f.structure[li * N + s] === Structure.Lung) lung++;
          }
        }
        if (inside > 0 && lung > 0.02 * inside)
          problems.push(
            `${id} @${phase}: ${((100 * lung) / inside).toFixed(0)} % of the aorta drawn as lung`,
          );
      }
    }
    expect(problems).toEqual([]);
  });
});
