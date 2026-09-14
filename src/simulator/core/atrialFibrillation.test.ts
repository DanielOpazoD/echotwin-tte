import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { SimulatorCore } from './simulatorCore';
import { baseInput } from './baseInput';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import { heartAnchors, heartToTorso } from '@/simulator/anatomy/heartModel';
import { DEFAULT_SPECTRAL } from '@/simulator/doppler/spectral/spectrum';
import { ejectionTimeS } from '@/simulator/cardiac-cycle/timing';
import { dot, sub, v3, type Vec3 } from '@/core/vec3';

/**
 * Atrial fibrillation beat by beat through the core (decision 107): the pulsed Doppler auto-trace of the app, in time
 * order, split into beats at the phase wraps of its columns.
 */
describe('atrial fibrillation beat by beat (decision 107)', () => {
  const c = loadCaseById('af-diastolic');
  const models = new SimulatorCore(c, baseInput()).models;
  const A = heartAnchors(models.heart);

  type Beat = { rr: number; cols: { t: number; v: number }[] };
  const beats = (view: 'a4c' | 'a5c', gate: Vec3, seconds: number): Beat[] => {
    const control = canonicalControl(getViewTarget(view), models.heart, models.thorax);
    const beam = beamFrameFromPose(poseFromControl(models.thorax, control));
    const d = sub(heartToTorso(models.heart.frame, gate), beam.origin);
    const spectral = { ...DEFAULT_SPECTRAL, scaleMps: 1.2, sweepSpeedMmPerS: 25 };
    const core = new SimulatorCore(c, baseInput({ probe: control, modality: 'pw', quality: 'low', display: { width: 640, height: 480 }, cursorThetaRad: Math.atan2(dot(d, beam.lateral), dot(d, beam.forward)), gateDepthCm: Math.hypot(dot(d, beam.forward), dot(d, beam.lateral)), spectral }));
    const cols: { t: number; ph: number; v: number }[] = [];
    let now = 0;
    // the strip shows 4 s: read it before it wraps
    for (let snap = 0; snap < Math.ceil(seconds / 3.8); snap++) {
      for (let s = 0; s < 3.8; s += 0.02) {
        core.step(0.02);
        now += 0.02;
      }
      const st = core.spectralStrip;
      const n = Math.min(st.head, st.cols);
      const trace = core.request({ kind: 'autoTrace', x0: 0, x1: n - 1 });
      const vel = trace?.kind === 'autoTrace' ? trace.velocitiesMps : [];
      const head = st.head % st.cols;
      for (let j = 0; j < n; j++) {
        const x = n < st.cols ? j : (head + j) % st.cols;
        cols.push({ t: now - ((n - j) * 4) / st.cols, ph: st.phase[x]!, v: vel[x] ?? 0 });
      }
    }
    cols.sort((a, b) => a.t - b.t);
    const out: Beat[] = [];
    let start = -1;
    for (let i = 1; i < cols.length; i++) {
      if (cols[i]!.t - cols[i - 1]!.t < 1e-6 || cols[i]!.ph > cols[i - 1]!.ph - 0.5) continue;
      if (start >= 0) out.push({ rr: cols[i]!.t - cols[start]!.t, cols: cols.slice(start, i).map((q) => ({ t: q.t - cols[start]!.t, v: q.v })) });
      start = i;
    }
    return out;
  };

  it('through the core: every beat whose E wave fits reads the case deceleration time, whatever its interval', { timeout: 240_000 }, () => {
    const mitral = beats('a4c', v3(0.2, -0.9, 1.7), 16);
    const dts: string[] = [];
    let within = 0,
      counted = 0;
    mitral.forEach((b, i) => {
      if (i === 0) return;
      // the E wave fits when mitral opening (ejection time of the RR before, plus IVRT) and the E wave end before the QRS
      const mvo = 0.06 + ejectionTimeS(60 / mitral[i - 1]!.rr, c.physiology.contractility) + c.physiology.ivrtMs / 1000;
      if (mvo + Math.min(0.1, c.physiology.decelerationTimeMs / 2000) + c.physiology.decelerationTimeMs / 1000 + 0.03 > b.rr) return;
      const run = b.cols.filter((q) => q.t > mvo - 0.02 && q.v > 0.1);
      if (run.length < 10) return;
      let pk = run[0]!;
      for (const q of run) if (q.v > pk.v) pk = q;
      const limb: { t: number; v: number }[] = [];
      for (const q of run) {
        if (q.t <= pk.t || q.v > 0.8 * pk.v) continue;
        if (q.v < 0.4 * pk.v) break;
        limb.push(q);
      }
      if (limb.length < 4) return;
      let st = 0,
        sv = 0,
        stt = 0,
        stv = 0;
      for (const q of limb) {
        st += q.t;
        sv += q.v;
        stt += q.t * q.t;
        stv += q.t * q.v;
      }
      const slope = (limb.length * stv - st * sv) / (limb.length * stt - st * st);
      const dt = ((sv - slope * st) / limb.length / -slope - pk.t) * 1000;
      counted++;
      if (Math.abs(dt / c.physiology.decelerationTimeMs - 1) <= 0.15) within++;
      dts.push(`${(b.rr * 1000).toFixed(0)}:${dt.toFixed(0)}`);
    });
    // before: the tables stretched with each RR, 185–276 ms over the beats whose E wave fit
    expect(counted, dts.join(' ')).toBeGreaterThanOrEqual(8);
    expect(within / counted, `RR:DT ${dts.join(' ')} ms`).toBeGreaterThanOrEqual(0.8);
  });

  it('through the core: the outflow VTI follows the filling of the interval before, not the beat’s own interval', { timeout: 240_000 }, () => {
    const lvot = beats('a5c', v3(A.avCenter.x - 0.6 * A.avAxis.x, A.avCenter.y - 0.6 * A.avAxis.y, A.avCenter.z - 0.6 * A.avAxis.z), 16);
    const full: number[] = [];
    const own: number[] = [];
    const report: string[] = [];
    lvot.forEach((b, i) => {
      if (i === 0) return;
      let vti = 0;
      for (let k = 1; k < b.cols.length; k++) if (b.cols[k]!.t < 0.45 && b.cols[k]!.v < -0.1) vti -= b.cols[k]!.v * (b.cols[k]!.t - b.cols[k - 1]!.t) * 100;
      report.push(`${(lvot[i - 1]!.rr * 1000).toFixed(0)}→${(b.rr * 1000).toFixed(0)}:${vti.toFixed(1)}`);
      // the interval before let a whole E wave in: this beat ejects a full stroke volume, however long it lasts itself
      if (lvot[i - 1]!.rr >= 0.7) {
        full.push(vti);
        own.push(b.rr);
      }
    });
    expect(full.length, report.join(' ')).toBeGreaterThanOrEqual(6);
    const mean = full.reduce((a, b) => a + b, 0) / full.length;
    const cv = Math.sqrt(full.reduce((a, b) => a + (b - mean) ** 2, 0) / full.length) / mean;
    const rrMean = own.reduce((a, b) => a + b, 0) / own.length;
    let sxy = 0,
      sxx = 0,
      syy = 0;
    for (let j = 0; j < full.length; j++) {
      sxy += (own[j]! - rrMean) * (full[j]! - mean);
      sxx += (own[j]! - rrMean) ** 2;
      syy += (full[j]! - mean) ** 2;
    }
    const r = sxy / Math.sqrt(sxx * syy);
    // before: stretched tables made the VTI follow the beat's own interval (r 0.9, 13.3–19.1 cm over these beats)
    expect(r, `RR before → RR: VTI ${report.join(' ')}`).toBeLessThan(0.5);
    expect(cv).toBeLessThan(0.06);
  });
});
