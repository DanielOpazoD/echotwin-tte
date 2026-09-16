// @tier slow
import { describe, expect, it } from 'vitest';
import {
  accumulateSpectrum,
  buildSpectralColumn,
  envelopeThreshold,
  isClickColumn,
  SPECTRAL_BINS,
  DEFAULT_SPECTRAL,
  spectralRange,
  spectralSpread,
  type SpectralSettings,
  type VelocitySample,
} from './spectral/spectrum';
import { sampleFlow, buildFlowParams, sampleTissueVelocity } from './flow-primitives/flowField';
import { loadCaseById } from '@/cases';
import {
  classifyHeart,
  createHeartModel,
  computeHeartPose,
  heartAnchors,
  heartLandmarks,
  heartToTorso,
  ROOT_EXCURSION,
} from '@/simulator/anatomy/heartModel';
import { Tissue, type TissueSample } from '@/simulator/anatomy/tissue';
import { createThoraxModel, snapToIntercostal } from '@/simulator/anatomy/thoraxModel';
import {
  buildBeatTables,
  cycleStateAt,
  valveEventTimes,
} from '@/simulator/cardiac-cycle/cycleModel';
import { SimulatorCore } from '@/simulator/core/simulatorCore';
import { baseInput } from '@/simulator/core/baseInput';
import { canonicalControl, canonicalPlane, getViewTarget } from '@/simulator/windows/viewTargets';
import { beamFrameFromPose, controlAimingAt, poseFromControl } from '@/simulator/probe/pose';
import { dot, sub, v3, type Vec3 } from '@/core/vec3';

const c = loadCaseById('normal-excellent-window');
const thorax = createThoraxModel(c.bodyHabitus, c.acousticWindow, {
  position: 'left-lateral',
  respiration: 'expiration',
  headElevationDeg: 0,
});
const heart = createHeartModel(c.anatomy, c.physiology, thorax.heartOffset);
heartLandmarks(heart);
const tables = buildBeatTables(60 / c.rhythm.heartRateBpm, c.physiology, c.rhythm, c.hemodynamics);
computeHeartPose(heart, cycleStateAt(tables, 0));
const flow = buildFlowParams(c, heart, tables);

function peakVelocityOfColumn(
  col: Float32Array,
  vMin: number,
  vMax: number,
  threshold = 0.35,
): number {
  // highest |velocity| with energy above threshold (flow away from the transducer is below the baseline); a valve click
  // is read as no flow, as a sonographer ignores it (decision 103)
  if (
    isClickColumn(col, {
      ...DEFAULT_SPECTRAL,
      scaleMps: (vMax - vMin) / 2,
      baselineShiftMps: (vMax + vMin) / 2,
      wallFilterMps: 0.1,
    })
  )
    return 0;
  let best = 0;
  for (let b = 0; b < SPECTRAL_BINS; b++) {
    if ((col[b] ?? 0) > threshold)
      best = Math.max(best, Math.abs(vMax - ((b + 0.5) / SPECTRAL_BINS) * (vMax - vMin)));
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
    sampleFlow(
      flow,
      tables,
      computeHeartPose(heart, cycleStateAt(tables, sysPhase)),
      sysPhase,
      lvot.x,
      lvot.y,
      lvot.z,
      out,
    );
    const vSys = Math.hypot(out.vx, out.vy, out.vz);
    expect(out.present).toBe(1);
    expect(vSys).toBeGreaterThan(0.6);
    expect(vSys).toBeLessThan(1.5);
    sampleFlow(
      flow,
      tables,
      computeHeartPose(heart, cycleStateAt(tables, diaPhase)),
      diaPhase,
      lvot.x,
      lvot.y,
      lvot.z,
      out,
    );
    expect(Math.hypot(out.vx, out.vy, out.vz)).toBeLessThan(0.2);
    const mv = { x: 0.2, y: -0.9, z: 1.2 };
    sampleFlow(
      flow,
      tables,
      computeHeartPose(heart, cycleStateAt(tables, diaPhase)),
      diaPhase,
      mv.x,
      mv.y,
      mv.z,
      out,
    );
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
      const analytic =
        (((spread.up + spread.down) / 1.2) * SPECTRAL_BINS * Math.sqrt(2 * Math.PI)) / 2;
      expect(Math.abs(e.total / analytic - 1), `v=${v}`).toBeLessThan(0.02);
      if (v > 0.7)
        expect(
          e.top,
          `v=${v}: the spread past −Nyquist wraps to the top of the scale`,
        ).toBeGreaterThan(0.1 * e.total);
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
  const runPw = (
    control: ReturnType<typeof canonicalControl>,
    modality: 'pw' | 'cw',
    gateOverride?: number,
  ) => {
    const core = new SimulatorCore(c, baseInput({ probe: control, modality, quality: 'low' }));
    const g = aimGate(control);
    core.setInput(
      baseInput({
        probe: control,
        modality,
        quality: 'low',
        cursorThetaRad: g.theta,
        gateDepthCm: gateOverride ?? g.r,
        spectral: { ...DEFAULT_SPECTRAL, scaleMps: 2.0, wallFilterMps: 0.1 },
      }),
    );
    let peak = 0;
    // run 1.2 beats and track the highest column velocity
    for (let i = 0; i < 40; i++) {
      const out = core.step(0.03);
      if (out?.spectrumColumn)
        peak = Math.max(
          peak,
          peakVelocityOfColumn(out.spectrumColumn, out.spectralRange.vMin, out.spectralRange.vMax),
        );
    }
    return peak;
  };
  it(
    'PW at the LVOT: the measured peak falls monotonically as the beam–flow angle grows (cosine law)',
    { timeout: 90_000 },
    () => {
      const a5c = canonicalControl(getViewTarget('a5c'), heart, thorax);
      // flow direction at the LVOT at peak systole (torso frame)
      const t = tables.timings;
      const sysPhase = (t.ejectionStartS + 0.11) / tables.rrS;
      const lvotH = heartLandmarks(heart).find((l) => l.id === 'lvot')!.p;
      const fs = { vx: 0, vy: 0, vz: 0, dispersion: 0, present: 0 };
      sampleFlow(
        flow,
        tables,
        computeHeartPose(heart, cycleStateAt(tables, sysPhase)),
        sysPhase,
        lvotH.x,
        lvotH.y,
        lvotH.z,
        fs,
      );
      const f = heart.frame;
      const flowDir = {
        x: f.ex.x * fs.vx + f.ey.x * fs.vy + f.ez.x * fs.vz,
        y: f.ex.y * fs.vx + f.ey.y * fs.vy + f.ez.y * fs.vz,
        z: f.ex.z * fs.vx + f.ey.z * fs.vy + f.ez.z * fs.vz,
      };
      const fl = Math.hypot(flowDir.x, flowDir.y, flowDir.z);
      const results: { angleDeg: number; peak: number; expected: number }[] = [];
      // the beam–flow angle is set by where the probe sits on the chest; from each position the probe is
      // re-aimed so that the LVOT stays in the imaging plane (as a sonographer does) and the cursor targets it
      const plane = canonicalPlane(getViewTarget('a5c'), heart);
      for (const [du, dv] of [
        [0, 0],
        [-4, 0],
        [4, 0],
        [0, 4],
        [0, -4],
        [-4, 4],
        [4, -4],
        [-5, -3],
        [5, 3],
      ] as const) {
        const snapped = snapToIntercostal(thorax, a5c.u + du, a5c.v + dv);
        const ctrl = controlAimingAt(thorax, snapped.u, snapped.v, lvotP, plane.right, 0.6);
        const beam = beamFrameFromPose(poseFromControl(thorax, ctrl));
        const g = aimGate(ctrl);
        const dir = {
          x: beam.forward.x * Math.cos(g.theta) + beam.lateral.x * Math.sin(g.theta),
          y: beam.forward.y * Math.cos(g.theta) + beam.lateral.y * Math.sin(g.theta),
          z: beam.forward.z * Math.cos(g.theta) + beam.lateral.z * Math.sin(g.theta),
        };
        const cos = Math.abs((dir.x * flowDir.x + dir.y * flowDir.y + dir.z * flowDir.z) / fl);
        results.push({
          angleDeg: (Math.acos(Math.min(1, cos)) * 180) / Math.PI,
          peak: runPw(ctrl, 'pw'),
          expected: fl * cos,
        });
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
      for (const r of valid)
        expect(Math.abs(r.peak - r.expected), JSON.stringify(results)).toBeLessThan(0.35);
      // the worst-aligned pose underestimates the true speed more than the best-aligned one
      expect(worst.peak).toBeLessThan(best.peak * 0.8);
    },
  );
  it(
    'CW along the same line does not depend on gate depth (no range resolution) and PW does',
    { timeout: 60_000 },
    () => {
      const a5c = canonicalControl(getViewTarget('a5c'), heart, thorax);
      const cwA = runPw(a5c, 'cw', 3);
      const cwB = runPw(a5c, 'cw', 12);
      expect(Math.abs(cwA - cwB)).toBeLessThan(0.08);
      const pwFar = runPw(a5c, 'pw', 2.0); // gate in the near field (chest wall / apex): little or no flow
      const pwLvot = runPw(a5c, 'pw');
      expect(pwFar).toBeLessThan(pwLvot);
    },
  );
});

/** Outer edge (m/s) of the envelope on one side of the baseline: from its brightest bin outward while above the envelope threshold, gaps ≤ 2 bins; 0 without an envelope. */
function outerEdge(col: ArrayLike<number>, s: SpectralSettings, sign: 1 | -1): number {
  // a valve click has no envelope to read (decision 103)
  if (isClickColumn(col, s)) return 0;
  const { vMin, vMax } = spectralRange(s);
  const vOf = (b: number) => vMax - ((b + 0.5) / SPECTRAL_BINS) * (vMax - vMin);
  let colMax = 0;
  for (let b = 0; b < SPECTRAL_BINS; b++) colMax = Math.max(colMax, col[b] ?? 0);
  const thr = envelopeThreshold(colMax, s);
  let peak = -1;
  for (let b = 0, best = thr; b < SPECTRAL_BINS; b++)
    if (Math.sign(vOf(b)) === sign && (col[b] ?? 0) > best) best = col[(peak = b)] ?? 0;
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
    for (let i = 0; i < 16; i++)
      samples.push({ v: 0.8, weight: 1, dispersion: 0.04, vPerp: 0.31, depthCm: 11 });
    for (const v of [0.45, 0.55, 0.65, 0.7])
      samples.push({ v, weight: 1, dispersion: 0.19, vPerp: 0.25, depthCm: 11 });
    const edges = [1.0, 2.0].map((scaleMps) => {
      const s = { ...DEFAULT_SPECTRAL, scaleMps };
      const col = new Float32Array(SPECTRAL_BINS);
      buildSpectralColumn(samples, s, 5, 1, true, col);
      return outerEdge(col, s, 1);
    });
    // before: a symmetric Gaussian of 0.035·scale + 0.02 m/s plus 0.9·dispersion·|v| put the edge at 0.96 and 1.03 m/s
    expect(
      edges.map((e) => e >= 0.8 && e <= 0.8 * 1.06),
      `edges ${edges.map((e) => e.toFixed(3)).join(', ')}`,
    ).toEqual([true, true]);
    expect(Math.abs(edges[0]! - edges[1]!)).toBeLessThan(0.03);
  });

  it('a stenotic jet: turbulence fills the spectral window under the envelope without lifting its edge', () => {
    const s = { ...DEFAULT_SPECTRAL, scaleMps: 6 };
    const samples: VelocitySample[] = [];
    for (let i = 0; i < 8; i++)
      samples.push({ v: -4.0, weight: 1, dispersion: 0.6, vPerp: 1.2, depthCm: 11 }); // vena contracta
    for (let i = 0; i < 8; i++)
      samples.push({ v: -3.0, weight: 1, dispersion: 0.6, vPerp: 1.0, depthCm: 12 }); // decaying jet
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
    return Array.from({ length: n }, (_, c) => ({
      phase: st.phase[c]!,
      col: st.data!.subarray(c * SPECTRAL_BINS, (c + 1) * SPECTRAL_BINS),
    }));
  };
  const aim = (control: ReturnType<typeof canonicalControl>, target: Vec3) => {
    const beam = beamFrameFromPose(poseFromControl(thorax, control));
    const d = sub(target, beam.origin);
    const depth = dot(d, beam.forward);
    const lateral = dot(d, beam.lateral);
    const theta = Math.atan2(lateral, depth);
    const dir = v3(
      beam.forward.x * Math.cos(theta) + beam.lateral.x * Math.sin(theta),
      beam.forward.y * Math.cos(theta) + beam.lateral.y * Math.sin(theta),
      beam.forward.z * Math.cos(theta) + beam.lateral.z * Math.sin(theta),
    );
    const f = heart.frame;
    return {
      beam,
      theta,
      r: Math.hypot(depth, lateral),
      dirHeart: { x: dot(dir, f.ex), y: dot(dir, f.ey), z: dot(dir, f.ez) },
    };
  };

  it(
    'through the core: PW at the mitral tips, its auto-trace and tissue Doppler at the septal base read the velocity at the gate',
    { timeout: 120_000 },
    () => {
      const t = tables.timings;
      const inE = (phase: number) =>
        phase * tables.rrS > t.mitralOpenS && phase * tables.rrS < t.aStartS;
      const a4c = canonicalControl(getViewTarget('a4c'), heart, thorax);
      const fs = { vx: 0, vy: 0, vz: 0, dispersion: 0, present: 0 };
      // mitral inflow, 1 cm apical of the valve landmark
      const tips = v3(0.2, -0.9, 1.7);
      const pw = aim(a4c, heartToTorso(heart.frame, tips));
      const spectral = { ...DEFAULT_SPECTRAL, scaleMps: 1.2 };
      const core = new SimulatorCore(
        c,
        baseInput({
          probe: a4c,
          modality: 'pw',
          quality: 'low',
          cursorThetaRad: pw.theta,
          gateDepthCm: pw.r,
          spectral,
        }),
      );
      const cols = strip(core, 2.2);
      let truth = 0,
        edge = 0,
        traced = 0;
      const trace = core.request({ kind: 'autoTrace', x0: 0, x1: cols.length - 1 });
      expect(trace?.kind).toBe('autoTrace');
      cols.forEach(({ phase, col }, x) => {
        if (!inE(phase)) return;
        sampleFlow(
          flow,
          tables,
          computeHeartPose(heart, cycleStateAt(tables, phase)),
          phase,
          tips.x,
          tips.y,
          tips.z,
          fs,
        );
        truth = Math.max(
          truth,
          -(fs.vx * pw.dirHeart.x + fs.vy * pw.dirHeart.y + fs.vz * pw.dirHeart.z),
        );
        edge = Math.max(edge, outerEdge(col, spectral, 1));
        traced = Math.max(traced, trace!.kind === 'autoTrace' ? (trace!.velocitiesMps[x] ?? 0) : 0);
      });
      // before: the edge read 1.30× the flow and the auto-trace stopped at the gap the wall filter leaves under the envelope
      expect(truth).toBeGreaterThan(0.6);
      expect(
        [edge / truth, traced / truth].map((q) => q > 0.97 && q < 1.08),
        `E: flow ${truth.toFixed(3)}, edge ${edge.toFixed(3)}, auto-trace ${traced.toFixed(3)}`,
      ).toEqual([true, true]);

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
      const tdiCore = new SimulatorCore(
        c,
        baseInput({
          probe: a4c,
          modality: 'tdi',
          quality: 'low',
          cursorThetaRad: tdi.theta,
          gateDepthCm: tdi.r,
          spectral: tdiSpectral,
        }),
      );
      let ePrime = 0,
        ePrimeEdge = 0;
      for (const { phase, col } of strip(tdiCore, 2.2)) {
        if (!inE(phase)) continue;
        const tv = sampleTissueVelocity(heart, tables, phase, septum.x, septum.y, septum.z);
        ePrime = Math.min(
          ePrime,
          -(tv.vx * tdi.dirHeart.x + tv.vy * tdi.dirHeart.y + tv.vz * tdi.dirHeart.z),
        );
        ePrimeEdge = Math.min(ePrimeEdge, outerEdge(col, tdiSpectral, -1));
      }
      // before: 1.57× the tissue velocity
      expect(ePrime).toBeLessThan(-0.06);
      expect(
        ePrimeEdge / ePrime,
        `e′: tissue ${ePrime.toFixed(3)}, edge ${ePrimeEdge.toFixed(3)}`,
      ).toBeGreaterThan(0.97);
      expect(ePrimeEdge / ePrime).toBeLessThan(1.1);
    },
  );

  it('tissue Doppler moves each wall by its own e′: the lateral wall by the case lateral over septal e′ (decision 98)', () => {
    const r = heart.physiology.ePrimeLateralCmps / heart.physiology.ePrimeSeptalCmps;
    const phase = (tables.timings.mitralOpenS + 0.05) / tables.rrS;
    const at = (x: number, y: number) => sampleTissueVelocity(heart, tables, phase, x, y, 1).vz;
    expect(at(-2, 0)).not.toBe(0);
    expect(at(2, 0) / at(-2, 0)).toBeCloseTo(r, 6);
    expect(at(0, 2) / at(-2, 0)).toBeCloseTo((1 + r) / 2, 6);
  });

  it(
    'through the core: tissue Doppler reads the lateral e′ above the septal one as the case does (decision 98)',
    { timeout: 180_000 },
    () => {
      const results: string[] = [];
      for (const id of ['normal-excellent-window', 'af-diastolic']) {
        const tc = loadCaseById(id);
        const m = new SimulatorCore(tc, baseInput()).models;
        const t = m.tables.timings;
        const a4c = canonicalControl(getViewTarget('a4c'), m.heart, m.thorax);
        const beam = beamFrameFromPose(poseFromControl(m.thorax, a4c));
        const q = { tissue: 0 } as unknown as TissueSample;
        const hp0 = computeHeartPose(m.heart, cycleStateAt(m.tables, 0));
        const read = (sign: 1 | -1) => {
          // basal myocardium 1 cm from the annulus, walking out from the cavity toward the wall
          let first = NaN,
            last = NaN;
          for (let x = 0.5 * sign; Math.abs(x) < 5; x += 0.05 * sign)
            if (classifyHeart(m.heart, hp0, x, 0, 1.0, q) && q.tissue === Tissue.Myocardium) {
              if (Number.isNaN(first)) first = x;
              last = x;
            } else if (!Number.isNaN(first)) break;
          const p = v3((first + last) / 2, 0, 1.0);
          const d = sub(heartToTorso(m.heart.frame, p), beam.origin);
          const theta = Math.atan2(dot(d, beam.lateral), dot(d, beam.forward));
          const dir = v3(
            beam.forward.x * Math.cos(theta) + beam.lateral.x * Math.sin(theta),
            beam.forward.y * Math.cos(theta) + beam.lateral.y * Math.sin(theta),
            beam.forward.z * Math.cos(theta) + beam.lateral.z * Math.sin(theta),
          );
          const spectral = { ...DEFAULT_SPECTRAL, scaleMps: 0.25, wallFilterMps: 0.01 };
          const core = new SimulatorCore(
            tc,
            baseInput({
              probe: a4c,
              modality: 'tdi',
              quality: 'low',
              cursorThetaRad: theta,
              gateDepthCm: Math.hypot(dot(d, beam.forward), dot(d, beam.lateral)),
              spectral,
            }),
          );
          let e = 0;
          for (const { phase, col } of strip(core, 2.2))
            if (
              phase * m.tables.rrS > t.mitralOpenS &&
              (!t.hasAWave || phase * m.tables.rrS < t.aStartS)
            )
              e = Math.min(e, outerEdge(col, spectral, -1));
          return {
            e: -e,
            cos: Math.abs(dot(dir, m.heart.frame.ez)),
            level: 1 - p.z / m.heart.lv.lengthCm,
          };
        };
        const sep = read(-1),
          lat = read(1);
        const expectedRatio =
          (tc.physiology.ePrimeLateralCmps * lat.cos) / (tc.physiology.ePrimeSeptalCmps * sep.cos);
        const ratio = lat.e / sep.e;
        // before: every wall moved alike and the lateral annulus read 0.88 of the septal one in the normal case
        if (Math.abs(ratio / expectedRatio - 1) > 0.1)
          results.push(
            `${id}: lateral/septal e′ ${ratio.toFixed(3)} against ${expectedRatio.toFixed(3)}`,
          );
        if (id === 'normal-excellent-window') {
          const q2 = lat.e / ((tc.physiology.ePrimeLateralCmps / 100) * lat.cos * lat.level);
          if (!(q2 > 0.95 && q2 < 1.12))
            results.push(
              `${id}: lateral e′ ${lat.e.toFixed(4)} m/s is ${q2.toFixed(3)} of the case value projected`,
            );
        }
      }
      expect(results).toEqual([]);
    },
  );

  it(
    'through the core: in tamponade the fused mitral inflow reads the E the case asks to measure (decision 97)',
    { timeout: 120_000 },
    () => {
      const tc = loadCaseById('pericardial-effusion-tamponade');
      const m = new SimulatorCore(tc, baseInput()).models;
      const t = m.tables.timings;
      const ctrl = canonicalControl(getViewTarget('a4c'), m.heart, m.thorax);
      const beam = beamFrameFromPose(poseFromControl(m.thorax, ctrl));
      const tips = v3(0.2, -0.9, 1.7);
      const d = sub(heartToTorso(m.heart.frame, tips), beam.origin);
      const depth = dot(d, beam.forward),
        lateral = dot(d, beam.lateral);
      const theta = Math.atan2(lateral, depth);
      const dir = v3(
        beam.forward.x * Math.cos(theta) + beam.lateral.x * Math.sin(theta),
        beam.forward.y * Math.cos(theta) + beam.lateral.y * Math.sin(theta),
        beam.forward.z * Math.cos(theta) + beam.lateral.z * Math.sin(theta),
      );
      const f = m.heart.frame;
      const cosine = Math.abs(dot(dir, f.ez));
      const spectral = { ...DEFAULT_SPECTRAL, scaleMps: 1.2 };
      const core = new SimulatorCore(
        tc,
        baseInput({
          probe: ctrl,
          modality: 'pw',
          quality: 'low',
          cursorThetaRad: theta,
          gateDepthCm: Math.hypot(depth, lateral),
          spectral,
        }),
      );
      let peak = 0;
      for (const { phase, col } of strip(core, 2.2))
        if (phase * m.tables.rrS > t.mitralOpenS)
          peak = Math.max(peak, outerEdge(col, spectral, 1));
      // before: the E and A waves added in full and the single diastolic wave peaked at 1.05 m/s for an E of 0.75
      const expected = tc.physiology.ePeakMps * cosine;
      expect(
        peak / expected,
        `diastolic peak ${peak.toFixed(3)} m/s against E·cos ${expected.toFixed(3)}`,
      ).toBeGreaterThan(0.97);
      expect(peak / expected).toBeLessThan(1.08);
    },
  );

  it(
    'through the core: CW aimed through a stenotic aortic jet from the apex draws the jet at its speed',
    { timeout: 120_000 },
    () => {
      const as = loadCaseById('aortic-stenosis-moderate');
      const probe = new SimulatorCore(as, baseInput());
      const m = probe.models;
      const t = m.tables.timings;
      const f = buildFlowParams(as, m.heart, m.tables);
      const peak = (t.ejectionStartS + 0.35 * (t.ejectionEndS - t.ejectionStartS)) / m.tables.rrS;
      const hpPeak = computeHeartPose(m.heart, cycleStateAt(m.tables, peak));
      // vena contracta, 0.5 cm along the valve axis
      const vc = v3(
        f.avCenter.x + 0.5 * f.avAxis.x,
        f.avCenter.y + 0.5 * f.avAxis.y,
        f.avCenter.z + hpPeak.zAnn * ROOT_EXCURSION + 0.5 * f.avAxis.z,
      );
      const a5c = canonicalControl(getViewTarget('a5c'), m.heart, m.thorax);
      const ctrl = controlAimingAt(
        m.thorax,
        a5c.u,
        a5c.v,
        heartToTorso(m.heart.frame, vc),
        canonicalPlane(getViewTarget('a5c'), m.heart).right,
        a5c.pressure,
      );
      const beam = beamFrameFromPose(poseFromControl(m.thorax, ctrl));
      const fr = m.heart.frame;
      const dh = {
        x: dot(beam.forward, fr.ex),
        y: dot(beam.forward, fr.ey),
        z: dot(beam.forward, fr.ez),
      };
      const spectral = { ...DEFAULT_SPECTRAL, scaleMps: 5 };
      const core = new SimulatorCore(
        as,
        baseInput({
          probe: ctrl,
          modality: 'cw',
          quality: 'low',
          cursorThetaRad: 0,
          gateDepthCm: 10,
          spectral,
        }),
      );
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
          const p = v3(
            beam.origin.x + beam.forward.x * r - fr.origin.x,
            beam.origin.y + beam.forward.y * r - fr.origin.y,
            beam.origin.z + beam.forward.z * r - fr.origin.z,
          );
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
      expect(edge / jet, `jet ${jet.toFixed(2)} m/s, edge ${edge.toFixed(2)}`).toBeGreaterThan(
        0.97,
      );
      expect(edge / jet).toBeLessThan(1.08);
    },
  );
});

describe('the early filling wave travels toward the apex at the colour M-mode Vp of the case (decision 102)', () => {
  it('the conventional slope, half the maximal inflow velocity from the leaflet tips to 4 cm beyond them, reads 6·e′ septal in every case', async () => {
    // Nagueh et al. 2009: Vp is the slope of the first aliasing velocity of early filling from the mitral plane to 4 cm into
    // the ventricle, normal above 50 cm/s; the aliasing boundary is typically half the maximal inflow velocity. Before: the
    // core had lost half its velocity before 4 cm in every case (10–15 of 17 depths reached) and the whole jet appeared at
    // once, so the partial slopes read 78 cm/s in heart failure against 66 in the normal heart, and 5–14 cm/s where only
    // atrial filling crossed the contour.
    const { CASE_INPUTS } = await import('@/cases');
    const { flowPropagationCmps } = await import('./flow-primitives/flowField');
    const fs = { vx: 0, vy: 0, vz: 0, dispersion: 0, present: 0 };
    const problems: string[] = [];
    const reads: Record<string, number> = {};
    for (const input of CASE_INPUTS) {
      const k = loadCaseById(input.id);
      const models = new SimulatorCore(k, baseInput()).models;
      const p = buildFlowParams(k, models.heart, models.tables);
      const tb = models.tables;
      const tm = tb.timings;
      const poses = new Map<number, ReturnType<typeof computeHeartPose>>();
      // the inflow axis at a fixed heart-frame position, sampled every millisecond as a colour M-mode line through it
      const velocity = (z: number, ms: number): number => {
        let hp = poses.get(ms);
        if (!hp) {
          hp = computeHeartPose(models.heart, cycleStateAt(tb, ms / 1000 / tb.rrS));
          poses.set(ms, hp);
        }
        sampleFlow(p, tb, hp, ms / 1000 / tb.rrS, p.mvCenter.x, p.mvCenter.y, z, fs);
        return fs.vz;
      };
      const t0 = Math.ceil(tm.mitralOpenS * 1000);
      const earlyEnd = Math.floor(
        1000 *
          Math.min(
            tb.rrS,
            tm.mitralOpenS + 0.5,
            tm.hasAWave ? Math.max(tm.aStartS, tm.mitralOpenS + tm.eAccelS + 0.05) : Infinity,
          ),
      );
      const tips = computeHeartPose(models.heart, cycleStateAt(tb, t0 / 1000 / tb.rrS)).zAnn + 1.2;
      let vMax = 0;
      for (let ms = t0; ms < earlyEnd; ms++) vMax = Math.max(vMax, velocity(tips, ms));
      const pts: [number, number][] = [];
      for (let d = 0; d <= 4.0001; d += 0.25)
        for (let ms = t0; ms < tb.rrS * 1000; ms++)
          if (velocity(tips + d, ms) >= 0.5 * vMax) {
            pts.push([ms / 1000, d]);
            break;
          }
      if (pts.length < 17) {
        problems.push(
          `${input.id}: half the maximal inflow velocity reaches ${pts.length} of 17 depths`,
        );
        continue;
      }
      let st = 0,
        sd = 0,
        stt = 0,
        std = 0;
      for (const [t, d] of pts) {
        st += t;
        sd += d;
        stt += t * t;
        std += t * d;
      }
      const slope = (17 * std - st * sd) / (17 * stt - st * st);
      reads[input.id] = slope;
      const target = flowPropagationCmps(k);
      if (Math.abs(slope - target) > 0.1 * target)
        problems.push(`${input.id}: Vp ${slope.toFixed(1)} cm/s against ${target} (6·e′ septal)`);
    }
    expect(problems).toEqual([]);
    // normal relaxation above the 50 cm/s cut-off, impaired relaxation (septal e′ ≤ 6 cm/s) below it
    expect(reads['normal-excellent-window']!).toBeGreaterThan(50);
    expect(reads['hfref-severe-mr']!).toBeLessThan(reads['aortic-stenosis-moderate']!);
    for (const id of [
      'hfref-severe-mr',
      'inferior-rwma',
      'aortic-stenosis-moderate',
      'aortic-stenosis-severe',
      'hocm-sam',
      'af-diastolic',
    ])
      expect(reads[id]!, id).toBeLessThan(45);
  });
});

describe('valve clicks mark valve timing on the spectral trace (decision 103)', () => {
  /** Strip columns after `seconds` of `core`, with their time in the beat. */
  const columns = (core: SimulatorCore, seconds: number, rr: number) => {
    for (let t = 0; t < seconds; t += 0.02) core.step(0.02);
    const st = core.spectralStrip;
    const n = Math.min(st.head, st.cols);
    return Array.from({ length: n }, (_, c) => ({
      t: st.phase[c]! * rr,
      col: st.data!.subarray(c * SPECTRAL_BINS, (c + 1) * SPECTRAL_BINS),
    }));
  };
  /** Times (s in the beat) of the clicks: runs of click columns (`isClickColumn`). */
  const clickTimes = (cols: { t: number; col: Float32Array }[], s: SpectralSettings): number[] => {
    const broad = cols.map(({ col }) => isClickColumn(col, s));
    const times: number[] = [];
    for (let c = 0; c < cols.length; c++) {
      if (!broad[c] || (c > 0 && broad[c - 1])) continue;
      let e = c;
      while (e + 1 < cols.length && broad[e + 1]) e++;
      times.push(cols[(c + e) >> 1]!.t);
    }
    return times;
  };
  const nearest = (times: number[], event: number, rr: number) =>
    Math.min(...times.map((t) => Math.min(Math.abs(t - event), rr - Math.abs(t - event))));

  it(
    'through the core: PW at the mitral tips clicks as the mitral valve opens and closes, and between outflow and inflow the clicks bound the isovolumic relaxation time',
    { timeout: 180_000 },
    () => {
      const ev = valveEventTimes(tables);
      const rr = tables.rrS;
      const s = { ...DEFAULT_SPECTRAL, scaleMps: 1.2 };
      const A = heartAnchors(heart);
      const run = (view: 'a4c' | 'a5c', p: Vec3) => {
        const control = canonicalControl(getViewTarget(view), heart, thorax);
        const beam = beamFrameFromPose(poseFromControl(thorax, control));
        const d = sub(heartToTorso(heart.frame, p), beam.origin);
        const core = new SimulatorCore(
          c,
          baseInput({
            probe: control,
            modality: 'pw',
            quality: 'low',
            cursorThetaRad: Math.atan2(dot(d, beam.lateral), dot(d, beam.forward)),
            gateDepthCm: Math.hypot(dot(d, beam.forward), dot(d, beam.lateral)),
            spectral: s,
          }),
        );
        return clickTimes(columns(core, 3.2, rr), s);
      };
      // before: no column of either strip was bright across the scale
      const tips = run('a4c', v3(0.2, -0.9, 1.7));
      expect(
        tips.length,
        `mitral tips clicks at ${tips.map((t) => (t * 1000).toFixed(0)).join(', ')} ms`,
      ).toBeGreaterThanOrEqual(2);
      expect(nearest(tips, ev.mitral[0], rr)).toBeLessThan(0.008);
      expect(nearest(tips, ev.mitral[1], rr)).toBeLessThan(0.008);
      // the aortic valve is 2–3 cm away: its events leave no click there
      for (const t of tips)
        expect(
          Math.min(nearest([t], ev.aortic[0], rr), nearest([t], ev.aortic[1], rr)),
          `click at ${(t * 1000).toFixed(0)} ms`,
        ).toBeGreaterThan(0.02);
      const between = run(
        'a5c',
        v3((A.avCenter.x + A.mvCenter.x) / 2, (A.avCenter.y + A.mvCenter.y) / 2, 1.0),
      );
      const closure = between.filter((t) => nearest([t], ev.aortic[1], rr) < 0.008);
      const opening = between.filter((t) => nearest([t], ev.mitral[0], rr) < 0.008);
      expect(
        [closure.length > 0, opening.length > 0],
        `clicks at ${between.map((t) => (t * 1000).toFixed(0)).join(', ')} ms`,
      ).toEqual([true, true]);
      const ivrtMs = (opening[0]! - closure[0]!) * 1000;
      expect(
        Math.abs(ivrtMs - c.physiology.ivrtMs),
        `IVRT between clicks ${ivrtMs.toFixed(0)} ms, case ${c.physiology.ivrtMs}`,
      ).toBeLessThan(8);
    },
  );
});

describe('the right ventricle ejects with the acceleration time of its pulmonary pressure (decision 105)', () => {
  it(
    'through the core: PW in the outflow tract from the short axis reads the acceleration time the case pressure predicts',
    { timeout: 240_000 },
    async () => {
      const { pulmonaryAccelerationTimeS, meanPulmonaryPressureMmHg } =
        await import('@/simulator/cardiac-cycle/cycleModel');
      const results: string[] = [];
      const read: Record<string, number> = {};
      for (const id of [
        'normal-excellent-window',
        'pulmonary-hypertension-rv',
        'hfref-severe-mr',
      ]) {
        const k = loadCaseById(id);
        const m = new SimulatorCore(k, baseInput()).models;
        const A = heartAnchors(m.heart);
        // 5 mm proximal to the pulmonary valve
        const L = Math.hypot(A.rvotB.x - A.rvotA.x, A.rvotB.y - A.rvotA.y, A.rvotB.z - A.rvotA.z);
        const gate = v3(
          A.rvotB.x - ((A.rvotB.x - A.rvotA.x) / L) * 0.5,
          A.rvotB.y - ((A.rvotB.y - A.rvotA.y) / L) * 0.5,
          A.rvotB.z - ((A.rvotB.z - A.rvotA.z) / L) * 0.5,
        );
        // Sampled from the PLAX space: the great-vessel preset climbs a space for the section perpendicular to the root
        // (decision 133), from where the beam meets the distal outflow at 80° (0.17 of the velocity) instead of 72°:
        // too little signal for the envelope. A sonographer angles for the flow, not for the section.
        const plane = canonicalPlane(getViewTarget('psax-av'), m.heart);
        const skin = snapToIntercostal(m.thorax, 2.6, 1.6);
        const control = controlAimingAt(m.thorax, skin.u, skin.v, plane.target, plane.right, 0.6);
        const beam = beamFrameFromPose(poseFromControl(m.thorax, control));
        const d = sub(heartToTorso(m.heart.frame, gate), beam.origin);
        const s = { ...DEFAULT_SPECTRAL, scaleMps: 1.2 };
        const core = new SimulatorCore(
          k,
          baseInput({
            probe: control,
            modality: 'pw',
            quality: 'low',
            display: { width: 640, height: 480 },
            cursorThetaRad: Math.atan2(dot(d, beam.lateral), dot(d, beam.forward)),
            gateDepthCm: Math.hypot(dot(d, beam.forward), dot(d, beam.lateral)),
            spectral: s,
          }),
        );
        for (let t = 0; t < 3.2; t += 0.02) core.step(0.02);
        const st = core.spectralStrip;
        const n = Math.min(st.head, st.cols);
        const trace = core.request({ kind: 'autoTrace', x0: 0, x1: n - 1 });
        const vel = trace?.kind === 'autoTrace' ? trace.velocitiesMps : [];
        // the auto-trace in time order, each column at its own instant (the strip wraps at its head)
        const head = st.head % st.cols;
        const order = Array.from({ length: n }, (_, j) => (n < st.cols ? j : (head + j) % st.cols));
        const rr = m.tables.rrS;
        const times: number[] = [];
        let beats = 0;
        for (let j = 0; j < n; j++) {
          const t = st.phase[order[j]!]! * rr;
          if (j && t + beats * rr < times[j - 1]! - rr / 2) beats++;
          times.push(t + beats * rr);
        }
        const speed = order.map((x) => Math.abs(vel[x] ?? 0));
        // each ejection: from the first column above a tenth of its peak to the centre of the columns within 3% of it
        const ats: number[] = [];
        for (let j = 0, c0 = -1; j <= n; j++) {
          const on = j < n && speed[j]! > 0.1;
          if (on && c0 < 0) c0 = j;
          if (!on && c0 >= 0) {
            if (times[j - 1]! - times[c0]! > 0.12) {
              let pk = c0;
              for (let q = c0; q < j; q++) if (speed[q]! > speed[pk]!) pk = q;
              let onset = c0;
              while (speed[onset]! < 0.1 * speed[pk]!) onset++;
              let w = 0,
                sum = 0;
              for (let q = c0; q < j; q++)
                if (speed[q]! >= 0.97 * speed[pk]!) {
                  w++;
                  sum += times[q]!;
                }
              ats.push((sum / w - times[onset]!) * 1000);
            }
            c0 = -1;
          }
        }
        const predicted =
          pulmonaryAccelerationTimeS(meanPulmonaryPressureMmHg(k.hemodynamics.paspMmHg)) * 1000;
        const mean = ats.reduce((a, b) => a + b, 0) / Math.max(1, ats.length);
        read[id] = mean;
        // before: the right ventricle copied the aortic ejection, 119–121 ms in the normal heart and 104–114 ms at 72 mmHg
        if (ats.length < 2 || Math.abs(mean - predicted) > 15)
          results.push(
            `${id}: acceleration time ${ats.map((a) => a.toFixed(0)).join(', ')} ms against ${predicted.toFixed(0)} ms predicted`,
          );
      }
      expect(results).toEqual([]);
      // below 105 ms the outflow Doppler suggests pulmonary hypertension (normal 136–153 ms)
      expect(read['pulmonary-hypertension-rv']!).toBeLessThan(100);
      expect(read['normal-excellent-window']!).toBeGreaterThan(120);
    },
  );
});

describe('right ventricular tissue Doppler reads the tricuspid annulus of the case (decision 106)', () => {
  it(
    'through the core: TDI at the free wall 1 cm from the tricuspid annulus reads the case S′ at its angle and level',
    { timeout: 180_000 },
    () => {
      const results: string[] = [];
      for (const id of ['normal-excellent-window', 'pulmonary-hypertension-rv']) {
        const k = loadCaseById(id);
        const m = new SimulatorCore(k, baseInput()).models;
        const A = heartAnchors(m.heart);
        const t = m.tables.timings;
        const hp0 = computeHeartPose(m.heart, cycleStateAt(m.tables, 0));
        const q = { tissue: 0, structure: 0 } as unknown as TissueSample;
        // free wall myocardium 1 cm apical to the tricuspid annulus, walking out from the orifice centre
        const z = A.tvCenter.z + hp0.tvZ + 1.0;
        let first = NaN,
          last = NaN;
        for (let x = A.tvCenter.x; x > A.tvCenter.x - 5; x -= 0.02)
          if (
            classifyHeart(m.heart, hp0, x, A.tvCenter.y, z, q) &&
            q.tissue === Tissue.Myocardium
          ) {
            if (Number.isNaN(first)) first = x;
            last = x;
          } else if (!Number.isNaN(first)) break;
        const p = v3((first + last) / 2, A.tvCenter.y, z);
        const control = canonicalControl(getViewTarget('a4c'), m.heart, m.thorax);
        const beam = beamFrameFromPose(poseFromControl(m.thorax, control));
        const d = sub(heartToTorso(m.heart.frame, p), beam.origin);
        const theta = Math.atan2(dot(d, beam.lateral), dot(d, beam.forward));
        const dir = v3(
          beam.forward.x * Math.cos(theta) + beam.lateral.x * Math.sin(theta),
          beam.forward.y * Math.cos(theta) + beam.lateral.y * Math.sin(theta),
          beam.forward.z * Math.cos(theta) + beam.lateral.z * Math.sin(theta),
        );
        const spectral = { ...DEFAULT_SPECTRAL, scaleMps: 0.25, wallFilterMps: 0.01 };
        const core = new SimulatorCore(
          k,
          baseInput({
            probe: control,
            modality: 'tdi',
            quality: 'low',
            cursorThetaRad: theta,
            gateDepthCm: Math.hypot(dot(d, beam.forward), dot(d, beam.lateral)),
            spectral,
          }),
        );
        for (let s = 0; s < 2.4; s += 0.02) core.step(0.02);
        const st = core.spectralStrip;
        let sPrime = 0;
        for (let x = 0; x < Math.min(st.head, st.cols); x++) {
          const ti = st.phase[x]! * m.tables.rrS;
          if (ti >= t.ejectionStartS && ti <= t.ejectionEndS)
            sPrime = Math.max(
              sPrime,
              outerEdge(st.data!.subarray(x * SPECTRAL_BINS, (x + 1) * SPECTRAL_BINS), spectral, 1),
            );
        }
        const rvLevel = (p.z - A.tvCenter.z) / (A.rvApexFrac * m.heart.lv.lengthCm - A.tvCenter.z);
        const expected =
          (k.physiology.sPrimeTricuspidCmps / 100) *
          Math.abs(dot(dir, m.heart.frame.ez)) *
          (1 - rvLevel);
        // before: the free wall moved with the left ventricular curve and MAPSE, 5.3 cm/s in the normal heart for 9.9 expected
        if (!(sPrime / expected > 0.95 && sPrime / expected < 1.15))
          results.push(
            `${id}: S′ ${(sPrime * 100).toFixed(1)} cm/s against ${(expected * 100).toFixed(1)} expected`,
          );
      }
      expect(results).toEqual([]);
    },
  );
});

describe('the spectral display is an estimate with its granular texture (decision 115)', () => {
  const s = { ...DEFAULT_SPECTRAL, scaleMps: 1.2 };
  const { vMin, vMax } = spectralRange(s);
  const bin = (v: number) => Math.floor(((vMax - v) / (vMax - vMin)) * SPECTRAL_BINS);
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const std = (a: number[]) => Math.sqrt(mean(a.map((x) => (x - mean(a)) ** 2)));
  const corr = (a: number[], b: number[]) => {
    const ma = mean(a),
      mb = mean(b);
    let num = 0,
      da = 0,
      db = 0;
    for (let i = 0; i < a.length; i++) {
      num += (a[i]! - ma) * (b[i]! - mb);
      da += (a[i]! - ma) ** 2;
      db += (b[i]! - mb) ** 2;
    }
    return num / Math.sqrt(da * db + 1e-12);
  };
  // the columns the screen shows, 4 ms apart as the strip draws them at 50 mm/s
  const strip = (samples: VelocitySample[]) =>
    Array.from({ length: 400 }, (_, k) => {
      const envelope = new Float32Array(SPECTRAL_BINS);
      const display = new Float32Array(SPECTRAL_BINS);
      buildSpectralColumn(samples, s, k, 11, true, envelope, 0, display, k * 0.004);
      return display;
    });

  it('a steady laminar flow is a textured band below saturation whose grain lasts about one estimate and one resolution cell', () => {
    // The screen showed the expected spectrum, normalised and compressed nearly linearly: a steady 0.8 m/s flow drew a white
    // band saturated at 1.00 in every column (standard deviation 0.000), and the noise floor was independent from column
    // to column (correlation 0.03). A spectrum estimated from a finite run of echoes has exponential statistics per
    // frequency, correlated over the frequency resolution and the duration of the estimate, and it is shown on a
    // logarithmic scale.
    const cols = strip(
      Array.from({ length: 20 }, (_, i) => ({
        v: 0.8 + 0.02 * Math.sin(i * 1.7),
        weight: 1,
        dispersion: 0.05,
      })),
    );
    const b = bin(0.8);
    const centre = cols.map((c) => c[b]!);
    const report = `mean ${mean(centre).toFixed(3)} std ${std(centre).toFixed(3)} lag-1 column ${corr(centre.slice(1), centre.slice(0, -1)).toFixed(2)} neighbour bin ${corr(
      centre,
      cols.map((c) => c[b + 1]!),
    ).toFixed(2)}`;
    expect(mean(centre), report).toBeGreaterThan(0.6);
    expect(mean(centre), report).toBeLessThan(0.92);
    expect(std(centre), report).toBeGreaterThan(0.07);
    expect(std(centre), report).toBeLessThan(0.2);
    expect(corr(centre.slice(1), centre.slice(0, -1)), report).toBeGreaterThan(0.5);
    // adjacent frequencies of a periodogram through a Hann window correlate about 0.25
    expect(
      corr(
        centre,
        cols.map((c) => c[b + 1]!),
      ),
      report,
    ).toBeGreaterThan(0.2);
    expect(centre.filter((x) => x >= 0.999).length / centre.length, report).toBeLessThan(0.25);
  });

  it('the noise floor is dark with sparse grain of the same duration', () => {
    const cols = strip([]);
    const values = cols.flatMap((c) => Array.from(c.slice(10, 50))).sort((a, b) => a - b);
    const series = cols.map((c) => c[30]!);
    const p99 = values[Math.floor(0.99 * values.length)]!;
    const report = `mean ${mean(values).toFixed(3)} p99 ${p99.toFixed(3)} lag-1 column ${corr(series.slice(1), series.slice(0, -1)).toFixed(2)}`;
    expect(mean(values), report).toBeLessThan(0.1);
    expect(p99, report).toBeGreaterThan(0.08);
    expect(p99, report).toBeLessThan(0.45);
    expect(corr(series.slice(1), series.slice(0, -1)), report).toBeGreaterThan(0.5);
  });

  it(
    'through the core the screen shows the estimate, and the envelope reads the expected spectrum of the same columns',
    { timeout: 180_000 },
    () => {
      const a4c = canonicalControl(getViewTarget('a4c'), heart, thorax);
      const beam = beamFrameFromPose(poseFromControl(thorax, a4c));
      const d = sub(heartToTorso(heart.frame, v3(0.2, -0.9, 1.7)), beam.origin);
      const core = new SimulatorCore(
        c,
        baseInput({
          probe: a4c,
          modality: 'pw',
          quality: 'low',
          display: { width: 640, height: 480 },
          cursorThetaRad: Math.atan2(dot(d, beam.lateral), dot(d, beam.forward)),
          gateDepthCm: Math.hypot(dot(d, beam.forward), dot(d, beam.lateral)),
          spectral: s,
        }),
      );
      let out: ReturnType<SimulatorCore['step']> = null;
      for (let t = 0; t < 1.5; t += 0.02) out = core.step(0.02) ?? out;
      const st = core.spectralStrip;
      const n = Math.min(st.head, st.cols);
      // where the envelope column holds flow, the envelope saturates as decision 96 drew it and the screen does not
      let flow = 0,
        saturatedRead = 0,
        saturatedShown = 0;
      for (let x = 0; x < n; x++)
        for (let b = 0; b < SPECTRAL_BINS; b++)
          if (st.data![x * SPECTRAL_BINS + b]! > 0.8) {
            flow++;
            if (st.data![x * SPECTRAL_BINS + b]! >= 0.999) saturatedRead++;
            if (st.display![x * SPECTRAL_BINS + b]! >= 0.999) saturatedShown++;
          }
      const report = `${flow} flow bins, saturated ${((saturatedRead / flow) * 100).toFixed(0)}% read and ${((saturatedShown / flow) * 100).toFixed(0)}% shown`;
      expect(flow, report).toBeGreaterThan(200);
      expect(saturatedShown / flow, report).toBeLessThan(0.5 * (saturatedRead / flow));
      // and the composite image draws the screen column
      const img = new Uint8ClampedArray(out!.rgba);
      const strip = out!.strip;
      let checked = 0,
        mismatched = 0;
      for (let x = 0; x < Math.min(n, strip.width); x += 7)
        for (let y = 0; y < strip.height; y += 5) {
          const b = Math.min(SPECTRAL_BINS - 1, Math.floor((y / strip.height) * SPECTRAL_BINS));
          const expected = Math.round(Math.min(1, st.display![x * SPECTRAL_BINS + b]!) * 255);
          const red = img[((strip.y + y) * out!.width + strip.x + x) * 4]!;
          checked++;
          if (Math.abs(red - expected) > 1 && red !== 90) mismatched++;
        }
      expect(checked).toBeGreaterThan(100);
      expect(mismatched / checked).toBeLessThan(0.05);
    },
  );
});
