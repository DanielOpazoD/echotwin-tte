import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { buildBeatTables, cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { computeHeartPose, createHeartModel, heartAnchors, heartLandmarks } from '@/simulator/anatomy/heartModel';
import { createThoraxModel } from '@/simulator/anatomy/thoraxModel';
import { buildFlowParams, pulmonaryVeinPeaks, sampleFlow } from './flow-primitives/flowField';
import { SimulatorCore } from '@/simulator/core/simulatorCore';
import { baseInput } from '@/simulator/core/simulatorCore.test';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';

function setup(id: string) {
  const c = loadCaseById(id);
  const thorax = createThoraxModel(c.bodyHabitus, c.acousticWindow, { position: 'left-lateral', respiration: 'expiration', headElevationDeg: 0 });
  const heart = createHeartModel(c.anatomy, c.physiology, thorax.heartOffset, c.seed);
  heartLandmarks(heart);
  const tables = buildBeatTables(60 / c.rhythm.heartRateBpm, c.physiology, c.rhythm, c.hemodynamics);
  computeHeartPose(heart, cycleStateAt(tables, 0));
  return { c, heart, thorax, tables, flow: buildFlowParams(c, heart, tables) };
}

describe('pulmonary venous flow and colour M-mode', () => {
  it('normal: S ≥ D, Ar present; MR blunts S; AF has no Ar', () => {
    const n = pulmonaryVeinPeaks(loadCaseById('normal-excellent-window'));
    expect(n.sMps).toBeGreaterThanOrEqual(n.dMps * 0.9);
    expect(n.arMps).toBeGreaterThan(0.15);
    const mr = pulmonaryVeinPeaks(loadCaseById('mvp-primary-mr'));
    expect(mr.sMps).toBeLessThan(mr.dMps * 0.5);
    const af = pulmonaryVeinPeaks(loadCaseById('af-diastolic'));
    expect(af.arMps).toBe(0);
  });
  it('flow inside a pulmonary vein ostium points into the LA in systole (S) and reverses during atrial contraction (Ar)', () => {
    const { heart, tables, flow } = setup('normal-excellent-window');
    const A = heartAnchors(heart);
    const la = A.laCenter,
      lr = A.laR;
    const t = tables.timings;
    const sysPhase = (t.ejectionStartS + 0.5 * (t.ejectionEndS - t.ejectionStartS)) / tables.rrS;
    const hpS = computeHeartPose(heart, cycleStateAt(tables, sysPhase));
    const czL = (la.z - lr.z + hpS.zAnn + 0.25) / 2;
    // superior right vein stub, 0.5 cm outside the ostium
    const ox = la.x - lr.x * 0.6,
      oy = la.y - lr.y * 0.8,
      oz = czL - 0.7;
    const out = { vx: 0, vy: 0, vz: 0, dispersion: 0, present: 0 };
    sampleFlow(flow, tables, hpS, sysPhase, ox - 0.25, oy - 0.45, oz - 0.15, out);
    expect(out.present).toBe(1);
    const vS = Math.hypot(out.vx, out.vy, out.vz);
    expect(vS).toBeGreaterThan(0.25);
    expect(out.vy).toBeGreaterThan(0); // toward +y = toward the LA centre (the veins enter from posterior)
    const aPhase = (t.aStartS + 0.5 * (t.aEndS - t.aStartS)) / tables.rrS;
    const hpA = computeHeartPose(heart, cycleStateAt(tables, aPhase));
    const czA = (la.z - lr.z + hpA.zAnn + 0.25) / 2;
    sampleFlow(flow, tables, hpA, aPhase, ox - 0.25, oy - 0.45, czA - 0.7 - 0.15, out);
    expect(out.present).toBe(1);
    expect(out.vy).toBeLessThan(0); // reversal
  });
  it('colour M-mode strip carries aliased velocities along the cursor through the mitral inflow', () => {
    const { c, heart, thorax } = setup('normal-excellent-window');
    const a4c = canonicalControl(getViewTarget('a4c'), heart, thorax);
    const core = new SimulatorCore(c, baseInput({ probe: a4c, modality: 'cmm', quality: 'low', cursorThetaRad: 0.05 }));
    let out = null;
    for (let i = 0; i < 40; i++) out = core.step(0.03) ?? out;
    expect(out?.strip.kind).toBe('m-mode');
    // the composite strip must contain coloured pixels (red/blue dominant) in the lower half of the display
    const W = out!.width,
      H = out!.height;
    const rgba = new Uint8ClampedArray(out!.rgba);
    let coloured = 0;
    for (let y = out!.strip.y; y < H; y += 2)
      for (let x = 0; x < W; x += 2) {
        const o = (y * W + x) * 4;
        const r = rgba[o]!,
          g = rgba[o + 1]!,
          b = rgba[o + 2]!;
        if (Math.abs(r - b) > 60 && Math.max(r, b) > g + 40) coloured++;
      }
    expect(coloured).toBeGreaterThan(50);
  });
  it('artifact overrides change the console output live', () => {
    const { c, heart, thorax } = setup('normal-excellent-window');
    const plax = canonicalControl(getViewTarget('plax'), heart, thorax);
    // two identical cores stepped in lockstep (same seed, same phases): only the overrides differ
    const coreA = new SimulatorCore(c, baseInput({ probe: plax, quality: 'low' }));
    const coreB = new SimulatorCore(c, baseInput({ probe: plax, quality: 'low', artifactOverrides: { sideLobe: 1, mirror: 1, beamWidth: 1, clutter: 1 } }));
    let a = null,
      b = null;
    for (let i = 0; i < 3; i++) {
      a = coreA.step(0.05) ?? a;
      b = coreB.step(0.05) ?? b;
    }
    // Measured inside the sector and in grey levels, not as a ratio of the whole-frame mean: a ratio depends on how
    // bright the console makes the rest of the image (decision 70 raised blood from grey ~25 to ~60 and the ratio
    // fell from 1.12 to 1.04 while the artifacts changed the same share of pixels, about a fifth by 8 levels or more).
    const pa = new Uint8ClampedArray(a!.rgba),
      pb = new Uint8ClampedArray(b!.rgba);
    let sector = 0,
      brighter = 0,
      changed = 0;
    for (let i = 0; i < pa.length; i += 4) {
      if (pa[i]! === 0 && pb[i]! === 0) continue;
      sector++;
      brighter += pb[i]! - pa[i]!;
      if (Math.abs(pb[i]! - pa[i]!) >= 8) changed++;
    }
    expect(a!.phase).toBeCloseTo(b!.phase, 6);
    expect(brighter / sector).toBeGreaterThan(1);
    expect(changed / sector).toBeGreaterThan(0.1);
  });
});
