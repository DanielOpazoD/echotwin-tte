// @tier slow
import { describe, expect, it } from 'vitest';
import { SimulatorCore } from '@/simulator/core/simulatorCore';
import { baseInput } from '@/simulator/core/baseInput';
import { CASE_INPUTS, loadCaseById } from '@/cases';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import { Structure } from '@/simulator/anatomy/tissue';
import { computeGroundTruth } from '@/simulator/hemodynamics/groundTruth';
import { getMeasurementSpec } from './protocol';
import { simpsonBiplaneVolume } from '@/clinical/formulas';
import { cutBySectorDepth } from './simpson';
import { polarMaskDiscs } from './maskDiscs.testkit';

/**
 * End-systolic A4C/A2C masks are measured independently of the model with 20 discs.
 * The cell-boundary oracle is validated on analytic ellipsoids (decision 291).
 * All twelve cases retain the protocol's original 18% tolerance at 20 cm.
 * A dilated atrium reaches the default 16 cm sector boundary: the technique
 * engine must identify that truncation rather than accepting its smaller volume.
 */
function atrium(caseId: string, view: string, depthCm: number) {
  const c = loadCaseById(caseId);
  const setup = new SimulatorCore(c, baseInput());
  const probe = canonicalControl(getViewTarget(view), setup.models.heart, setup.models.thorax);
  const target = setup.phaseMarks().mitralOpen - 0.02;
  setup.dispose();
  const b = baseInput({ probe, quality: 'medium' });
  const core = new SimulatorCore(c, { ...b, settings: { ...b.settings, depthCm } });
  let out = core.step(1 / 30)!;
  // frames come at the cadence: accept the one within 0.6 of a frame's phase step of the target
  const tol = 0.6 / out.cadenceHz / out.rrS;
  for (let n = 0; n < 4000 && Math.abs(out.phase - target) > tol; n++)
    out = core.step(1 / 240) ?? out;
  expect(Math.abs(out.phase - target), `${caseId} ${view} phase`).toBeLessThanOrEqual(tol);
  core.dispose();
  return {
    profile: polarMaskDiscs(out.structure, out.polar, Structure.LaCavity),
    cut: cutBySectorDepth(out, [Structure.LaCavity]),
  };
}

function biplane(caseId: string, depthCm: number) {
  const a4c = atrium(caseId, 'a4c', depthCm),
    a2c = atrium(caseId, 'a2c', depthCm);
  const p4 = a4c.profile,
    p2 = a2c.profile;
  return {
    volumeMl: simpsonBiplaneVolume(
      p4.diametersCm,
      p2.diametersCm,
      Math.max(p4.longAxisCm, p2.longAxisCm),
    ),
    cut: a4c.cut || a2c.cut,
  };
}

describe('the LA volume of the images (decision 180)', () => {
  const tolerance = getMeasurementSpec('la-volume')!.tolerancePct / 100;

  it('is within the scoring tolerance of every case, at a depth that holds the atrium', () => {
    const off: string[] = [];
    for (const input of CASE_INPUTS) {
      const declared = computeGroundTruth(loadCaseById(input.id)).la.volumeMl;
      const b = biplane(input.id, 20);
      if (b.cut) off.push(`${input.id}: the atrium reaches the bottom of a 20 cm sector`);
      if (Math.abs(b.volumeMl / declared - 1) > tolerance)
        off.push(`${input.id}: ${b.volumeMl.toFixed(0)} mL against ${declared.toFixed(0)}`);
    }
    expect(off).toEqual([]);
  });

  it('flags a dilated atrium the default depth cuts, which loses a sixth of its volume', () => {
    const at16 = biplane('hfref-severe-mr', 16),
      at20 = biplane('hfref-severe-mr', 20);
    expect(at16.cut).toBe(true);
    expect(at20.cut).toBe(false);
    expect(at16.volumeMl / at20.volumeMl).toBeLessThan(0.9);
    expect(biplane('normal-excellent-window', 16).cut).toBe(false);
  });
});
