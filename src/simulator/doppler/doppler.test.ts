import { describe, expect, it } from 'vitest';
import { accumulateSpectrum, buildSpectralColumn, envelopeThreshold, SPECTRAL_BINS, DEFAULT_SPECTRAL, spectralRange, spectralSpread, type SpectralSettings, type VelocitySample } from './spectral/spectrum';
import { sampleFlow, buildFlowParams, sampleTissueVelocity } from './flow-primitives/flowField';
import { loadCaseById } from '@/cases';
import { classifyHeart, createHeartModel, computeHeartPose, heartLandmarks, heartToTorso, ROOT_EXCURSION } from '@/simulator/anatomy/heartModel';
import { Tissue, type TissueSample } from '@/simulator/anatomy/tissue';
import { createThoraxModel, snapToIntercostal } from '@/simulator/anatomy/thoraxModel';
import { buildBeatTables, cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { SimulatorCore } from '@/simulator/core/simulatorCore';
import { baseInput } from '@/simulator/core/baseInput';
import { canonicalControl, canonicalPlane, getViewTarget } from '@/simulator/windows/viewTargets';
import { beamFrameFromPose, controlAimingAt, poseFromControl } from '@/simulator/probe/pose';
import { dot, sub, v3, type Vec3 } from '@/core/vec3';

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

  it('PW aliases when the velocity exceeds Nyquist; CW keeps the true velocity and leaves the screen instead of stacking at its edge', () => {
    const s = { ...DEFAULT_SPECTRAL, scaleMps: 0.6, baselineShiftMps: 0 };
    const peakVelocity = (col: Float32Array, set: typeof s): { v: number; value: number } => {
      const { vMin, vMax } = spectralRange(set);
      let best = -1,
        bestV = 0;
      for (let b = 0; b < SPECTRAL_BINS; b++)
        if ((col[b] ?? 0) > best) {
          best = col[b] ?? 0;
          bestV = vMax - ((b + 0.5) / SPECTRAL_BINS) * (vMax - vMin);
        }
      return { v: bestV, value: best };
    };
    const col = new Float32Array(SPECTRAL_BINS);
    buildSpectralColumn([{ v: 1.0, weight: 1, dispersion: 0.05 }], s, 1, 1, true, col);
    // energy should sit at the aliased velocity 1.0 − 1.2 = −0.2 m/s (below baseline)
    expect(peakVelocity(col, s).v).toBeCloseTo(-0.2, 1);
    // CW (decision 87): a 1.0 m/s jet on a ±0.6 m/s scale draws nothing in range, not a band at +0.6
    const cw = new Float32Array(SPECTRAL_BINS);
    accumulateSpectrum([{ v: 1.0, weight: 1, dispersion: 0.05 }], s, false, cw);
    expect(Math.max(...Array.from(cw))).toBeLessThan(1e-6);
    // widening the scale shows it where it is
    const wide = { ...s, scaleMps: 1.4 };
    accumulateSpectrum([{ v: 1.0, weight: 1, dispersion: 0.05 }], wide, false, cw);
    expect(peakVelocity(cw, wide).v).toBeCloseTo(1.0, 1);
    // a jet 3 σ past the edge leaves only the tail of its turbulent spread in range (σ ≈ 0.03 m/s toward the baseline): the
    // top bin holds a small fraction of a centred peak, where clamping stacked the whole peak
    const centred = new Float32Array(SPECTRAL_BINS);
    accumulateSpectrum([{ v: 0.3, weight: 1, dispersion: 0.05 }], s, false, centred);
    accumulateSpectrum([{ v: 0.7, weight: 1, dispersion: 0.05 }], s, false, cw);
    expect(cw[0]!).toBeLessThan(0.1 * Math.max(...Array.from(centred)));
  });

  it('PW keeps the whole distribution when it crosses Nyquist: its energy reappears at the other end (decisions 87 and 96)', () => {
    const s = { ...DEFAULT_SPECTRAL, scaleMps: 0.6, baselineShiftMps: 0.1, wallFilterMps: 0.05 };
    const energy = (v: number): { total: number; top: number } => {
      const col = new Float32Array(SPECTRAL_BINS);
      // broad turbulent spread (σ ≈ 0.15 m/s toward lower speed): past Nyquist (0.7 m/s here) the flow aliases to the bottom
      // of the scale, and the slower part of its spread crosses the bottom edge back to the top
      accumulateSpectrum([{ v, weight: 1, dispersion: 0.25 }], s, true, col);
      let total = 0;
      for (const x of col) total += x;
      let top = 0;
      for (let b = 0; b < Math.floor(SPECTRAL_BINS * 0.15); b++) top += col[b]!;
      return { total, top };
    };
    const ref = energy(0.2).total; // fully inside the range
    for (const v of [0.55, 0.65, 0.72, 0.8]) {
      const e = energy(v);
      // the sum over bins of a line wrapped on the span does not depend on where it sits (its turbulent side grows with
      // |v| here, so compare against the analytic sum of its two half-Gaussians)
      const spread = spectralSpread({ v, weight: 1, dispersion: 0.25 }, s);
      const analytic = (((spread.up + spread.down) / 1.2) * SPECTRAL_BINS * Math.sqrt(2 * Math.PI)) / 2;
      expect(Math.abs(e.total / analytic - 1), `v=${v}`).toBeLessThan(0.02);
      if (v > 0.7) expect(e.top, `v=${v}: the spread past −Nyquist wraps to the top of the scale`).toBeGreaterThan(0.1 * e.total);
    }
    expect(ref).toBeGreaterThan(0);
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
    // the beam–flow angle is set by where the probe sits on the chest; from each position the probe is
    // re-aimed so that the LVOT stays in the imaging plane (as a sonographer does) and the cursor targets it
    const plane = canonicalPlane(getViewTarget('a5c'), heart);
    for (const [du, dv] of [[0, 0], [-4, 0], [4, 0], [0, 4], [0, -4], [-4, 4], [4, -4], [-5, -3], [5, 3]] as const) {
      const snapped = snapToIntercostal(thorax, a5c.u + du, a5c.v + dv);
      const ctrl = controlAimingAt(thorax, snapped.u, snapped.v, lvotP, plane.right, 0.6);
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

/** Outer edge (m/s) of the envelope on one side of the baseline: from its brightest bin outward while above the envelope threshold, gaps ≤ 2 bins; 0 without an envelope. */
function outerEdge(col: ArrayLike<number>, s: SpectralSettings, sign: 1 | -1): number {
  const { vMin, vMax } = spectralRange(s);
  const vOf = (b: number) => vMax - ((b + 0.5) / SPECTRAL_BINS) * (vMax - vMin);
  let colMax = 0;
  for (let b = 0; b < SPECTRAL_BINS; b++) colMax = Math.max(colMax, col[b] ?? 0);
  const thr = envelopeThreshold(colMax, s);
  let peak = -1;
  for (let b = 0, best = thr; b < SPECTRAL_BINS; b++) if (Math.sign(vOf(b)) === sign && (col[b] ?? 0) > best) best = col[(peak = b)] ?? 0;
  if (peak < 0) return 0;
  const step = sign > 0 ? -1 : 1;
  let e = peak;
  for (let b = peak + step, gap = 0; b >= 0 && b < SPECTRAL_BINS; b += step)
    if ((col[b] ?? 0) > thr) {
      e = b;
      gap = 0;
    } else if (++gap > 2) break;
  return vOf(e) + (sign * 0.5 * (vMax - vMin)) / SPECTRAL_BINS;
}

describe('the spectral envelope reads the velocity in the sample volume (decision 96)', () => {
  it('a laminar flow: the outer edge sits within 6% above its speed, at any velocity scale', () => {
    // plug flow at the mitral tips: most of the gate at 0.8 m/s 21° off the beam, 11 cm deep, and a slower jet edge
    const samples: VelocitySample[] = [];
    for (let i = 0; i < 16; i++) samples.push({ v: 0.8, weight: 1, dispersion: 0.04, vPerp: 0.31, depthCm: 11 });
    for (const v of [0.45, 0.55, 0.65, 0.7]) samples.push({ v, weight: 1, dispersion: 0.19, vPerp: 0.25, depthCm: 11 });
    const edges = [1.0, 2.0].map((scaleMps) => {
      const s = { ...DEFAULT_SPECTRAL, scaleMps };
      const col = new Float32Array(SPECTRAL_BINS);
      buildSpectralColumn(samples, s, 5, 1, true, col);
      return outerEdge(col, s, 1);
    });
    // before: a symmetric Gaussian of 0.035·scale + 0.02 m/s plus 0.9·dispersion·|v| put the edge at 0.96 and 1.03 m/s
    expect(edges.map((e) => e >= 0.8 && e <= 0.8 * 1.06), `edges ${edges.map((e) => e.toFixed(3)).join(', ')}`).toEqual([true, true]);
    expect(Math.abs(edges[0]! - edges[1]!)).toBeLessThan(0.03);
  });

  it('a stenotic jet: turbulence fills the spectral window under the envelope without lifting its edge', () => {
    const s = { ...DEFAULT_SPECTRAL, scaleMps: 6 };
    const samples: VelocitySample[] = [];
    for (let i = 0; i < 8; i++) samples.push({ v: -4.0, weight: 1, dispersion: 0.6, vPerp: 1.2, depthCm: 11 }); // vena contracta
    for (let i = 0; i < 8; i++) samples.push({ v: -3.0, weight: 1, dispersion: 0.6, vPerp: 1.0, depthCm: 12 }); // decaying jet
    const col = new Float32Array(SPECTRAL_BINS);
    buildSpectralColumn(samples, s, 7, 1, false, col);
    const { vMin, vMax } = spectralRange(s);
    const edge = outerEdge(col, s, -1);
    // before: the edge reached the bottom of the scale (−6 m/s)
    expect(-edge).toBeGreaterThanOrEqual(4.0);
    expect(-edge).toBeLessThanOrEqual(4.0 * 1.06);
    const at = (v: number) => col[Math.floor(((vMax - v) / (vMax - vMin)) * SPECTRAL_BINS)] ?? 0;
    expect(at(-2.0)).toBeGreaterThan(0.35);
  });

  /** Runs `modality` with the cursor through `gate` (torso frame) and returns, per strip column, its phase and data. */
  const strip = (core: SimulatorCore, seconds: number) => {
    for (let t = 0; t < seconds; t += 0.02) core.step(0.02);
    const st = core.spectralStrip;
    const n = Math.min(st.head, st.cols);
    return Array.from({ length: n }, (_, c) => ({ phase: st.phase[c]!, col: st.data!.subarray(c * SPECTRAL_BINS, (c + 1) * SPECTRAL_BINS) }));
  };
  const aim = (control: ReturnType<typeof canonicalControl>, target: Vec3) => {
    const beam = beamFrameFromPose(poseFromControl(thorax, control));
    const d = sub(target, beam.origin);
    const depth = dot(d, beam.forward);
    const lateral = dot(d, beam.lateral);
    const theta = Math.atan2(lateral, depth);
    const dir = v3(beam.forward.x * Math.cos(theta) + beam.lateral.x * Math.sin(theta), beam.forward.y * Math.cos(theta) + beam.lateral.y * Math.sin(theta), beam.forward.z * Math.cos(theta) + beam.lateral.z * Math.sin(theta));
    const f = heart.frame;
    return { beam, theta, r: Math.hypot(depth, lateral), dirHeart: { x: dot(dir, f.ex), y: dot(dir, f.ey), z: dot(dir, f.ez) } };
  };

  it('through the core: PW at the mitral tips, its auto-trace and tissue Doppler at the septal base read the velocity at the gate', { timeout: 120_000 }, () => {
    const t = tables.timings;
    const inE = (phase: number) => phase * tables.rrS > t.mitralOpenS && phase * tables.rrS < t.aStartS;
    const a4c = canonicalControl(getViewTarget('a4c'), heart, thorax);
    const fs = { vx: 0, vy: 0, vz: 0, dispersion: 0, present: 0 };
    // mitral inflow, 1 cm apical of the valve landmark
    const tips = v3(0.2, -0.9, 1.7);
    const pw = aim(a4c, heartToTorso(heart.frame, tips));
    const spectral = { ...DEFAULT_SPECTRAL, scaleMps: 1.2 };
    const core = new SimulatorCore(c, baseInput({ probe: a4c, modality: 'pw', quality: 'low', cursorThetaRad: pw.theta, gateDepthCm: pw.r, spectral }));
    const cols = strip(core, 2.2);
    let truth = 0,
      edge = 0,
      traced = 0;
    const trace = core.request({ kind: 'autoTrace', x0: 0, x1: cols.length - 1 });
    expect(trace?.kind).toBe('autoTrace');
    cols.forEach(({ phase, col }, x) => {
      if (!inE(phase)) return;
      sampleFlow(flow, tables, computeHeartPose(heart, cycleStateAt(tables, phase)), phase, tips.x, tips.y, tips.z, fs);
      truth = Math.max(truth, -(fs.vx * pw.dirHeart.x + fs.vy * pw.dirHeart.y + fs.vz * pw.dirHeart.z));
      edge = Math.max(edge, outerEdge(col, spectral, 1));
      traced = Math.max(traced, trace!.kind === 'autoTrace' ? (trace!.velocitiesMps[x] ?? 0) : 0);
    });
    // before: the edge read 1.30× the flow and the auto-trace stopped at the gap the wall filter leaves under the envelope
    expect(truth).toBeGreaterThan(0.6);
    expect([edge / truth, traced / truth].map((q) => q > 0.97 && q < 1.08), `E: flow ${truth.toFixed(3)}, edge ${edge.toFixed(3)}, auto-trace ${traced.toFixed(3)}`).toEqual([true, true]);

    // tissue Doppler: septal myocardium 1 cm from the annulus
    const q = { tissue: 0 } as unknown as TissueSample;
    const hp0 = computeHeartPose(heart, cycleStateAt(tables, 0));
    let first = NaN,
      last = NaN;
    for (let x = -0.5; x > -5; x -= 0.05)
      if (classifyHeart(heart, hp0, x, 0, 1.0, q) && q.tissue === Tissue.Myocardium) {
        if (Number.isNaN(first)) first = x;
        last = x;
      } else if (!Number.isNaN(first)) break;
    const septum = v3((first + last) / 2, 0, 1.0);
    const tdi = aim(a4c, heartToTorso(heart.frame, septum));
    const tdiSpectral = { ...DEFAULT_SPECTRAL, scaleMps: 0.2, wallFilterMps: 0.01 };
    const tdiCore = new SimulatorCore(c, baseInput({ probe: a4c, modality: 'tdi', quality: 'low', cursorThetaRad: tdi.theta, gateDepthCm: tdi.r, spectral: tdiSpectral }));
    let ePrime = 0,
      ePrimeEdge = 0;
    for (const { phase, col } of strip(tdiCore, 2.2)) {
      if (!inE(phase)) continue;
      const tv = sampleTissueVelocity(heart, tables, phase, septum.z);
      ePrime = Math.min(ePrime, -(tv.vx * tdi.dirHeart.x + tv.vy * tdi.dirHeart.y + tv.vz * tdi.dirHeart.z));
      ePrimeEdge = Math.min(ePrimeEdge, outerEdge(col, tdiSpectral, -1));
    }
    // before: 1.57× the tissue velocity
    expect(ePrime).toBeLessThan(-0.06);
    expect(ePrimeEdge / ePrime, `e′: tissue ${ePrime.toFixed(3)}, edge ${ePrimeEdge.toFixed(3)}`).toBeGreaterThan(0.97);
    expect(ePrimeEdge / ePrime).toBeLessThan(1.1);
  });

  it('through the core: CW aimed through a stenotic aortic jet from the apex draws the jet at its speed', { timeout: 120_000 }, () => {
    const as = loadCaseById('aortic-stenosis-moderate');
    const probe = new SimulatorCore(as, baseInput());
    const m = probe.models;
    const t = m.tables.timings;
    const f = buildFlowParams(as, m.heart, m.tables);
    const peak = (t.ejectionStartS + 0.35 * (t.ejectionEndS - t.ejectionStartS)) / m.tables.rrS;
    const hpPeak = computeHeartPose(m.heart, cycleStateAt(m.tables, peak));
    // vena contracta, 0.5 cm along the valve axis
    const vc = v3(f.avCenter.x + 0.5 * f.avAxis.x, f.avCenter.y + 0.5 * f.avAxis.y, f.avCenter.z + hpPeak.zAnn * ROOT_EXCURSION + 0.5 * f.avAxis.z);
    const a5c = canonicalControl(getViewTarget('a5c'), m.heart, m.thorax);
    const ctrl = controlAimingAt(m.thorax, a5c.u, a5c.v, heartToTorso(m.heart.frame, vc), canonicalPlane(getViewTarget('a5c'), m.heart).right, a5c.pressure);
    const beam = beamFrameFromPose(poseFromControl(m.thorax, ctrl));
    const fr = m.heart.frame;
    const dh = { x: dot(beam.forward, fr.ex), y: dot(beam.forward, fr.ey), z: dot(beam.forward, fr.ez) };
    const spectral = { ...DEFAULT_SPECTRAL, scaleMps: 5 };
    const core = new SimulatorCore(as, baseInput({ probe: ctrl, modality: 'cw', quality: 'low', cursorThetaRad: 0, gateDepthCm: 10, spectral }));
    const q = { tissue: 0 } as unknown as TissueSample;
    const fs = { vx: 0, vy: 0, vz: 0, dispersion: 0, present: 0 };
    let jet = 0,
      edge = 0;
    for (const { phase, col } of strip(core, 2.2)) {
      const tb = phase * m.tables.rrS;
      if (tb < t.ejectionStartS || tb > t.ejectionEndS) continue;
      edge = Math.min(edge, outerEdge(col, spectral, -1));
      const hp = computeHeartPose(m.heart, cycleStateAt(m.tables, phase));
      // the fastest flow the line crosses, where the core samples it
      for (let r = 1; r < 16; r += 0.25) {
        const p = v3(beam.origin.x + beam.forward.x * r - fr.origin.x, beam.origin.y + beam.forward.y * r - fr.origin.y, beam.origin.z + beam.forward.z * r - fr.origin.z);
        const hx = dot(p, fr.ex),
          hy = dot(p, fr.ey),
          hz = dot(p, fr.ez);
        if (!classifyHeart(m.heart, hp, hx, hy, hz, q) || q.tissue !== Tissue.Blood) continue;
        sampleFlow(f, m.tables, hp, phase, hx, hy, hz, fs);
        if (fs.present) jet = Math.min(jet, -(fs.vx * dh.x + fs.vy * dh.y + fs.vz * dh.z));
      }
    }
    // before: the line stopped where the absolute transmission fell under 2% (9 cm), before the jet: the edge read the LVOT
    expect(jet).toBeLessThan(-2);
    expect(edge / jet, `jet ${jet.toFixed(2)} m/s, edge ${edge.toFixed(2)}`).toBeGreaterThan(0.97);
    expect(edge / jet).toBeLessThan(1.08);
  });
});
