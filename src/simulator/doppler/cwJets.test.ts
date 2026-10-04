// @tier slow
import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { computeHeartPose, heartToTorso, ROOT_EXCURSION } from '@/simulator/anatomy/heartModel';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { baseInput } from '@/simulator/core/baseInput';
import { SimulatorCore } from '@/simulator/core/simulatorCore';
import { computeGroundTruth } from '@/simulator/hemodynamics/groundTruth';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import { dot, sub, v3, type Vec3 } from '@/core/vec3';
import { buildFlowParams } from './flow-primitives/flowField';
import {
  envelopeThreshold,
  isClickColumn,
  SPECTRAL_BINS,
  spectralRange,
  type SpectralSettings,
} from './spectral/spectrum';

/**
 * Continuous wave through the fast jets of the cases (decision 240), through the core with the settings continuous wave
 * opens with (decision 230). A jet kept its orifice speed over a fixed 1–1.5 cm and then fell, so the line read the jet
 * only where it crossed its axis close to the orifice: the tricuspid jet of pulmonary hypertension read 2.63–3.56 m/s
 * over ±1° of cursor, and the obstruction of the obstructive cardiomyopathy, whose stream filled the tract again right
 * after the SAM–septal contact, read 2.9 m/s from the A5C aimed at it for 4.0.
 */

/** Outer edge (m/s) below the baseline of a column: the jets run away from an apical probe. */
function edgeBelow(col: ArrayLike<number>, s: SpectralSettings): number {
  if (isClickColumn(col, s)) return 0;
  const { vMin, vMax } = spectralRange(s);
  const vOf = (b: number) => vMax - ((b + 0.5) / SPECTRAL_BINS) * (vMax - vMin);
  let colMax = 0;
  for (let b = 0; b < SPECTRAL_BINS; b++) colMax = Math.max(colMax, col[b] ?? 0);
  const thr = envelopeThreshold(colMax, s);
  let peak = -1;
  for (let b = 0, best = thr; b < SPECTRAL_BINS; b++)
    if (vOf(b) < 0 && (col[b] ?? 0) > best) best = col[(peak = b)] ?? 0;
  if (peak < 0) return 0;
  let e = peak;
  for (let b = peak + 1, gap = 0; b < SPECTRAL_BINS; b++)
    if ((col[b] ?? 0) > thr) {
      e = b;
      gap = 0;
    } else if (++gap > 2) break;
  return -vOf(e);
}

/**
 * The fastest systolic edge (m/s) and when it peaks (fraction of ejection) with the CW line from a view through a
 * target in the heart, turned by `offsetDeg` of cursor.
 */
function systolicPeak(caseId: string, viewId: string, target: Vec3, offsetDeg: number) {
  const c = loadCaseById(caseId);
  const m = new SimulatorCore(c, baseInput()).models;
  const control = canonicalControl(getViewTarget(viewId), m.heart, m.thorax);
  const beam = beamFrameFromPose(poseFromControl(m.thorax, control));
  const d = sub(heartToTorso(m.heart.frame, target), beam.origin);
  const depth = dot(d, beam.forward),
    lateral = dot(d, beam.lateral);
  const theta = Math.atan2(lateral, depth) + (offsetDeg * Math.PI) / 180;
  const input = baseInput({
    probe: control,
    modality: 'cw',
    quality: 'low',
    cursorThetaRad: theta,
    gateDepthCm: Math.hypot(depth, lateral),
  });
  // the line's direction in the heart's frame
  const fr = m.heart.frame;
  const dir = v3(
    beam.forward.x * Math.cos(theta) + beam.lateral.x * Math.sin(theta),
    beam.forward.y * Math.cos(theta) + beam.lateral.y * Math.sin(theta),
    beam.forward.z * Math.cos(theta) + beam.lateral.z * Math.sin(theta),
  );
  const dirHeart = v3(dot(dir, fr.ex), dot(dir, fr.ey), dot(dir, fr.ez));
  const core = new SimulatorCore(c, input);
  const T = m.tables.timings,
    rr = m.tables.rrS;
  let peak = 0,
    when = 0,
    seen = 0;
  for (let s = 0; s < 2.3; s += 0.02) {
    core.step(0.02);
    const st = core.spectralStrip;
    for (; seen < st.head; seen++) {
      const k = seen % st.cols;
      const u = (st.phase[k]! * rr - T.ejectionStartS) / (T.ejectionEndS - T.ejectionStartS);
      // the ejection, short of the valve clicks at its ends
      if (u < 0.05 || u > 0.95) continue;
      const v = edgeBelow(
        st.data!.subarray(k * SPECTRAL_BINS, (k + 1) * SPECTRAL_BINS),
        input.spectral,
      );
      if (v > peak) [peak, when] = [v, u];
    }
  }
  return { peak, when, dirHeart };
}

describe('continuous wave through narrow fast jets (decision 240)', () => {
  it('the tricuspid jet of pulmonary hypertension reads the same over ±1° of cursor, near its speed', () => {
    const id = 'pulmonary-hypertension-rv';
    const c = loadCaseById(id);
    const m = new SimulatorCore(c, baseInput()).models;
    const f = buildFlowParams(c, m.heart, m.tables, m.thorax);
    // 1 cm into the atrium from the tricuspid centre, on the jet's axis
    const target = v3(f.tvCenter.x, f.tvCenter.y, f.tvCenter.z - 1.0);
    const truth = computeGroundTruth(c, m.tables).rightHeart.trVmaxMps!;
    const reads = [-1, 0, 1].map((off) => systolicPeak(id, 'a4c', target, off).peak);
    const msg = `TR ${reads.map((v) => v.toFixed(2)).join(' / ')} m/s at −1°, 0°, +1° for ${truth.toFixed(2)}`;
    expect(Math.min(...reads) / Math.max(...reads), msg).toBeGreaterThan(0.95);
    expect(Math.min(...reads) / truth, msg).toBeGreaterThan(0.9);
  });

  it('the obstruction of the obstructive cardiomyopathy is reached from the A5C, late in systole', () => {
    const id = 'hocm-sam';
    const c = loadCaseById(id);
    const m = new SimulatorCore(c, baseInput()).models;
    const f = buildFlowParams(c, m.heart, m.tables, m.thorax);
    const T = m.tables.timings;
    const late = (T.ejectionStartS + 0.7 * (T.ejectionEndS - T.ejectionStartS)) / m.tables.rrS;
    const hp = computeHeartPose(m.heart, cycleStateAt(m.tables, late));
    // the SAM–septal contact, 0.6 cm under the aortic valve on its axis
    const a = f.avAxis;
    const target = v3(
      f.avCenter.x - 0.6 * a.x,
      f.avCenter.y - 0.6 * a.y,
      f.avCenter.z + hp.zAnn * ROOT_EXCURSION - 0.6 * a.z,
    );
    const { peak, when, dirHeart } = systolicPeak(id, 'a5c', target, 0);
    const truth = computeGroundTruth(c, m.tables).lvot.vmaxMps;
    // what a line at its angle to the tract can read of the case's speed (cos 0.895 from the A5C)
    const cos = Math.abs(dot(dirHeart, a));
    const msg = `obstruction ${peak.toFixed(2)} m/s at ${when.toFixed(2)} of ejection for ${truth.toFixed(2)} × cos ${cos.toFixed(3)}`;
    expect(peak / (truth * cos), msg).toBeGreaterThan(0.9);
    // dynamic obstruction: a dagger that peaks late
    expect(when, msg).toBeGreaterThan(0.6);
  });

  it('the severe stenosis leaves the opposite channel dark in mid-systole (decision 246)', () => {
    const id = 'aortic-stenosis-severe';
    const c = loadCaseById(id);
    const m = new SimulatorCore(c, baseInput()).models;
    const f = buildFlowParams(c, m.heart, m.tables, m.thorax);
    const T = m.tables.timings;
    const peak = (T.ejectionStartS + 0.35 * (T.ejectionEndS - T.ejectionStartS)) / m.tables.rrS;
    const hp = computeHeartPose(m.heart, cycleStateAt(m.tables, peak));
    const a = f.avAxis;
    const vc = v3(
      f.avCenter.x + 0.5 * a.x,
      f.avCenter.y + 0.5 * a.y,
      f.avCenter.z + hp.zAnn * ROOT_EXCURSION + 0.5 * a.z,
    );
    const control = canonicalControl(getViewTarget('a5c'), m.heart, m.thorax);
    const beam = beamFrameFromPose(poseFromControl(m.thorax, control));
    const d = sub(heartToTorso(m.heart.frame, vc), beam.origin);
    const input = baseInput({
      probe: control,
      modality: 'cw',
      quality: 'low',
      cursorThetaRad: Math.atan2(dot(d, beam.lateral), dot(d, beam.forward)),
      gateDepthCm: Math.hypot(dot(d, beam.forward), dot(d, beam.lateral)),
    });
    const core = new SimulatorCore(c, input);
    for (let s = 0; s < 1.9; s += 0.02) core.step(0.02);
    const st = core.spectralStrip;
    const { vMin, vMax } = spectralRange(input.spectral);
    let opposite = 0,
      nOpp = 0,
      jet = 0,
      nJet = 0;
    for (let col = 0; col < st.head; col++) {
      const u =
        (st.phase[col]! * m.tables.rrS - T.ejectionStartS) / (T.ejectionEndS - T.ejectionStartS);
      if (u < 0.25 || u > 0.5) continue;
      for (let b = 0; b < SPECTRAL_BINS; b++) {
        const v = vMax - ((b + 0.5) / SPECTRAL_BINS) * (vMax - vMin);
        const shown = st.display![col * SPECTRAL_BINS + b]!;
        if (v > 0.2 && v < 1.5) [opposite, nOpp] = [opposite + shown, nOpp + 1];
        if (v < -0.5 && v > -3) [jet, nJet] = [jet + shown, nJet + 1];
      }
    }
    const ratio = opposite / nOpp / (jet / nJet);
    expect(
      ratio,
      `opposite band at ${(100 * ratio).toFixed(0)} % of the jet's brightness`,
    ).toBeLessThan(0.1);
  });
});
