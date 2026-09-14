import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { SimulatorCore } from './simulatorCore';
import { baseInput } from './baseInput';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import { heartAnchors, heartToTorso } from '@/simulator/anatomy/heartModel';
import { DEFAULT_SPECTRAL } from '@/simulator/doppler/spectral/spectrum';
import type { PatientState } from '@/simulator/anatomy/thoraxModel';
import { dot, sub, v3, type Vec3 } from '@/core/vec3';

/**
 * Respiratory variation of the inflows through the core (decision 108): the pulsed Doppler auto-trace in time order, split
 * into beats at the phase wraps of its columns, peak velocity per beat over three breaths.
 */
describe('free breathing through the core (decision 108)', () => {
  const peaks = (id: string, respiration: PatientState['respiration'], tricuspid: boolean): number[] => {
    const c = loadCaseById(id);
    const models = new SimulatorCore(c, baseInput()).models;
    const A = heartAnchors(models.heart);
    const gate: Vec3 = tricuspid ? v3(A.tvCenter.x, A.tvCenter.y, A.tvCenter.z + 1.5) : v3(0.2, -0.9, 1.7);
    const control = canonicalControl(getViewTarget('a4c'), models.heart, models.thorax);
    const beam = beamFrameFromPose(poseFromControl(models.thorax, control));
    const d = sub(heartToTorso(models.heart.frame, gate), beam.origin);
    const spectral = { ...DEFAULT_SPECTRAL, scaleMps: 1.2, sweepSpeedMmPerS: 25 };
    const core = new SimulatorCore(c, baseInput({ patient: { ...baseInput().patient, respiration }, probe: control, modality: 'pw', quality: 'low', display: { width: 640, height: 480 }, cursorThetaRad: Math.atan2(dot(d, beam.lateral), dot(d, beam.forward)), gateDepthCm: Math.hypot(dot(d, beam.forward), dot(d, beam.lateral)), spectral }));
    const cols: { t: number; ph: number; v: number }[] = [];
    let now = 0;
    for (let snap = 0; snap < 4; snap++) {
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
    const out: number[] = [];
    let start = -1;
    for (let i = 1; i < cols.length; i++) {
      if (cols[i]!.t - cols[i - 1]!.t < 1e-6 || cols[i]!.ph > cols[i - 1]!.ph - 0.5) continue;
      if (start >= 0) {
        let pk = 0;
        for (let k = start; k < i; k++) pk = Math.max(pk, cols[k]!.v);
        if (pk > 0.1) out.push(pk);
      }
      start = i;
    }
    return out;
  };
  const fall = (p: number[]) => (Math.max(...p) - Math.min(...p)) / Math.max(...p);
  const rise = (p: number[]) => (Math.max(...p) - Math.min(...p)) / Math.min(...p);

  it('in tamponade the mitral E falls more than 30% with inspiration and the tricuspid E rises more than 60%', { timeout: 300_000 }, () => {
    const mitral = peaks('pericardial-effusion-tamponade', 'free-breathing', false);
    const tricuspid = peaks('pericardial-effusion-tamponade', 'free-breathing', true);
    expect(mitral.length).toBeGreaterThan(15);
    // before: the tables were the same in every beat whatever the breathing
    expect(fall(mitral), mitral.map((v) => v.toFixed(2)).join(' ')).toBeGreaterThan(0.3);
    expect(fall(mitral)).toBeLessThan(0.45);
    expect(rise(tricuspid), tricuspid.map((v) => v.toFixed(2)).join(' ')).toBeGreaterThan(0.6);
  });

  it('a normal heart varies within the normal limits, and holding the breath does not vary', { timeout: 300_000 }, () => {
    const mitral = peaks('normal-excellent-window', 'free-breathing', false);
    // normal respiratory variation of the mitral E: 95% limits 6–26%
    expect(fall(mitral), mitral.map((v) => v.toFixed(2)).join(' ')).toBeGreaterThan(0.06);
    expect(fall(mitral)).toBeLessThan(0.26);
    expect(rise(peaks('normal-excellent-window', 'free-breathing', true))).toBeLessThan(0.3);
    expect(fall(peaks('normal-excellent-window', 'expiration', false))).toBeLessThan(0.05);
  });
});
