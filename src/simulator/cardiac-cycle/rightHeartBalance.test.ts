// @tier fast
import { describe, expect, it } from 'vitest';
import { CASE_INPUTS, loadCaseById } from '@/cases';
import { buildCaseModels, REST_PATIENT } from '@/simulator/anatomy/caseModels';
import { buildBeatTables, cycleStateAt, sampleTable } from './cycleModel';
import { computeHeartPose } from '@/simulator/anatomy/heartModel';
import { buildFlowParams, sampleFlow } from '@/simulator/doppler/flow-primitives/flowField';
import { computeGroundTruth } from '@/simulator/hemodynamics/groundTruth';

const integral = (a: Float32Array, dt: number) => a.reduce((sum, value) => sum + value * dt, 0);

describe('right-heart flow balance', () => {
  it('closes every nominal case, including severe MR and quantified TR, without a closing correction', () => {
    for (const { id } of CASE_INPUTS) {
      const c = loadCaseById(id);
      const { tables } = buildCaseModels(c, REST_PATIENT);
      const dt = tables.rrS / tables.n;
      // Independent integration of the original pressure-derived TR waveform.
      const vmax = c.hemodynamics.trPresent
        ? Math.sqrt(Math.max(0, (c.hemodynamics.paspMmHg - c.hemodynamics.rapMmHg) / 4))
        : 0;
      let trMl = 0;
      for (let i = 0; i < tables.n; i++) {
        const t = (i + 0.5) * dt;
        const u =
          (t - tables.timings.ejectionStartS + 0.02) /
          (tables.timings.ejectionEndS - tables.timings.ejectionStartS + 0.04);
        if (u > 0 && u < 1)
          trMl +=
            (c.hemodynamics.regurgitation.tr?.eroaCm2 ?? 0) *
            vmax *
            Math.pow(Math.sin(Math.PI * u), 0.8) *
            100 *
            dt;
      }
      expect(
        Math.abs(
          integral(tables.tricuspidFlowMlps, dt) - integral(tables.pulmonaryFlowMlps, dt) - trMl,
        ),
        id,
      ).toBeLessThan(0.001);
    }
  });

  it('the relative volume derivative is the net instantaneous flow, with no artificial closing drift', () => {
    for (const { id } of CASE_INPUTS) {
      const { tables } = buildCaseModels(loadCaseById(id), REST_PATIENT);
      const dt = tables.rrS / tables.n;
      expect(Math.abs(tables.rvEndVolumeChangeMl), id).toBeLessThan(0.001);
      let previous = 0;
      for (let i = 0; i < tables.n; i++) {
        const rate = (tables.rvVolumeChangeMl[i]! - previous) / dt;
        expect(
          Math.abs(
            rate -
              (tables.tricuspidFlowMlps[i]! - tables.pulmonaryFlowMlps[i]! - tables.trFlowMlps[i]!),
          ),
        ).toBeLessThan(0.01);
        previous = tables.rvVolumeChangeMl[i]!;
      }
    }
  });

  it('TR field, time integral and reported volume use the same acquired waveform', () => {
    const c = loadCaseById('pulmonary-hypertension-rv');
    const { heart, thorax, tables } = buildCaseModels(c, REST_PATIENT);
    const flow = buildFlowParams(c, heart, tables, thorax);
    for (const site of [
      'mitral-inflow',
      'tricuspid-inflow',
      'rvot',
      'pulmonary-vein',
      'lvot',
      'mr-jet',
      'ar-jet',
    ])
      flow.enabled[site] = false;
    const out = { vx: 0, vy: 0, vz: 0, dispersion: 0, present: 0 };
    for (const phase of [0.15, 0.25, 0.35, 0.7]) {
      const hp = computeHeartPose(heart, cycleStateAt(tables, phase));
      sampleFlow(
        flow,
        tables,
        hp,
        phase,
        flow.tvCenter.x,
        flow.tvCenter.y,
        flow.tvCenter.z + hp.tvZ + 0.2,
        out,
      );
      expect(-out.vz).toBeCloseTo(sampleTable(tables.trVelocityMps, phase), 5);
    }
    const tr = computeGroundTruth(c, tables).regurgitation.tr!;
    expect(tr.regurgitantVolumeMl).toBeCloseTo(tr.eroaCm2 * tr.vtiCm!, 5);
    expect(tr.regurgitantVolumeMl).toBeGreaterThan(20);
    expect(tr.regurgitantVolumeMl).toBeLessThan(30);
  });

  it('chained beats keep their own tricuspid area and preserve respiratory filling changes', () => {
    const c = loadCaseById('hfref-severe-mr');
    const { tables: nominal } = buildCaseModels(c, REST_PATIENT);
    const make = (factor: number) =>
      buildBeatTables(nominal.rrS, c.physiology, c.rhythm, c.hemodynamics, {
        chain: {
          ejectMl: nominal.strokeVolumeMl,
          rvEjectMl: nominal.tricuspidFillMl - nominal.regurgitation.trVolumeMl,
          mvAreaCm2: nominal.mvEffectiveAreaCm2,
          tvAreaCm2: nominal.tvEffectiveAreaCm2,
          previousRrS: nominal.rrS,
          startLongitudinal: nominal.endLongitudinal,
          startRvLongitudinal: nominal.endRvLongitudinal,
          tricuspidEFactor: factor,
        },
      });
    const resting = make(1),
      inspiration = make(1.2);
    expect(resting.tvEffectiveAreaCm2).toBe(nominal.tvEffectiveAreaCm2);
    expect(resting.tricuspidFillMl).toBeCloseTo(nominal.pulmonaryStrokeVolumeMl, 3);
    expect(inspiration.tricuspidFillMl).toBeGreaterThan(resting.tricuspidFillMl);
    expect(inspiration.rvEndVolumeChangeMl).toBeGreaterThan(0);
  });
});
