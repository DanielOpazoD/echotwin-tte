import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { validateCase } from '@/cases/schema';
import type { CaseDefinition } from '@/cases/schema';
import { buildBeatTables, cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { computeHeartPose, createHeartModel, heartLandmarks, ROOT_EXCURSION } from '@/simulator/anatomy/heartModel';
import { createThoraxModel } from '@/simulator/anatomy/thoraxModel';
import { buildFlowParams, sampleFlow } from './flow-primitives/flowField';
import { computeGroundTruth } from '@/simulator/hemodynamics/groundTruth';

/** Regurgitant jets, PISA and dynamic LVOT obstruction (spec 63): one flow source for tables, Doppler and truth. */
function variant(over: (c: CaseDefinition) => CaseDefinition): CaseDefinition {
  const base = loadCaseById('normal-excellent-window');
  const v = validateCase(over(structuredClone(base)));
  if (!v.ok) throw new Error(v.errors.join('; '));
  return v.case!;
}
function setup(c: CaseDefinition) {
  const thorax = createThoraxModel(c.bodyHabitus, c.acousticWindow, { position: 'left-lateral', respiration: 'expiration', headElevationDeg: 0 });
  const heart = createHeartModel(c.anatomy, c.physiology, thorax.heartOffset, c.seed);
  heartLandmarks(heart);
  const tables = buildBeatTables(60 / c.rhythm.heartRateBpm, c.physiology, c.rhythm, c.hemodynamics);
  computeHeartPose(heart, cycleStateAt(tables, 0));
  return { heart, tables, flow: buildFlowParams(c, heart, tables) };
}

describe('regurgitant jets and obstruction', () => {
  it('MR: forward stroke volume = total − regurgitant volume; jet ≈ 5 m/s into the LA in systole with PISA on the LV side', () => {
    const c = variant((x) => ({ ...x, hemodynamics: { ...x.hemodynamics, regurgitation: { mr: { eroaCm2: 0.3, jetDirectionDeg: 0 } } } }));
    const { heart, tables, flow } = setup(c);
    const gt = computeGroundTruth(c, tables);
    expect(gt.regurgitation.mr).not.toBeNull();
    const mr = gt.regurgitation.mr!;
    expect(mr.vmaxMps).toBeGreaterThan(4.5);
    expect(mr.vmaxMps).toBeLessThan(6);
    expect(mr.regurgitantVolumeMl).toBeGreaterThan(25);
    expect(mr.regurgitantVolumeMl).toBeLessThan(70);
    // total SV (EDV−ESV) is conserved; the aortic forward SV is reduced by the regurgitant volume
    expect(gt.lv.strokeVolumeMl).toBeCloseTo(c.physiology.edvMl - c.physiology.esvMl, 0);
    expect(gt.lvot.strokeVolumeMl).toBeCloseTo(gt.lv.strokeVolumeMl - mr.regurgitantVolumeMl, 0);
    // jet in the LA at mid-systole
    const t = tables.timings;
    const sysPhase = (t.ejectionStartS + 0.5 * (t.ejectionEndS - t.ejectionStartS)) / tables.rrS;
    const hp = computeHeartPose(heart, cycleStateAt(tables, sysPhase));
    const out = { vx: 0, vy: 0, vz: 0, dispersion: 0, present: 0 };
    sampleFlow(flow, tables, hp, sysPhase, flow.mvCenter.x, flow.mvCenter.y, hp.zAnn - 0.9, out);
    expect(out.present).toBe(1);
    expect(out.vz).toBeLessThan(-3.5); // toward the LA (−z), high velocity
    // PISA on the LV side: converging toward the orifice, slower
    sampleFlow(flow, tables, hp, sysPhase, flow.mvCenter.x, flow.mvCenter.y, hp.zAnn + 0.6, out);
    expect(out.present).toBe(1);
    expect(out.vz).toBeLessThan(-0.2);
    expect(out.vz).toBeGreaterThan(-3);
    // nothing in diastole at the same LA point
    const diaPhase = (t.mitralOpenS + t.eAccelS) / tables.rrS;
    const hp2 = computeHeartPose(heart, cycleStateAt(tables, diaPhase));
    sampleFlow(flow, tables, hp2, diaPhase, flow.mvCenter.x, flow.mvCenter.y, hp2.zAnn - 0.9, out);
    expect(out.vz).toBeGreaterThan(-0.5);
  });
  it('AR: diastolic jet into the LVOT decaying with the pressure half-time; mitral inflow reduced by the AR volume', () => {
    const c = variant((x) => ({ ...x, hemodynamics: { ...x.hemodynamics, regurgitation: { ar: { eroaCm2: 0.25, phtMs: 300 } } } }));
    const { heart, tables, flow } = setup(c);
    const gt = computeGroundTruth(c, tables);
    const ar = gt.regurgitation.ar!;
    expect(ar.vmaxMps).toBeGreaterThan(3.3);
    expect(ar.vmaxMps).toBeLessThan(4.5);
    expect(ar.regurgitantVolumeMl).toBeGreaterThan(20);
    expect(ar.phtMs).toBe(300);
    let mitralIn = 0;
    for (let i = 0; i < tables.n; i++) mitralIn += (tables.mitralFlowMlps[i] ?? 0) * (tables.rrS / tables.n);
    expect(mitralIn).toBeCloseTo(gt.lv.strokeVolumeMl - ar.regurgitantVolumeMl, 0);
    const t = tables.timings;
    const early = (t.ejectionEndS + 0.06) / tables.rrS;
    const late = (t.ejectionEndS + 0.45) / tables.rrS;
    const out = { vx: 0, vy: 0, vz: 0, dispersion: 0, present: 0 };
    const ax = flow.avAxis;
    const pt = (hp: ReturnType<typeof computeHeartPose>) => ({ x: flow.avCenter.x - ax.x * 0.8, y: flow.avCenter.y - ax.y * 0.8, z: flow.avCenter.z + hp.zAnn * ROOT_EXCURSION - ax.z * 0.8 });
    const hpE = computeHeartPose(heart, cycleStateAt(tables, early));
    const pE = pt(hpE);
    sampleFlow(flow, tables, hpE, early, pE.x, pE.y, pE.z, out);
    const vEarly = Math.hypot(out.vx, out.vy, out.vz);
    expect(out.present).toBe(1);
    expect(vEarly).toBeGreaterThan(2.5);
    expect(out.vz).toBeGreaterThan(0); // into the LV (+z component along −axis)
    const hpL = computeHeartPose(heart, cycleStateAt(tables, late));
    const pL = pt(hpL);
    sampleFlow(flow, tables, hpL, late, pL.x, pL.y, pL.z, out);
    expect(Math.hypot(out.vx, out.vy, out.vz)).toBeLessThan(vEarly * 0.8);
  });
  it('HOCM: dynamic LVOT obstruction peaks late in ejection and reaches the case gradient', () => {
    const c = variant((x) => ({ ...x, anatomy: { ...x.anatomy, mitral: { ...x.anatomy.mitral, samSeverity: 0.7 } }, hemodynamics: { ...x.hemodynamics, lvotPeakGradientMmHg: 64 } }));
    const { heart, tables, flow } = setup(c);
    const gt = computeGroundTruth(c, tables);
    expect(gt.lvot.dynamicObstruction).toBe(true);
    expect(gt.lvot.peakGradientMmHg).toBeGreaterThan(55);
    expect(gt.lvot.peakGradientMmHg).toBeLessThan(75);
    expect(flow.lvotObstruction?.fMax).toBeGreaterThan(0.4);
    // velocity at the septal contact point over the ejection: the peak occurs after mid-ejection (dagger shape)
    const t = tables.timings;
    const out = { vx: 0, vy: 0, vz: 0, dispersion: 0, present: 0 };
    const ax = flow.avAxis;
    let best = 0,
      bestU = 0;
    for (let k = 1; k < 40; k++) {
      const u = k / 40;
      const phase = (t.ejectionStartS + u * (t.ejectionEndS - t.ejectionStartS)) / tables.rrS;
      const hp = computeHeartPose(heart, cycleStateAt(tables, phase));
      const cz = flow.avCenter.z + hp.zAnn * ROOT_EXCURSION;
      sampleFlow(flow, tables, hp, phase, flow.avCenter.x - ax.x * 0.6, flow.avCenter.y - ax.y * 0.6, cz - ax.z * 0.6, out);
      const v = Math.hypot(out.vx, out.vy, out.vz);
      if (v > best) {
        best = v;
        bestU = u;
      }
    }
    expect(best).toBeGreaterThan(3.2);
    expect(bestU).toBeGreaterThan(0.55);
    // the normal case peaks early (no obstruction)
    const n = setup(loadCaseById('normal-excellent-window'));
    let bestN = 0,
      bestUN = 0;
    for (let k = 1; k < 40; k++) {
      const u = k / 40;
      const phase = (t.ejectionStartS + u * (t.ejectionEndS - t.ejectionStartS)) / n.tables.rrS;
      const hp = computeHeartPose(n.heart, cycleStateAt(n.tables, phase));
      const cz = n.flow.avCenter.z + hp.zAnn * ROOT_EXCURSION;
      sampleFlow(n.flow, n.tables, hp, phase, n.flow.avCenter.x - ax.x * 0.6, n.flow.avCenter.y - ax.y * 0.6, cz - ax.z * 0.6, out);
      const v = Math.hypot(out.vx, out.vy, out.vz);
      if (v > bestN) {
        bestN = v;
        bestUN = u;
      }
    }
    expect(bestUN).toBeLessThan(0.5);
    expect(bestN).toBeLessThan(1.6);
  });
});
