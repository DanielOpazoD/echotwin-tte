// @tier slow
import { describe, expect, it } from 'vitest';
import { CASE_INPUTS, loadCaseById } from '@/cases';
import { SimulatorCore } from '@/simulator/core/simulatorCore';
import { baseInput } from '@/simulator/core/baseInput';
import { computeHeartPose } from '@/simulator/anatomy/heartModel';
import { Structure, Tissue } from '@/simulator/anatomy/tissue';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import { ProceduralSliceRenderer } from '@/simulator/renderer/procedural/sliceRenderer';
import { allocPolarFrame, DEFAULT_ACQUISITION, polarSpecFor } from '@/simulator/renderer/types';
import { classifyThorax, DESC_AORTA_X, DESC_AORTA_Z, descAortaScale } from './thoraxModel';
import { makeSample } from './tissue';

/**
 * The descending aorta pulses (decision 272). Its lumen area grows in systole by an area strain of 31 ± 12 % in the
 * thirties and 13–14 % after sixty (MRI, Redheuil et al., Hypertension 2010;55:319-326); the model drew it as a still
 * circle, the same in every frame of the long axis.
 */
const STRAIN_BY_DECADE: readonly [number, number, number][] = [
  // [first age of the decade, mean, SD]
  [20, 0.33, 0.08],
  [30, 0.31, 0.12],
  [40, 0.19, 0.09],
  [50, 0.18, 0.09],
  [60, 0.13, 0.05],
  [70, 0.14, 0.07],
];

const PHASES = 32;

/** Lumen area (cm²) of the descending aorta in a transverse section at the level of the left atrium, over the beat. */
function lumenAreas(id: string): { areas: number[]; ejection: [number, number]; rr: number } {
  const { thorax, tables } = new SimulatorCore(loadCaseById(id), baseInput()).models;
  const q = makeSample();
  const step = 0.05;
  const areas: number[] = [];
  for (let k = 0; k < PHASES; k++) {
    const st = cycleStateAt(tables, k / PHASES);
    const da = descAortaScale(thorax, st.aorticPressure);
    let n = 0;
    for (let x = DESC_AORTA_X - 2; x <= DESC_AORTA_X + 2; x += step)
      for (let z = DESC_AORTA_Z - 2; z <= DESC_AORTA_Z + 2; z += step)
        if (
          classifyThorax(thorax, x, -3, z, q, 5, da) &&
          q.structure === Structure.DescendingAorta &&
          q.tissue === Tissue.Blood
        )
          n++;
    areas.push(n * step * step);
  }
  return {
    areas,
    ejection: [tables.timings.ejectionStartS, tables.timings.ejectionEndS],
    rr: tables.rrS,
  };
}

/**
 * Depth (cm) of the descending aortic lumen along the beam that crosses it widest, in the long axis of the normal case,
 * over the beat: the diameter an echocardiographer would caliper. Its pixel count is not used because the pericardium
 * behind the atrium covers a sliver of its edge in some frames.
 */
function plaxLumen(): number[] {
  const { heart, thorax, tables } = new SimulatorCore(
    loadCaseById('normal-excellent-window'),
    baseInput(),
  ).models;
  const spec = polarSpecFor(DEFAULT_ACQUISITION, 'medium');
  const beam = beamFrameFromPose(
    poseFromControl(thorax, canonicalControl(getViewTarget('plax'), heart, thorax)),
    1,
  );
  const f = allocPolarFrame(spec);
  const r = new ProceduralSliceRenderer();
  const out: number[] = [];
  const N = spec.samples;
  for (let k = 0; k < 16; k++) {
    const phase = k / 16;
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
    let widest = 0;
    for (let li = 0; li < spec.lines; li++) {
      let run = 0;
      for (let s = 0; s < N; s++) {
        const i = li * N + s;
        if (f.structure[i] === Structure.DescendingAorta && f.tissue[i] === Tissue.Blood) run++;
      }
      widest = Math.max(widest, run);
    }
    out.push((widest * spec.depthCm) / N);
  }
  return out;
}

describe('the descending aorta pulses with the arterial pressure (decision 272)', () => {
  it('its lumen area grows in systole by the area strain published for the patient’s age, peaking in ejection', () => {
    const problems: string[] = [];
    for (const { id } of CASE_INPUTS) {
      const age = loadCaseById(id).demographics.ageYears;
      const [, mean, sd] =
        [...STRAIN_BY_DECADE].reverse().find(([a]) => age >= a) ?? STRAIN_BY_DECADE[0]!;
      const { areas, ejection, rr } = lumenAreas(id);
      const strain = Math.max(...areas) / Math.min(...areas) - 1;
      if (strain < mean - sd || strain > mean + sd)
        problems.push(
          `${id} (${age} y): area strain ${(strain * 100).toFixed(1)} %, published ${mean * 100} ± ${sd * 100} %`,
        );
      // the peak arrives during ejection, after the pulse has crossed the arch
      const tPeak = (areas.indexOf(Math.max(...areas)) / PHASES) * rr;
      if (tPeak < ejection[0] || tPeak > ejection[1])
        problems.push(
          `${id}: lumen widest at ${tPeak.toFixed(3)} s, ejection ${ejection[0].toFixed(3)}–${ejection[1].toFixed(3)} s`,
        );
    }
    expect(problems).toEqual([]);
  });

  it('the long axis shows it pulse', () => {
    const lumen = plaxLumen();
    expect(Math.min(...lumen)).toBeGreaterThan(1.5);
    // in a 32-year-old the diameter grows at least √(1 + 0.31 − 0.12) − 1 ≈ 9 %, the lower edge of the published range
    expect(Math.max(...lumen) / Math.min(...lumen)).toBeGreaterThan(Math.sqrt(1.19));
  });
});
