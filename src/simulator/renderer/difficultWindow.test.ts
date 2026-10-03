// @tier slow
import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { buildCaseModels, REST_PATIENT } from '@/simulator/anatomy/caseModels';
import { computeHeartPose } from '@/simulator/anatomy/heartModel';
import { Structure } from '@/simulator/anatomy/tissue';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import { applyConsole, createConsoleState } from './postprocess/consolePipeline';
import { ProceduralSliceRenderer } from './procedural/sliceRenderer';
import { caseArtifactLevels, consoleArtifacts, scenePhysicsFor } from './scenePhysics';
import { allocPolarFrame, DEFAULT_ACQUISITION, polarSpecFor, type Scene } from './types';

/**
 * A difficult window is clutter, not attenuation (decision 261). Through a thick, heterogeneous chest wall the
 * fundamental image fills with reverberation haze and harmonic imaging, which the wall's clutter barely reaches, clears
 * it: that is what tissue harmonics are for. The window used to add up to 2.5× the attenuation of the wall's fat, muscle
 * and skin, so both images sank into the receiver's noise and the harmonic one, attenuated more, came out worse (PLAX
 * contrast 5 against 13 grey levels).
 */
const LV_WALL = new Set<number>([
  Structure.LvWallSeptal,
  Structure.LvWallLateral,
  Structure.LvWallAnterior,
  Structure.LvWallInferior,
  Structure.LvApex,
]);

/** Median grey of the LV wall minus that of its cavity, over three scatterer realizations. */
function contrast(id: string, view: string, harmonics: boolean): number {
  const c = loadCaseById(id);
  const { thorax, heart, tables } = buildCaseModels(c, REST_PATIENT);
  const settings = { ...DEFAULT_ACQUISITION, harmonics };
  const spec = polarSpecFor(settings, 'medium');
  const beam = beamFrameFromPose(
    poseFromControl(thorax, canonicalControl(getViewTarget(view), heart, thorax)),
    1,
  );
  const wall: number[] = [],
    cavity: number[] = [];
  for (let k = 0; k < 3; k++) {
    const scene: Scene = {
      heart,
      heartPose: computeHeartPose(heart, cycleStateAt(tables, 0)),
      thorax,
      physics: scenePhysicsFor(c, settings, { seed: c.seed + k }),
    };
    const f = allocPolarFrame(spec);
    new ProceduralSliceRenderer().render(scene, beam, spec, 0, f);
    const d = new Uint8ClampedArray(spec.lines * spec.samples);
    applyConsole(
      f,
      settings,
      createConsoleState(c.seed + k),
      d,
      consoleArtifacts(caseArtifactLevels(c)),
    );
    for (let i = 0; i < d.length; i++)
      if (LV_WALL.has(f.structure[i]!)) wall.push(d[i]!);
      else if (f.structure[i] === Structure.LvCavity) cavity.push(d[i]!);
  }
  const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]!;
  return median(wall) - median(cavity);
}

describe('a difficult window is clutter that harmonics clear (decision 261)', () => {
  it('in the difficult window the harmonic image has at least the fundamental contrast, in the A4C and the PLAX', () => {
    const out: string[] = [];
    for (const view of ['a4c', 'plax']) {
      const fundamental = contrast('normal-difficult-window', view, false);
      const harmonic = contrast('normal-difficult-window', view, true);
      if (!(harmonic >= fundamental))
        out.push(`${view}: harmonic ${harmonic}, fundamental ${fundamental}`);
    }
    expect(out).toEqual([]);
  });
});
