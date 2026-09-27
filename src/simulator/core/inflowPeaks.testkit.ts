import { loadCaseById } from '@/cases';
import { heartAnchors, heartToTorso } from '@/simulator/anatomy/heartModel';
import type { PatientState } from '@/simulator/anatomy/thoraxModel';
import { DEFAULT_SPECTRAL } from '@/simulator/doppler/spectral/spectrum';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import { dot, sub, v3, type Vec3 } from '@/core/vec3';
import { baseInput } from './baseInput';
import { SimulatorCore } from './simulatorCore';

/**
 * Test support, not app code (decision 239): the respiratory variation of the inflows through the core (decision 108) —
 * the pulsed Doppler auto-trace in time order, split into beats at the phase wraps of its columns, peak velocity per beat
 * over three breaths. Shared by the respiration tests, which live in files of their own so that CI runs them in parallel
 * (together they took 726 s in one file, the longest of the suite).
 */
export const inflowPeaks = (
  id: string,
  respiration: PatientState['respiration'],
  tricuspid: boolean,
): number[] => {
  const c = loadCaseById(id);
  const models = new SimulatorCore(c, baseInput()).models;
  const A = heartAnchors(models.heart);
  const gate: Vec3 = tricuspid
    ? v3(A.tvCenter.x, A.tvCenter.y, A.tvCenter.z + 1.5)
    : v3(0.2, -0.9, 1.7);
  const control = canonicalControl(getViewTarget('a4c'), models.heart, models.thorax);
  const beam = beamFrameFromPose(poseFromControl(models.thorax, control));
  const d = sub(heartToTorso(models.heart.frame, gate), beam.origin);
  const spectral = { ...DEFAULT_SPECTRAL, scaleMps: 1.2, sweepSpeedMmPerS: 25 };
  const core = new SimulatorCore(
    c,
    baseInput({
      patient: { ...baseInput().patient, respiration },
      probe: control,
      modality: 'pw',
      quality: 'low',
      display: { width: 640, height: 480 },
      cursorThetaRad: Math.atan2(dot(d, beam.lateral), dot(d, beam.forward)),
      gateDepthCm: Math.hypot(dot(d, beam.forward), dot(d, beam.lateral)),
      spectral,
    }),
  );
  const tm = models.tables.timings;
  const eFrom = ((tricuspid ? tm.tricuspidOpenS : tm.mitralOpenS) - 0.02) / tm.rrS;
  const eTo = (tm.hasAWave ? tm.aEndS : tm.rrS) / tm.rrS;
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
      // the filling: from the valve's opening to the end of atrial contraction (fused with the E wave in tamponade). Over the
      // whole beat the tricuspid gate, 1.5 cm below the annulus, also caught the regurgitant convergence of systole as
      // TAPSE brought the annulus down to it (decision 162)
      let pk = 0;
      for (let k = start; k < i; k++)
        if (cols[k]!.ph > eFrom && cols[k]!.ph < eTo) pk = Math.max(pk, cols[k]!.v);
      if (pk > 0.1) out.push(pk);
    }
    start = i;
  }
  return out;
};
export const fall = (p: number[]) => (Math.max(...p) - Math.min(...p)) / Math.max(...p);
export const rise = (p: number[]) => (Math.max(...p) - Math.min(...p)) / Math.min(...p);
