// @tier slow
import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { SimulatorCore } from '@/simulator/core/simulatorCore';
import { baseInput } from '@/simulator/core/baseInput';
import { computeHeartPose } from '@/simulator/anatomy/heartModel';
import { Structure } from '@/simulator/anatomy/tissue';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import { applyConsole, createConsoleState } from './postprocess/consolePipeline';
import { ProceduralSliceRenderer } from './procedural/sliceRenderer';
import { caseArtifactLevels, consoleArtifacts, scenePhysicsFor } from './scenePhysics';
import { allocPolarFrame, CALIBRATED_TIER, DEFAULT_ACQUISITION, polarSpecFor } from './types';

/**
 * Two orderings of brightness an echocardiographer reads in every image, held as found when the limitations that said
 * otherwise were measured again (decision 316): the interatrial septum stands out of the blood of both atria in the
 * four-chamber view (it read 71-73 of grey against 71-77 in the atria when it was declared indistinguishable), and the
 * pericardium is brighter than the chest wall in front of it (168-170 against 222-223 in the four-chamber view when it
 * was declared the opposite). Median grey of each structure on the image the app shows, end-diastole, normal case.
 */
const settings = DEFAULT_ACQUISITION;
const spec = polarSpecFor(settings, CALIBRATED_TIER);

function medianGrey(id: string, view: string, phase: number, structures: Structure[]): number[] {
  const c = loadCaseById(id);
  const { heart, thorax, tables } = new SimulatorCore(c, baseInput()).models;
  const beam = beamFrameFromPose(
    poseFromControl(thorax, canonicalControl(getViewTarget(view), heart, thorax)),
    1,
  );
  const f = allocPolarFrame(spec);
  new ProceduralSliceRenderer().render(
    {
      heart,
      heartPose: computeHeartPose(heart, cycleStateAt(tables, phase)),
      thorax,
      physics: scenePhysicsFor(c, settings, { seed: c.seed }),
    },
    beam,
    spec,
    phase,
    f,
  );
  const d = new Uint8ClampedArray(spec.lines * spec.samples);
  applyConsole(f, settings, createConsoleState(c.seed), d, consoleArtifacts(caseArtifactLevels(c)));
  return structures.map((st) => {
    const xs: number[] = [];
    for (let i = 0; i < d.length; i++) if (f.structure[i] === st) xs.push(d[i]!);
    xs.sort((a, b) => a - b);
    return xs.length > 50 ? xs[xs.length >> 1]! : NaN;
  });
}

describe('brightness orderings of the clinical image (decision 316)', () => {
  it('the interatrial septum is brighter than the blood of both atria in the four-chamber view', () => {
    const [ias, la, ra] = medianGrey('normal-excellent-window', 'a4c', 0, [
      Structure.InteratrialSeptum,
      Structure.LaCavity,
      Structure.RaCavity,
    ]);
    // a fifth of the grey scale above the brighter atrium: a line one can follow, not a shade
    expect(ias! - Math.max(la!, ra!), `septum ${ias}, atria ${la} and ${ra}`).toBeGreaterThan(25);
  });

  it('the pericardium is brighter than the chest wall in front of it in the four-chamber and long-axis views', () => {
    const problems: string[] = [];
    for (const view of ['a4c', 'plax']) {
      const [pericardium, wall] = medianGrey('normal-excellent-window', view, 0, [
        Structure.Pericardium,
        Structure.ChestWall,
      ]);
      if (!(pericardium! > wall! + 15))
        problems.push(`${view}: pericardium ${pericardium} against chest wall ${wall}`);
    }
    expect(problems).toEqual([]);
  });
});
