import { describe, expect, it } from 'vitest';
import { buildSpectralColumn, SPECTRAL_BINS, DEFAULT_SPECTRAL, spectralRange } from './spectral/spectrum';
import { sampleFlow, buildFlowParams } from './flow-primitives/flowField';
import { loadCaseById } from '@/cases';
import { createHeartModel, computeHeartPose, heartLandmarks, heartToTorso } from '@/simulator/anatomy/heartModel';
import { createThoraxModel, snapToIntercostal } from '@/simulator/anatomy/thoraxModel';
import { buildBeatTables, cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { SimulatorCore } from '@/simulator/core/simulatorCore';
import { baseInput } from '@/simulator/core/simulatorCore.test';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import { dot, sub } from '@/core/vec3';

const c = loadCaseById('normal-excellent-window');
const thorax = createThoraxModel(c.bodyHabitus, c.acousticWindow, { position: 'left-lateral', respiration: 'expiration', headElevationDeg: 0 });
const heart = createHeartModel(c.anatomy, c.physiology, thorax.heartOffset);
heartLandmarks(heart);
const tables = buildBeatTables(60 / c.rhythm.heartRateBpm, c.physiology, c.rhythm, c.hemodynamics);
computeHeartPose(heart, cycleStateAt(tables, 0));
const flow = buildFlowParams(c, heart, tables);

function peakVelocityOfColumn(col: Float32Array, vMin: number, vMax: number, threshold = 0.35): number {
  // highest |velocity| with energy above threshold (flow away from the transducer is below the baseline)
  let best = 0;
  for (let b = 0; b < SPECTRAL_BINS; b++) {
    if ((col[b] ?? 0) > threshold) best = Math.max(best, Math.abs(vMax - ((b + 0.5) / SPECTRAL_BINS) * (vMax - vMin)));
  }
  return best;
}

describe('Doppler physics (spec 36/48.3)', () => {
  it('flow field: LVOT velocity peaks in systole and mitral inflow in diastole, magnitudes physiologic', () => {
    const t = tables.timings;
    const sysPhase = (t.ejectionStartS + 0.11) / tables.rrS;
    const diaPhase = (t.mitralOpenS + t.eAccelS) / tables.rrS;
    const out = { vx: 0, vy: 0, vz: 0, dispersion: 0, present: 0 };
    const lvot = heartLandmarks(heart).find((l) => l.id === 'lvot')!.p;
    sampleFlow(flow, tables, computeHeartPose(heart, cycleStateAt(tables, sysPhase)), sysPhase, lvot.x, lvot.y, lvot.z, out);
    const vSys = Math.hypot(out.vx, out.vy, out.vz);
    expect(out.present).toBe(1);
    expect(vSys).toBeGreaterThan(0.6);
    expect(vSys).toBeLessThan(1.5);
    sampleFlow(flow, tables, computeHeartPose(heart, cycleStateAt(tables, diaPhase)), diaPhase, lvot.x, lvot.y, lvot.z, out);
    expect(Math.hypot(out.vx, out.vy, out.vz)).toBeLessThan(0.2);
    const mv = { x: 0.2, y: -0.9, z: 1.2 };
    sampleFlow(flow, tables, computeHeartPose(heart, cycleStateAt(tables, diaPhase)), diaPhase, mv.x, mv.y, mv.z, out);
    expect(out.vz).toBeGreaterThan(0.5); // toward the apex
    expect(out.vz).toBeLessThan(1.1);
  });

  it('cosine law: a misaligned beam underestimates the projected velocity', () => {
    const v = { x: 0, y: 0, z: 1.0 };
    const proj = (deg: number) => Math.abs(v.z * Math.cos((deg * Math.PI) / 180));
    expect(proj(0)).toBeCloseTo(1, 6);
    expect(proj(20)).toBeCloseTo(0.94, 2);
    expect(proj(60)).toBeCloseTo(0.5, 2);
  });

  it('PW aliases when the velocity exceeds Nyquist; CW clips instead of wrapping', () => {
    const s = { ...DEFAULT_SPECTRAL, scaleMps: 0.6, baselineShiftMps: 0 };
    const col = new Float32Array(SPECTRAL_BINS);
    buildSpectralColumn([{ v: 1.0, weight: 1, dispersion: 0.05 }], s, 1, 1, true, col);
    const { vMin, vMax } = spectralRange(s);
    // energy should sit at the aliased velocity 1.0 − 1.2 = −0.2 m/s (below baseline)
    let best = 0,
      bestV = 0;
    for (let b = 0; b < SPECTRAL_BINS; b++)
      if ((col[b] ?? 0) > best) {
        best = col[b] ?? 0;
        bestV = vMax - ((b + 0.5) / SPECTRAL_BINS) * (vMax - vMin);
      }
    expect(bestV).toBeLessThan(0);
    expect(bestV).toBeCloseTo(-0.2, 1);
    const cw = new Float32Array(SPECTRAL_BINS);
    buildSpectralColumn([{ v: 1.0, weight: 1, dispersion: 0.05 }], s, 1, 1, false, cw);
    let bestCw = 0,
      bestVcw = 0;
    for (let b = 0; b < SPECTRAL_BINS; b++)
      if ((cw[b] ?? 0) > bestCw) {
        bestCw = cw[b] ?? 0;
        bestVcw = vMax - ((b + 0.5) / SPECTRAL_BINS) * (vMax - vMin);
      }
    expect(bestVcw).toBeGreaterThan(0.5); // clipped at the top of the range, not wrapped
  });

  it('wall filter removes low velocities and turbulence broadens the spectrum', () => {
    const s = { ...DEFAULT_SPECTRAL, scaleMps: 1, wallFilterMps: 0.15 };
    const col = new Float32Array(SPECTRAL_BINS);
    buildSpectralColumn([{ v: 0.1, weight: 1, dispersion: 0.05 }], s, 2, 1, true, col);
    expect(Math.max(...Array.from(col))).toBeLessThan(0.3); // only noise
    const narrow = new Float32Array(SPECTRAL_BINS);
    const wide = new Float32Array(SPECTRAL_BINS);
    buildSpectralColumn([{ v: 0.8, weight: 1, dispersion: 0.03 }], s, 3, 1, true, narrow);
    buildSpectralColumn([{ v: 0.8, weight: 1, dispersion: 0.5 }], s, 3, 1, true, wide);
    const width = (a: Float32Array) => Array.from(a).filter((x) => x > 0.5).length;
    expect(width(wide)).toBeGreaterThan(width(narrow) * 1.5);
  });
});

describe('Doppler through the simulator core', () => {
  const lvotP = heartToTorso(heart.frame, heartLandmarks(heart).find((l) => l.id === 'lvot')!.p);
  const aimGate = (control: ReturnType<typeof canonicalControl>) => {
    const beam = beamFrameFromPose(poseFromControl(thorax, control));
    const d = sub(lvotP, beam.origin);
    const depth = dot(d, beam.forward);
    const lateral = dot(d, beam.lateral);
    return { r: Math.hypot(depth, lateral), theta: Math.atan2(lateral, depth) };
  };
  const runPw = (control: ReturnType<typeof canonicalControl>, modality: 'pw' | 'cw', gateOverride?: number) => {
    const core = new SimulatorCore(c, baseInput({ probe: control, modality, quality: 'low' }));
    const g = aimGate(control);
    core.setInput(baseInput({ probe: control, modality, quality: 'low', cursorThetaRad: g.theta, gateDepthCm: gateOverride ?? g.r, spectral: { ...DEFAULT_SPECTRAL, scaleMps: 2.0, wallFilterMps: 0.1 } }));
    let peak = 0;
    // run 1.2 beats and track the highest column velocity
    for (let i = 0; i < 40; i++) {
      const out = core.step(0.03);
      if (out?.spectrumColumn) peak = Math.max(peak, peakVelocityOfColumn(out.spectrumColumn, out.spectralRange.vMin, out.spectralRange.vMax));
    }
    return peak;
  };
  it('PW at the LVOT: the measured peak falls monotonically as the beam–flow angle grows (cosine law)', { timeout: 90_000 }, () => {
    const a5c = canonicalControl(getViewTarget('a5c'), heart, thorax);
    // flow direction at the LVOT at peak systole (torso frame)
    const t = tables.timings;
    const sysPhase = (t.ejectionStartS + 0.11) / tables.rrS;
    const lvotH = heartLandmarks(heart).find((l) => l.id === 'lvot')!.p;
    const fs = { vx: 0, vy: 0, vz: 0, dispersion: 0, present: 0 };
    sampleFlow(flow, tables, computeHeartPose(heart, cycleStateAt(tables, sysPhase)), sysPhase, lvotH.x, lvotH.y, lvotH.z, fs);
    const f = heart.frame;
    const flowDir = { x: f.ex.x * fs.vx + f.ey.x * fs.vy + f.ez.x * fs.vz, y: f.ex.y * fs.vx + f.ey.y * fs.vy + f.ez.y * fs.vz, z: f.ex.z * fs.vx + f.ey.z * fs.vy + f.ez.z * fs.vz };
    const fl = Math.hypot(flowDir.x, flowDir.y, flowDir.z);
    const results: { angleDeg: number; peak: number; expected: number }[] = [];
    // the beam–flow angle is set by where the probe sits on the chest (the cursor always re-aims at the LVOT)
    for (const [du, dv] of [[0, 0], [-4, 0], [4, 0], [0, 4], [0, -4], [-4, 4], [4, -4], [-5, -3], [5, 3]] as const) {
      const snapped = snapToIntercostal(thorax, a5c.u + du, a5c.v + dv);
      const ctrl = { ...a5c, u: snapped.u, v: snapped.v };
      const beam = beamFrameFromPose(poseFromControl(thorax, ctrl));
      const g = aimGate(ctrl);
      const dir = { x: beam.forward.x * Math.cos(g.theta) + beam.lateral.x * Math.sin(g.theta), y: beam.forward.y * Math.cos(g.theta) + beam.lateral.y * Math.sin(g.theta), z: beam.forward.z * Math.cos(g.theta) + beam.lateral.z * Math.sin(g.theta) };
      const cos = Math.abs((dir.x * flowDir.x + dir.y * flowDir.y + dir.z * flowDir.z) / fl);
      results.push({ angleDeg: (Math.acos(Math.min(1, cos)) * 180) / Math.PI, peak: runPw(ctrl, 'pw'), expected: fl * cos });
    }
    results.sort((a, b) => a.angleDeg - b.angleDeg);
    // poses whose line is blocked by a rib/lung record no signal at all: a real effect, excluded from the cosine check
    const valid = results.filter((r) => r.peak > 0.2);
    expect(valid.length).toBeGreaterThanOrEqual(6);
    const best = valid[0]!;
    const worst = valid[valid.length - 1]!;
    expect(best.peak).toBeGreaterThan(0.45);
    expect(best.peak).toBeLessThan(1.6);
    expect(worst.angleDeg).toBeGreaterThan(best.angleDeg + 12);
    // what the pipeline should measure is |v·d| at the gate (gate volume may catch slightly faster neighbours)
    for (const r of valid) expect(Math.abs(r.peak - r.expected), JSON.stringify(results)).toBeLessThan(0.35);
    // the worst-aligned pose underestimates the true speed more than the best-aligned one
    expect(worst.peak).toBeLessThan(best.peak * 0.8);
  });
  it('CW along the same line does not depend on gate depth (no range resolution) and PW does', { timeout: 60_000 }, () => {
    const a5c = canonicalControl(getViewTarget('a5c'), heart, thorax);
    const cwA = runPw(a5c, 'cw', 3);
    const cwB = runPw(a5c, 'cw', 12);
    expect(Math.abs(cwA - cwB)).toBeLessThan(0.08);
    const pwFar = runPw(a5c, 'pw', 2.0); // gate in the near field (chest wall / apex): little or no flow
    const pwLvot = runPw(a5c, 'pw');
    expect(pwFar).toBeLessThan(pwLvot);
  });
});
