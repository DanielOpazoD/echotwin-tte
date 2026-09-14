import type { PhysiologyConfig, RhythmConfig, HemodynamicConfig } from '@/cases/schema';
import { computeCycleTimings, ejectionShape, eWaveShape, aWaveShape, type CycleTimings } from './timing';

/**
 * Per-beat tabulated model of LV volume and transvalvular flows. Built from the case physiology so
 * that Doppler velocities, volumes, valve motion and measurements share ONE source of truth.
 * Volumes in mL, flows in mL/s, time in s, phase in [0,1).
 */
export interface BeatTables {
  n: number;
  timings: CycleTimings;
  rrS: number;
  edvMl: number;
  esvMl: number;
  strokeVolumeMl: number;
  lvVolumeMl: Float32Array; // V(φ)
  aorticFlowMlps: Float32Array; // Q_ao(φ) ≥ 0 during ejection
  mitralFlowMlps: Float32Array; // Q_mv(φ) ≥ 0 during filling
  mvEffectiveAreaCm2: number; // solved so that ∫Q_mv = SV with the requested E and A peak velocities
  /** Regurgitant flows (mL/s) through the mitral (systole) and aortic (diastole) valves; zero when absent. */
  mrFlowMlps: Float32Array;
  arFlowMlps: Float32Array;
  regurgitation: { mrVolumeMl: number; mrVmaxMps: number; mrVtiCm: number; arVolumeMl: number; arVmaxMps: number; arVtiCm: number; arPhtMs: number };
  /**
   * Volume (mL) the closing correction removed so that V(RR) = V(0): inflow minus outflow over the beat. With every flow
   * normalised on this table it is discretisation only (decision 95); `validateCase` rejects a case that needs more.
   */
  volumeCorrectionMl: number;
  /** Longitudinal (annular) displacement toward apex as a fraction of MAPSE, [0,1]. */
  longitudinal: Float32Array;
  /** Longitudinal annular velocity in units of MAPSE per second (s⁻¹); multiply by MAPSE(cm) → cm/s. */
  longitudinalVelocity: Float32Array;
}

export interface BeatOptions {
  /** Preload scaling for beat-to-beat variation (AF): scales SV and E peak. 1 = nominal. */
  preloadFactor?: number;
  aWave?: boolean;
  n?: number;
}

export function buildBeatTables(
  rrS: number,
  physiology: PhysiologyConfig,
  rhythm: RhythmConfig,
  hemo: HemodynamicConfig,
  opts: BeatOptions = {},
): BeatTables {
  const n = opts.n ?? 512;
  const preload = opts.preloadFactor ?? 1;
  const timings = computeCycleTimings(rrS, physiology, { ...rhythm, type: opts.aWave === false ? 'atrial-fibrillation' : rhythm.type });
  const edv = physiology.edvMl * (0.85 + 0.15 * preload);
  const svNominal = physiology.edvMl - physiology.esvMl;
  const svTotal = svNominal * preload; // EDV − ESV: everything that leaves the LV in systole (forward + regurgitant)
  const dt = rrS / n;

  // Regurgitant jets (spec 63): velocity from the simplified Bernoulli pressure difference, volume = ERO × VTI.
  // MR follows the systolic shape; AR decays through diastole with the case's pressure half-time.
  const mrFlow = new Float32Array(n);
  const arFlow = new Float32Array(n);
  const mr = hemo.regurgitation.mr;
  const ar = hemo.regurgitation.ar;
  const mrVmax = mr && mr.eroaCm2 > 0 ? Math.sqrt(Math.max(1, hemo.systolicBpMmHg - 15) / 4) : 0;
  const arVmax = ar && ar.eroaCm2 > 0 ? Math.sqrt(Math.max(1, hemo.diastolicBpMmHg - 12) / 4) : 0;
  const arPht = ar?.phtMs ?? 450;
  let mrVti = 0,
    arVti = 0;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) * dt;
    if (mrVmax > 0) {
      const u = (t - timings.ejectionStartS + 0.02) / (timings.ejectionEndS - timings.ejectionStartS + 0.04);
      const v = u > 0 && u < 1 ? mrVmax * Math.pow(Math.sin(Math.PI * u), 0.8) : 0;
      mrFlow[i] = v * 100 * mr!.eroaCm2;
      mrVti += v * 100 * dt;
    }
    if (arVmax > 0) {
      const tDia = t >= timings.ejectionEndS ? t - timings.ejectionEndS : t + rrS - timings.ejectionEndS; // time since AV closure
      const inDiastole = t >= timings.ejectionEndS || t < timings.ejectionStartS;
      const v = inDiastole ? arVmax * Math.pow(2, -tDia / (2 * arPht / 1000)) : 0;
      arFlow[i] = v * 100 * ar!.eroaCm2;
      arVti += v * 100 * dt;
    }
  }
  const rvolMr = mrVmax > 0 ? mr!.eroaCm2 * mrVti : 0;
  const rvolAr = arVmax > 0 ? ar!.eroaCm2 * arVti : 0;
  // forward (aortic) ejection = total − MR; mitral inflow = total − AR (the AR volume enters through the aorta)
  const sv = Math.max(5, svTotal - rvolMr);
  const svMitral = Math.max(5, svTotal - rvolAr);

  // Ejection: Q_ao = k·shape(u), ∫ = SV
  const et = timings.ejectionEndS - timings.ejectionStartS;
  let shapeInt = 0;
  for (let i = 0; i < 400; i++) shapeInt += ejectionShape((i + 0.5) / 400) * (et / 400);
  const kAo = sv / shapeInt;

  // Filling: E and A shapes with peak velocities; solve mitral flow area A_mv so ∫Q_mv = SV. The velocity integral is
  // taken on this table, where the next beat cuts an E wave that has not ended (decision 95): integrating the whole wave
  // left the tamponade inflow 3.2 mL (6.4%) short of its stroke volume, and the closing correction hid it.
  const eCm = physiology.ePeakMps * 100 * Math.sqrt(preload);
  const aCm = timings.hasAWave ? physiology.aPeakMps * 100 : 0;
  const aDur = timings.hasAWave ? timings.aEndS - timings.aStartS : 0;
  const aShapeAt = (t: number): number => (timings.hasAWave && t > timings.aStartS && t < timings.aEndS ? aWaveShape((t - timings.aStartS) / aDur) : 0);
  // The end of atrial contraction closes the valve: an E wave still running then decays with the second half of the A
  // wave and nothing enters after it (decision 101). Cut only by the next beat, it kept entering through the last 10 ms of
  // the beat (0.33 m/s in tamponade) and the flow and the leaflets stopped at once with the R wave.
  const eAt = (t: number): number => {
    if (t <= timings.mitralOpenS) return 0;
    const e = eCm * eWaveShape(t - timings.mitralOpenS, timings.eAccelS, timings.eDecelS);
    if (!timings.hasAWave || t <= timings.aStartS + aDur / 2) return e;
    return e * aShapeAt(t);
  };
  // The case E and A are the peaks a Doppler trace shows, and the A wave is measured from the baseline over whatever E
  // flow is still running (decision 97). Atrial contraction adds the increment that brings the inflow up to A: added in
  // full on top of an unfinished E wave, the peak read 0.99 m/s for an A of 0.7 (pulmonary hypertension), 1.04 for 0.85
  // (artifact case) and 1.09 in tamponade, where the waves fuse at 108 bpm and no separate E of 0.75 could be measured.
  // When the E flow alone already exceeds A during atrial contraction, the fused wave is that of E.
  const aWindowPeak = (scale: number): number => {
    let peak = 0;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) * dt;
      if (aShapeAt(t) > 0) peak = Math.max(peak, eAt(t) + scale * aCm * aShapeAt(t));
    }
    return peak;
  };
  let aScale = 1;
  if (aCm > 0 && aWindowPeak(1) > aCm * 1.001) {
    let lo = 0,
      hi = 1;
    if (aWindowPeak(0) >= aCm) hi = 0;
    else
      for (let it = 0; it < 30; it++) {
        const mid = 0.5 * (lo + hi);
        if (aWindowPeak(mid) > aCm) hi = mid;
        else lo = mid;
      }
    aScale = hi;
  }
  const mvVelocity = new Float32Array(n); // cm/s
  let velIntegralCm = 0; // cm (VTI of mitral inflow)
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) * dt;
    const v = eAt(t) + aScale * aCm * aShapeAt(t);
    mvVelocity[i] = v;
    velIntegralCm += v * dt;
  }
  const mvArea = hemo.mvEffectiveAreaCm2 ?? svMitral / Math.max(velIntegralCm, 1e-6);
  const scaleMv = hemo.mvEffectiveAreaCm2 ? svMitral / Math.max(mvArea * velIntegralCm, 1e-6) : 1; // enforce ∫=SV if area forced

  const aorticFlow = new Float32Array(n);
  const mitralFlow = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) * dt;
    if (t > timings.ejectionStartS && t < timings.ejectionEndS) {
      aorticFlow[i] = kAo * ejectionShape((t - timings.ejectionStartS) / et);
    }
    mitralFlow[i] = (mvVelocity[i] ?? 0) * mvArea * scaleMv;
  }
  // Integrate volume; then remove the residual drift so V(0)=V(RR)=EDV exactly (ensures periodicity).
  const vol = new Float32Array(n);
  let v = edv;
  for (let i = 0; i < n; i++) {
    v += ((mitralFlow[i] ?? 0) + (arFlow[i] ?? 0) - (aorticFlow[i] ?? 0) - (mrFlow[i] ?? 0)) * dt;
    vol[i] = v;
  }
  const drift = v - edv;
  for (let i = 0; i < n; i++) vol[i] = (vol[i] ?? 0) - (drift * (i + 1)) / n;
  let minV = Infinity,
    maxV = -Infinity;
  for (let i = 0; i < n; i++) {
    minV = Math.min(minV, vol[i] ?? 0);
    maxV = Math.max(maxV, vol[i] ?? 0); // with AR the LV keeps filling until the aortic valve opens
  }

  // Longitudinal annular displacement: follows the contraction fraction with a first-order lag — close in systole and
  // during atrial contraction, limited by relaxation in early diastole. The early-diastolic time constant is solved so
  // that the annulus recoils at the case's e′ (peak MAPSE·d(long)/dt), because tissue Doppler reads this very curve.
  // It used to be 0.09·(10/e′) s, which in the normal heart (e′ 11 cm/s) recoiled at 4.6 cm/s and kept 86% of the
  // systolic descent at mid-E: every diastolic frame showed the base too apical and tissue Doppler measured e′ 4.7.
  const contraction = new Float32Array(n);
  for (let i = 0; i < n; i++) contraction[i] = (edv - (vol[i] ?? edv)) / Math.max(edv - minV, 1e-6);
  const longitudinal = new Float32Array(n);
  const longVel = new Float32Array(n);
  const eWaveEnd = timings.mitralOpenS + timings.eAccelS + timings.eDecelS;
  // without atrial contraction (AF) the recoil runs with the filling until the next beat
  const earlyEnd = timings.hasAWave ? timings.aStartS : rrS;
  const contractionAt = (time: number): number => {
    const f = (((time / dt - 0.5) % n) + n) % n;
    const i0 = Math.floor(f);
    const w = f - i0;
    return (contraction[i0] ?? 0) * (1 - w) + (contraction[(i0 + 1) % n] ?? 0) * w;
  };
  // speed > 1 compresses the early-diastolic course in time: a healthy annulus recoils ahead of the filling it drives
  // (e′ precedes E), so it can move faster than the volume curve alone allows
  const simulate = (tauE: number, speed: number): void => {
    let l = 0;
    // two passes for periodic steady state
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) * dt;
        const early = t > timings.mitralOpenS && t <= earlyEnd;
        // compressed over the E wave, holding the diastasis value once it is reached (never running into atrial filling)
        const target = early ? contractionAt(Math.min(eWaveEnd, timings.mitralOpenS + (t - timings.mitralOpenS) * speed)) : (contraction[i] ?? 0);
        const tau = t < timings.ejectionEndS ? 0.03 : t > earlyEnd ? 0.035 : tauE;
        l += ((target - l) * dt) / tau;
        longitudinal[i] = l;
      }
    }
  };
  const peakRecoilCmps = (): number => {
    let peak = 0;
    for (let i = 1; i < n - 1; i++) {
      const t = (i + 0.5) * dt;
      if (t < timings.mitralOpenS || t > earlyEnd) continue;
      peak = Math.max(peak, (-((longitudinal[i + 1] ?? 0) - (longitudinal[i - 1] ?? 0)) / (2 * dt)) * physiology.mapseCm);
    }
    return peak;
  };
  // recoil speed falls monotonically as τ grows and rises with the time compression
  const ePrime = physiology.ePrimeSeptalCmps;
  simulate(0.03, 1);
  if (peakRecoilCmps() < ePrime) {
    let lo = 1,
      hi = 3;
    for (let it = 0; it < 20; it++) {
      const mid = (lo + hi) / 2;
      simulate(0.03, mid);
      if (peakRecoilCmps() < ePrime) lo = mid;
      else hi = mid;
    }
    simulate(0.03, hi);
  } else {
    let lo = 0.03,
      hi = 0.4;
    for (let it = 0; it < 24; it++) {
      const mid = Math.sqrt(lo * hi);
      simulate(mid, 1);
      if (peakRecoilCmps() > ePrime) lo = mid;
      else hi = mid;
    }
    simulate(hi, 1);
  }
  for (let i = 0; i < n; i++) {
    const prev = longitudinal[(i - 1 + n) % n] ?? 0;
    const next = longitudinal[(i + 1) % n] ?? 0;
    longVel[i] = (next - prev) / (2 * dt);
  }

  return {
    n,
    timings,
    rrS,
    edvMl: maxV,
    esvMl: minV,
    strokeVolumeMl: maxV - minV,
    lvVolumeMl: vol,
    volumeCorrectionMl: drift,
    aorticFlowMlps: aorticFlow,
    mitralFlowMlps: mitralFlow,
    mvEffectiveAreaCm2: mvArea * scaleMv,
    mrFlowMlps: mrFlow,
    arFlowMlps: arFlow,
    regurgitation: { mrVolumeMl: rvolMr, mrVmaxMps: mrVmax, mrVtiCm: mrVti, arVolumeMl: rvolAr, arVmaxMps: arVmax, arVtiCm: arVti, arPhtMs: arPht },
    longitudinal,
    longitudinalVelocity: longVel,
  };
}

export function sampleTable(table: Float32Array, phase: number): number {
  const n = table.length;
  const x = ((phase % 1) + 1) % 1;
  const f = x * n - 0.5;
  const i0 = Math.floor(f);
  const t = f - i0;
  const a = table[((i0 % n) + n) % n] ?? 0;
  const b = table[(((i0 + 1) % n) + n) % n] ?? 0;
  return a + (b - a) * t;
}

/** Kinematic state of the heart at a given phase, derived from the beat tables. */
export interface CycleState {
  phase: number;
  timeInBeatS: number;
  rrS: number;
  lvVolumeMl: number;
  /** 0 at end-diastole, 1 at end-systole (volume based). */
  contraction: number;
  /** Mitral valve opening 0..1 (driven by inflow). */
  mvOpen: number;
  /** Aortic valve opening 0..1 (driven by ejection flow). */
  avOpen: number;
  /** Tricuspid / pulmonic openings mirror the left side with a small delay. */
  tvOpen: number;
  pvOpen: number;
  /** Longitudinal annular displacement fraction of MAPSE (0 = end diastole position). */
  longitudinal: number;
  /** Atrial contraction 0..1 (0 in AF). */
  atrialContraction: number;
  /** 1 from the end of the A wave until ejection starts (the atria stay at their minimal volume), 0 in AF. */
  atrialHold: number;
  mitralFlowMlps: number;
  aorticFlowMlps: number;
  edvMl: number;
  esvMl: number;
}

/**
 * Opening of the atrioventricular leaflets between the filling waves, as a fraction of their opening at peak inflow. After
 * the early wave the leaflets float back to a semi-closed position and stay there until atrial contraction reopens them
 * (the F point of the mitral M-mode): at the end of diastasis the orifice is about half its size at peak E (Govindarajan
 * et al., Sci Rep 2018; 8:6187), and the anterior leaflet takes 144 ± 19 ms from the E point to that nadir (Park et al.,
 * Diagnostics 2023; 13:2412). An opening that followed the inflow alone closed the valve for 95 ms at 65 bpm (decision 100).
 */
export const DIASTASIS_OPENING = 0.5;

/** Time (s) the leaflets take to close from diastasis at the onset of systole when no atrial contraction closes them first. */
const SYSTOLIC_CLOSURE_S = 0.03;

/**
 * Leaflet opening of an atrioventricular valve at phase p: it follows the inflow while that opens it wider than
 * DIASTASIS_OPENING, floats at DIASTASIS_OPENING from peak early inflow until atrial contraction peaks, then closes with
 * the end of the A wave — or, without one, in the first SYSTOLIC_CLOSURE_S of systole.
 */
function inflowOpening(tables: BeatTables, p: number, qmvMax: number): number {
  const x = ((p % 1) + 1) % 1;
  const flow = Math.min(1, Math.pow(Math.max(0, sampleTable(tables.mitralFlowMlps, x)) / qmvMax, 0.6));
  const tm = tables.timings;
  const t = x * tables.rrS;
  const afterE = t >= tm.mitralOpenS + tm.eAccelS;
  let floor = 0;
  if (tm.hasAWave) {
    const u = (t - tm.aStartS) / (tm.aEndS - tm.aStartS);
    if (afterE && u < 0.5) floor = DIASTASIS_OPENING;
    else if (u >= 0.5 && u < 1) floor = DIASTASIS_OPENING * aWaveShape(u);
  } else if (afterE) floor = DIASTASIS_OPENING;
  else if (t < SYSTOLIC_CLOSURE_S) floor = DIASTASIS_OPENING * (1 - t / SYSTOLIC_CLOSURE_S);
  return Math.max(flow, floor);
}

export function cycleStateAt(tables: BeatTables, phase: number): CycleState {
  const p = ((phase % 1) + 1) % 1;
  const vol = sampleTable(tables.lvVolumeMl, p);
  const qmv = sampleTable(tables.mitralFlowMlps, p);
  const qao = sampleTable(tables.aorticFlowMlps, p);
  let qmvMax = 1e-6,
    qaoMax = 1e-6;
  for (let i = 0; i < tables.n; i++) {
    qmvMax = Math.max(qmvMax, tables.mitralFlowMlps[i] ?? 0);
    qaoMax = Math.max(qaoMax, tables.aorticFlowMlps[i] ?? 0);
  }
  const t = p * tables.rrS;
  const tm = tables.timings;
  let atrial = 0;
  if (tm.hasAWave && t > tm.aStartS && t < tm.aEndS) atrial = Math.sin((Math.PI * (t - tm.aStartS)) / (tm.aEndS - tm.aStartS));
  const atrialHold = tm.hasAWave && (t >= tm.aEndS || t < tm.ejectionStartS) ? 1 : 0;
  const mvOpen = inflowOpening(tables, p, qmvMax);
  const avOpen = Math.min(1, Math.pow(qao / qaoMax, 0.5));
  return {
    phase: p,
    timeInBeatS: t,
    rrS: tables.rrS,
    lvVolumeMl: vol,
    contraction: (tables.edvMl - vol) / Math.max(tables.edvMl - tables.esvMl, 1e-6),
    mvOpen,
    avOpen,
    tvOpen: inflowOpening(tables, p - 0.01, qmvMax),
    pvOpen: Math.min(1, Math.pow(sampleTable(tables.aorticFlowMlps, p + 0.01) / qaoMax, 0.5)),
    longitudinal: sampleTable(tables.longitudinal, p),
    atrialContraction: atrial,
    atrialHold,
    mitralFlowMlps: qmv,
    aorticFlowMlps: qao,
    edvMl: tables.edvMl,
    esvMl: tables.esvMl,
  };
}
