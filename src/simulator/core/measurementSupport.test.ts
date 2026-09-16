// @tier slow
import { describe, expect, it } from 'vitest';
import { SimulatorCore } from './simulatorCore';
import { baseInput } from './baseInput';
import { loadCaseById } from '@/cases';
import { createHeartModel, heartLandmarks, heartToTorso } from '@/simulator/anatomy/heartModel';
import { createThoraxModel } from '@/simulator/anatomy/thoraxModel';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import { dot, sub } from '@/core/vec3';
import { DEFAULT_SPECTRAL } from '@/simulator/doppler/spectral/spectrum';
import { Structure } from '@/simulator/anatomy/tissue';

/** Frame-level support for the measurement protocol: structure map, gate info, phase marks, auto-trace. */
describe('measurement support in the simulator core', () => {
  const c = loadCaseById('normal-excellent-window');
  const thorax = createThoraxModel(c.bodyHabitus, c.acousticWindow, {
    position: 'left-lateral',
    respiration: 'expiration',
    headElevationDeg: 0,
  });
  const heart = createHeartModel(c.anatomy, c.physiology, thorax.heartOffset, c.seed);
  heartLandmarks(heart);
  const a5c = canonicalControl(getViewTarget('a5c'), heart, thorax);
  const lvotP = heartToTorso(heart.frame, heartLandmarks(heart).find((l) => l.id === 'lvot')!.p);
  const beam = beamFrameFromPose(poseFromControl(thorax, a5c));
  const d = sub(lvotP, beam.origin);
  const depth = dot(d, beam.forward),
    lateral = dot(d, beam.lateral);
  const gateR = Math.hypot(depth, lateral),
    gateTheta = Math.atan2(lateral, depth);

  it('frames carry the polar structure map and phase marks are ordered', () => {
    const core = new SimulatorCore(c, baseInput({ probe: a5c, quality: 'low' }));
    let out = null;
    for (let i = 0; i < 4 && !out; i++) out = core.step(0.05);
    if (!out) throw new Error('no frame produced in four steps');
    expect(out.structure.length).toBe(out.polar.lines * out.polar.samples);
    expect(Array.from(out.structure).some((s) => s === Structure.LvCavity)).toBe(true);
    const pm = core.phaseMarks();
    expect(pm.ejectionStart).toBeLessThan(pm.ejectionEnd);
    expect(pm.ejectionEnd).toBeLessThan(pm.mitralOpen);
    expect(pm.mitralOpen).toBeLessThan(pm.eEnd);
    expect(pm.hasAWave).toBe(true);
    expect(core.lvLengthCm()).toBeGreaterThan(7);
  });

  it('PW gate at the LVOT reports the LVOT structure, flow and a small beam–flow angle', () => {
    const core = new SimulatorCore(
      c,
      baseInput({
        probe: a5c,
        modality: 'pw',
        quality: 'low',
        cursorThetaRad: gateTheta,
        gateDepthCm: gateR,
      }),
    );
    let out = null;
    for (let i = 0; i < 6; i++) out = core.step(0.05) ?? out;
    if (!out?.gate) throw new Error('no gate info in six steps');
    const g = out.gate;
    expect([Structure.Lvot, Structure.LvCavity, Structure.AorticRoot]).toContain(g.structure);
    expect(g.flowPresent).toBe(true);
    expect(g.flowAngleDeg!).toBeLessThan(40);
    expect(g.lineStructures).toContain(Structure.LvCavity);
  });

  it('auto-trace of the LVOT spectrum returns a physiological envelope', () => {
    const core = new SimulatorCore(
      c,
      baseInput({
        probe: a5c,
        modality: 'pw',
        quality: 'low',
        cursorThetaRad: gateTheta,
        gateDepthCm: gateR,
        spectral: { ...DEFAULT_SPECTRAL, scaleMps: 2.0, wallFilterMps: 0.1 },
      }),
    );
    for (let i = 0; i < 60; i++) core.step(0.03); // ~1.8 s of strip
    const res = core.request({ kind: 'autoTrace', x0: 0, x1: 300 });
    if (res?.kind !== 'autoTrace') throw new Error('expected an auto-trace response');
    const v = res.velocitiesMps.map((x) => Math.abs(x));
    expect(v.length).toBeGreaterThan(100);
    const vmax = Math.max(...v);
    expect(vmax).toBeGreaterThan(0.5);
    expect(vmax).toBeLessThan(1.8);
    // most columns are diastole (no LVOT flow): the envelope must fall back to ~0 there
    const quiet = v.filter((x) => x < 0.2).length / v.length;
    expect(quiet).toBeGreaterThan(0.4);
    expect(res.secondsPerColumn).toBeGreaterThan(0);
  });
});
