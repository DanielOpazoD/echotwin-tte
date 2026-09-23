// @tier fast
import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { buildCaseModels } from '@/simulator/anatomy/caseModels';
import { computeHeartPose } from '@/simulator/anatomy/heartModel';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { buildFlowParams, sampleFlow, type FlowSample } from './flow-primitives/flowField';

/**
 * The turbulence a case declares for each Doppler site reaches the flow it describes (decision 171): the regurgitant jets
 * and the pulmonary veins took fixed values, and the aortic valve the tract's, whatever the case said. Sampled on the
 * axis of each jet, 1 cm along it, at mid-systole (tricuspid and mitral regurgitation).
 */
function dispersionAt(caseId: string, site: string, turbulence: number | undefined): number {
  const c = loadCaseById(caseId);
  const { heart, tables } = buildCaseModels(c, {
    position: 'left-lateral',
    respiration: 'expiration',
    headElevationDeg: 0,
  });
  const p = buildFlowParams(c, heart, tables);
  if (turbulence === undefined) delete p.turbulence[site];
  else p.turbulence[site] = turbulence;
  const tm = tables.timings;
  const phase = (tm.ejectionStartS + 0.5 * (tm.ejectionEndS - tm.ejectionStartS)) / tables.rrS;
  const hp = computeHeartPose(heart, cycleStateAt(tables, phase));
  const fs: FlowSample = { vx: 0, vy: 0, vz: 0, dispersion: 0, present: 0 };
  if (site === 'tr-jet')
    sampleFlow(
      p,
      tables,
      hp,
      phase,
      p.tvCenter.x,
      p.tvCenter.y,
      p.tvCenter.z + hp.tvZ + 0.3 - 1,
      fs,
    );
  else {
    // along the regurgitant jet, which leaves the coaptation toward the atrium tilted by the case's eccentricity
    const along = 1;
    sampleFlow(
      p,
      tables,
      hp,
      phase,
      p.mvCenter.x + Math.sin(p.mrJetDirRad) * along,
      p.mvCenter.y,
      hp.zAnn - 0.1 - Math.cos(p.mrJetDirRad) * along,
      fs,
    );
  }
  expect(fs.present, `${caseId} ${site}: the sample is in the jet`).toBe(1);
  return fs.dispersion;
}

describe('the flow field reads the turbulence each case declares (decision 171)', () => {
  it('in the tricuspid and mitral regurgitant jets', () => {
    expect(dispersionAt('normal-excellent-window', 'tr-jet', 0.2)).toBeCloseTo(0.2, 6);
    expect(dispersionAt('normal-excellent-window', 'tr-jet', 0.6)).toBeCloseTo(0.6, 6);
    expect(dispersionAt('normal-excellent-window', 'tr-jet', undefined)).toBeCloseTo(0.25, 6);
    expect(dispersionAt('mvp-primary-mr', 'mr-jet', 0.4)).toBeCloseTo(0.4, 6);
    expect(dispersionAt('mvp-primary-mr', 'mr-jet', 0.7)).toBeCloseTo(0.7, 6);
  });
});
