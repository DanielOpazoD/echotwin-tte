import type { PhysiologyConfig, RhythmConfig, HemodynamicConfig } from '@/cases/schema';
import {
  computeCycleTimings,
  ejectionShape,
  eWaveShape,
  aWaveShape,
  type CycleTimings,
} from './timing';

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
  /** Q_pv(φ) ≥ 0: right ventricular ejection, with the case's pulmonary acceleration time (decision 105). */
  pulmonaryFlowMlps: Float32Array;
  /** Acceleration time (s) of the right ventricular ejection. */
  pulmonaryAccelerationS: number;
  mitralFlowMlps: Float32Array; // Q_mv(φ) ≥ 0 during filling
  /** Q_tv(φ) ≥ 0: tricuspid inflow, the mitral inflow with its own early wave (decision 108). */
  tricuspidFlowMlps: Float32Array;
  /** Tricuspid filling over the beat (mL): what the right ventricle ejects in the next chained beat. */
  tricuspidFillMl: number;
  mvEffectiveAreaCm2: number; // solved so that ∫Q_mv = SV with the requested E and A peak velocities
  /** Regurgitant flows (mL/s) through the mitral (systole) and aortic (diastole) valves; zero when absent. */
  mrFlowMlps: Float32Array;
  arFlowMlps: Float32Array;
  regurgitation: {
    mrVolumeMl: number;
    mrVmaxMps: number;
    mrVtiCm: number;
    arVolumeMl: number;
    arVmaxMps: number;
    arVtiCm: number;
    arPhtMs: number;
  };
  /**
   * Volume (mL) the closing correction removed so that V(RR) = V(0): inflow minus outflow over the beat. With every flow
   * normalised on this table it is discretisation only (decision 95); `validateCase` rejects a case that needs more.
   */
  volumeCorrectionMl: number;
  /** Volume (mL) and annular displacements when the beat ends: where the next beat of atrial fibrillation starts. */
  endVolumeMl: number;
  endLongitudinal: number;
  endRvLongitudinal: number;
  /** Longitudinal (annular) displacement toward apex as a fraction of MAPSE, [0,1]. */
  longitudinal: Float32Array;
  /** Longitudinal annular velocity in units of MAPSE per second (s⁻¹); multiply by MAPSE(cm) → cm/s. */
  longitudinalVelocity: Float32Array;
  /** Tricuspid annular displacement toward the apex as a fraction of TAPSE, and its velocity (s⁻¹) (decision 106). */
  rvLongitudinal: Float32Array;
  rvLongitudinalVelocity: Float32Array;
  /** Inferior vena cava collapse (fraction of its diameter) when the beat starts and ends, while breathing (decision 113). */
  ivcCollapse: readonly [number, number] | null;
}

export interface BeatOptions {
  /** Preload scaling: scales SV and E peak. 1 = nominal. */
  preloadFactor?: number;
  aWave?: boolean;
  n?: number;
  /**
   * A beat chained to the one before it (decision 107, atrial fibrillation; decision 108, free breathing): the volume each
   * ventricle ejects (what filled it in the diastole before), the mitral flow area of the case, the RR before it, where the
   * annuli were when that beat ended, and the factors on the early inflow waves of this beat.
   */
  chain?: ChainedBeat;
}

export interface ChainedBeat {
  ejectMl: number;
  /** Right ventricular ejection (mL): the tricuspid filling of the beat before. The left one when omitted. */
  rvEjectMl?: number;
  mvAreaCm2: number;
  previousRrS: number;
  startLongitudinal: number;
  startRvLongitudinal: number;
  /** Factors on the mitral and tricuspid E waves (respiration, decision 108); 1 when omitted. */
  mitralEFactor?: number;
  tricuspidEFactor?: number;
  /** Inferior vena cava collapse when the beat starts and when it ends (respiration, decision 113). */
  ivcCollapse?: readonly [number, number];
}

/**
 * Pulmonary acceleration time (s) for a mean pulmonary artery pressure (mmHg), inverting the Doppler regressions: Dabestani
 * et al. (Am J Cardiol 1987; 59:662–668) mPAP = 79 − 0.45·AcT for AcT ≥ 120 ms and Mahan's mPAP = 90 − 0.62·AcT for
 * AcT < 90 ms, joined linearly between them. A normal mean pressure of 17 mmHg gives 137 ms (normal 136–153 ms).
 */
export function pulmonaryAccelerationTimeS(mpapMmHg: number): number {
  const at120 = 79 - 0.45 * 120;
  const at90 = 90 - 0.62 * 90;
  if (mpapMmHg <= at120) return (79 - mpapMmHg) / 0.45 / 1000;
  if (mpapMmHg >= at90) return Math.max(40, (90 - mpapMmHg) / 0.62) / 1000;
  return (120 - (30 * (mpapMmHg - at120)) / (at90 - at120)) / 1000;
}

/** Mean pulmonary artery pressure (mmHg) from the systolic one: Chemla et al. (Chest 2004; 126:1313–1317), 0.61·sPAP + 2. */
export function meanPulmonaryPressureMmHg(systolicMmHg: number): number {
  return 0.61 * systolicMmHg + 2;
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
  const af = opts.chain;
  const timings = computeCycleTimings(
    rrS,
    physiology,
    { ...rhythm, type: opts.aWave === false ? 'atrial-fibrillation' : rhythm.type },
    af?.previousRrS ?? rrS,
  );
  const svNominal = physiology.edvMl - physiology.esvMl;
  // in atrial fibrillation a beat ejects what the diastole before it filled, from the case's end-systolic volume
  const edv = af ? physiology.esvMl + af.ejectMl : physiology.edvMl * (0.85 + 0.15 * preload);
  const svTotal = af ? af.ejectMl : svNominal * preload; // EDV − ESV: everything that leaves the LV in systole (forward + regurgitant)
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
      const u =
        (t - timings.ejectionStartS + 0.02) /
        (timings.ejectionEndS - timings.ejectionStartS + 0.04);
      const v = u > 0 && u < 1 ? mrVmax * Math.pow(Math.sin(Math.PI * u), 0.8) : 0;
      mrFlow[i] = v * 100 * mr!.eroaCm2;
      mrVti += v * 100 * dt;
    }
    if (arVmax > 0) {
      const tDia =
        t >= timings.ejectionEndS ? t - timings.ejectionEndS : t + rrS - timings.ejectionEndS; // time since AV closure
      const inDiastole = t >= timings.ejectionEndS || t < timings.ejectionStartS;
      const v = inDiastole ? arVmax * Math.pow(2, -tDia / ((2 * arPht) / 1000)) : 0;
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
  const aShapeAt = (t: number): number =>
    timings.hasAWave && t > timings.aStartS && t < timings.aEndS
      ? aWaveShape((t - timings.aStartS) / aDur)
      : 0;
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
  // respiration scales the early waves of each inflow and leaves atrial contraction as the case measured it (decision 108)
  const mitralEFactor = af?.mitralEFactor ?? 1;
  const tricuspidEFactor = af?.tricuspidEFactor ?? 1;
  const mvVelocity = new Float32Array(n); // cm/s
  const tvVelocity = new Float32Array(n); // cm/s at the mitral flow area: the tricuspid inflow carries the same flow
  let velIntegralCm = 0; // cm (VTI of mitral inflow)
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) * dt;
    const atrial = aScale * aCm * aShapeAt(t);
    const v = eAt(t) * mitralEFactor + atrial;
    mvVelocity[i] = v;
    tvVelocity[i] = eAt(t) * tricuspidEFactor + atrial;
    velIntegralCm += v * dt;
  }
  // a beat of atrial fibrillation fills through the case's orifice for as long as its diastole lasts (decision 107)
  const mvArea = af
    ? af.mvAreaCm2
    : (hemo.mvEffectiveAreaCm2 ?? svMitral / Math.max(velIntegralCm, 1e-6));
  const scaleMv =
    !af && hemo.mvEffectiveAreaCm2 ? svMitral / Math.max(mvArea * velIntegralCm, 1e-6) : 1; // enforce ∫=SV if area forced

  // Right ventricular ejection (decision 105): the ejection period of the left ventricle one hundredth of the beat earlier,
  // as the pulmonary valve has always led the aortic one here, the forward stroke volume, and the same skewed shape with its
  // peak at the acceleration time of the case's mean pulmonary pressure. It used to copy the aortic flow, whose peak at 0.4
  // of ejection gave 121 ms in the normal heart and 108 ms at a systolic pulmonary pressure of 72 mmHg.
  const pulmonaryAccelerationS = Math.min(
    0.6 * et,
    Math.max(0.12 * et, pulmonaryAccelerationTimeS(meanPulmonaryPressureMmHg(hemo.paspMmHg))),
  );
  const peakU = pulmonaryAccelerationS / et;
  const pvShape = (u: number): number =>
    u <= 0 || u >= 1 ? 0 : Math.pow(u, 2.25 * peakU) * Math.pow(1 - u, 2.25 * (1 - peakU));
  let pvInt = 0;
  for (let i = 0; i < 400; i++) pvInt += pvShape((i + 0.5) / 400) * (et / 400);
  const kPv = Math.max(5, af?.rvEjectMl ?? sv - rvolAr) / pvInt;
  const pvLead = 0.01 * rrS;

  const aorticFlow = new Float32Array(n);
  const pulmonaryFlow = new Float32Array(n);
  const mitralFlow = new Float32Array(n);
  const tricuspidFlow = new Float32Array(n);
  let tricuspidFillMl = 0;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) * dt;
    if (t > timings.ejectionStartS && t < timings.ejectionEndS) {
      aorticFlow[i] = kAo * ejectionShape((t - timings.ejectionStartS) / et);
    }
    const tp = (((t + pvLead) % rrS) + rrS) % rrS;
    if (tp > timings.ejectionStartS && tp < timings.ejectionEndS)
      pulmonaryFlow[i] = kPv * pvShape((tp - timings.ejectionStartS) / et);
    mitralFlow[i] = (mvVelocity[i] ?? 0) * mvArea * scaleMv;
    tricuspidFlow[i] = (tvVelocity[i] ?? 0) * mvArea * scaleMv;
    tricuspidFillMl += tricuspidFlow[i]! * dt;
  }
  // Integrate volume; then remove the residual drift so V(0)=V(RR)=EDV exactly (ensures periodicity).
  const vol = new Float32Array(n);
  let v = edv;
  for (let i = 0; i < n; i++) {
    v += ((mitralFlow[i] ?? 0) + (arFlow[i] ?? 0) - (aorticFlow[i] ?? 0) - (mrFlow[i] ?? 0)) * dt;
    vol[i] = v;
  }
  const drift = v - edv;
  // a beat of atrial fibrillation does not close on itself: what it filled beyond what it ejected starts the next one
  if (!af) for (let i = 0; i < n; i++) vol[i] = (vol[i] ?? 0) - (drift * (i + 1)) / n;
  let minV = Infinity,
    maxV = -Infinity;
  for (let i = 0; i < n; i++) {
    minV = Math.min(minV, vol[i] ?? 0);
    maxV = Math.max(maxV, vol[i] ?? 0); // with AR the LV keeps filling until the aortic valve opens
  }
  // contraction, wall thickening and annular motion of fibrillating beats share the case's volumes, so they run on
  // across beats that eject and fill different volumes
  const edvRef = af ? physiology.edvMl : edv;
  const esvRef = af ? physiology.esvMl : minV;

  // Longitudinal annular displacement: follows the contraction fraction with a first-order lag — close in systole and
  // during atrial contraction, limited by relaxation in early diastole. The early-diastolic time constant is solved so
  // that the annulus recoils at the case's e′ (peak MAPSE·d(long)/dt), because tissue Doppler reads this very curve.
  // It used to be 0.09·(10/e′) s, which in the normal heart (e′ 11 cm/s) recoiled at 4.6 cm/s and kept 86% of the
  // systolic descent at mid-E: every diastolic frame showed the base too apical and tissue Doppler measured e′ 4.7.
  const contraction = new Float32Array(n);
  for (let i = 0; i < n; i++)
    contraction[i] = (edvRef - (vol[i] ?? edvRef)) / Math.max(edvRef - esvRef, 1e-6);
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
  // sysSpeed compresses the ejection course the same way (decision 106): the tricuspid annulus reaches its excursion
  // earlier in systole than the volume curve when its case S′ asks for it
  const simulate = (
    tauE: number,
    speed: number,
    sysSpeed = 1,
    into: Float32Array = longitudinal,
  ): void => {
    const start = af ? (into === longitudinal ? af.startLongitudinal : af.startRvLongitudinal) : 0;
    let l = start;
    // two passes for periodic steady state; a beat of atrial fibrillation runs once from where the previous one ended
    for (let pass = 0; pass < (af ? 1 : 2); pass++) {
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) * dt;
        const early = t > timings.mitralOpenS && t <= earlyEnd;
        const ejecting = t >= timings.ejectionStartS && t < timings.ejectionEndS;
        // compressed over the E wave, holding the diastasis value once it is reached (never running into atrial filling)
        const target = early
          ? contractionAt(
              Math.min(eWaveEnd, timings.mitralOpenS + (t - timings.mitralOpenS) * speed),
            )
          : ejecting
            ? contractionAt(
                Math.min(
                  timings.ejectionEndS,
                  timings.ejectionStartS + (t - timings.ejectionStartS) * sysSpeed,
                ),
              )
            : (contraction[i] ?? 0);
        const tau = t < timings.ejectionEndS ? 0.03 : t > earlyEnd ? 0.035 : tauE;
        l += ((target - l) * dt) / tau;
        into[i] = l;
      }
    }
  };
  const peakRecoilCmps = (): number => {
    let peak = 0;
    for (let i = 1; i < n - 1; i++) {
      const t = (i + 0.5) * dt;
      if (t < timings.mitralOpenS || t > earlyEnd) continue;
      peak = Math.max(
        peak,
        (-((longitudinal[i + 1] ?? 0) - (longitudinal[i - 1] ?? 0)) / (2 * dt)) *
          physiology.mapseCm,
      );
    }
    return peak;
  };
  // recoil speed falls monotonically as τ grows and rises with the time compression
  const ePrime = physiology.ePrimeSeptalCmps;
  let tauEarly = 0.03,
    earlySpeed = 1;
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
    earlySpeed = hi;
  } else {
    let lo = 0.03,
      hi = 0.4;
    for (let it = 0; it < 24; it++) {
      const mid = Math.sqrt(lo * hi);
      simulate(mid, 1);
      if (peakRecoilCmps() > ePrime) lo = mid;
      else hi = mid;
    }
    tauEarly = hi;
  }
  simulate(tauEarly, earlySpeed);
  // A beat that repeats is differentiated periodically. A chained beat starts where the previous one ended and ends elsewhere
  // (decision 114): before its first sample comes the displacement it started from, and its last sample has no next one.
  // Differentiated across that seam, the first sample read up to -625 MAPSE per second, a tissue Doppler spike at every QRS.
  const derivative = (from: Float32Array, to: Float32Array, start: number | undefined): void => {
    for (let i = 0; i < n; i++) {
      if (start !== undefined && i === 0) to[i] = ((from[1] ?? 0) - start) / (2 * dt);
      else if (start !== undefined && i === n - 1)
        to[i] = ((from[n - 1] ?? 0) - (from[n - 2] ?? 0)) / dt;
      else to[i] = ((from[(i + 1) % n] ?? 0) - (from[(i - 1 + n) % n] ?? 0)) / (2 * dt);
    }
  };
  derivative(longitudinal, longVel, af?.startLongitudinal);

  // Tricuspid annulus (decision 106): the right ventricle shortens along the same course, relaxes like the left one and
  // reaches its systolic peak velocity at the case S′ for its TAPSE, by compressing its ejection course in time. The tissue
  // Doppler of the right ventricle used to read the left ventricular curve scaled by MAPSE (5.3 cm/s at the free wall of
  // the normal heart for an S′ of 13), while the tricuspid annulus of the image moved with TAPSE.
  const rvLongitudinal = new Float32Array(n);
  const rvLongVel = new Float32Array(n);
  const peakSystolicCmps = (): number => {
    derivative(rvLongitudinal, rvLongVel, af?.startRvLongitudinal);
    let peak = 0;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) * dt;
      if (t >= timings.ejectionStartS && t <= timings.ejectionEndS)
        peak = Math.max(peak, (rvLongVel[i] ?? 0) * physiology.tapseCm);
    }
    return peak;
  };
  {
    let lo = 0.5,
      hi = 3;
    for (let it = 0; it < 24; it++) {
      const mid = Math.sqrt(lo * hi);
      simulate(tauEarly, earlySpeed, mid, rvLongitudinal);
      if (peakSystolicCmps() < physiology.sPrimeTricuspidCmps) lo = mid;
      else hi = mid;
    }
    simulate(tauEarly, earlySpeed, Math.sqrt(lo * hi), rvLongitudinal);
    derivative(rvLongitudinal, rvLongVel, af?.startRvLongitudinal);
  }

  return {
    n,
    timings,
    rrS,
    edvMl: af ? edvRef : maxV,
    esvMl: af ? esvRef : minV,
    strokeVolumeMl: maxV - minV,
    lvVolumeMl: vol,
    volumeCorrectionMl: af ? 0 : drift,
    endVolumeMl: v,
    endLongitudinal: longitudinal[n - 1] ?? 0,
    endRvLongitudinal: rvLongitudinal[n - 1] ?? 0,
    aorticFlowMlps: aorticFlow,
    pulmonaryFlowMlps: pulmonaryFlow,
    pulmonaryAccelerationS,
    mitralFlowMlps: mitralFlow,
    tricuspidFlowMlps: tricuspidFlow,
    tricuspidFillMl,
    mvEffectiveAreaCm2: mvArea * scaleMv,
    mrFlowMlps: mrFlow,
    arFlowMlps: arFlow,
    regurgitation: {
      mrVolumeMl: rvolMr,
      mrVmaxMps: mrVmax,
      mrVtiCm: mrVti,
      arVolumeMl: rvolAr,
      arVmaxMps: arVmax,
      arVtiCm: arVti,
      arPhtMs: arPht,
    },
    longitudinal,
    longitudinalVelocity: longVel,
    rvLongitudinal,
    rvLongitudinalVelocity: rvLongVel,
    ivcCollapse: af?.ivcCollapse ?? null,
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
  /** Tricuspid annular displacement fraction of TAPSE (decision 106). */
  rvLongitudinal: number;
  /** Inferior vena cava collapse this frame while breathing freely (decision 113); the patient state's when absent. */
  ivcCollapse?: number;
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
function inflowOpening(
  tables: BeatTables,
  p: number,
  qmvMax: number,
  table: Float32Array = tables.mitralFlowMlps,
): number {
  const x = ((p % 1) + 1) % 1;
  const flow = Math.min(1, Math.pow(Math.max(0, sampleTable(table, x)) / qmvMax, 0.6));
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

/**
 * Instants (s from the start of the beat) at which each valve opens and closes, [open, close]: the semilunar valves with
 * the start and end of ejection, the mitral valve at the end of isovolumic relaxation and with the end of atrial
 * contraction (or once closed early in systole without one), the tricuspid 1% of the beat after the mitral and the
 * pulmonary 1% before the aortic, as their openings follow them.
 */
export function valveEventTimes(tables: BeatTables): {
  mitral: [number, number];
  aortic: [number, number];
  tricuspid: [number, number];
  pulmonary: [number, number];
} {
  const tm = tables.timings;
  const lag = 0.01 * tables.rrS;
  const mitral: [number, number] = [tm.mitralOpenS, tm.hasAWave ? tm.aEndS : SYSTOLIC_CLOSURE_S];
  return {
    mitral,
    aortic: [tm.ejectionStartS, tm.ejectionEndS],
    tricuspid: [mitral[0] + lag, mitral[1] + lag],
    pulmonary: [tm.ejectionStartS - lag, tm.ejectionEndS - lag],
  };
}

export function cycleStateAt(tables: BeatTables, phase: number): CycleState {
  const p = ((phase % 1) + 1) % 1;
  const vol = sampleTable(tables.lvVolumeMl, p);
  const qmv = sampleTable(tables.mitralFlowMlps, p);
  const qao = sampleTable(tables.aorticFlowMlps, p);
  let qmvMax = 1e-6,
    qaoMax = 1e-6,
    qpvMax = 1e-6;
  for (let i = 0; i < tables.n; i++) {
    qmvMax = Math.max(qmvMax, tables.mitralFlowMlps[i] ?? 0);
    qaoMax = Math.max(qaoMax, tables.aorticFlowMlps[i] ?? 0);
    qpvMax = Math.max(qpvMax, tables.pulmonaryFlowMlps[i] ?? 0);
  }
  const t = p * tables.rrS;
  const tm = tables.timings;
  let atrial = 0;
  if (tm.hasAWave && t > tm.aStartS && t < tm.aEndS)
    atrial = Math.sin((Math.PI * (t - tm.aStartS)) / (tm.aEndS - tm.aStartS));
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
    tvOpen: inflowOpening(tables, p - 0.01, qmvMax, tables.tricuspidFlowMlps),
    pvOpen: Math.min(1, Math.pow(sampleTable(tables.pulmonaryFlowMlps, p) / qpvMax, 0.5)),
    longitudinal: sampleTable(tables.longitudinal, p),
    rvLongitudinal: sampleTable(tables.rvLongitudinal, p),
    // linear across the beat, from where the breath had it when the beat started to where it has it when the beat ends
    ivcCollapse: tables.ivcCollapse
      ? tables.ivcCollapse[0] + (tables.ivcCollapse[1] - tables.ivcCollapse[0]) * p
      : undefined,
    atrialContraction: atrial,
    atrialHold,
    mitralFlowMlps: qmv,
    aorticFlowMlps: qao,
    edvMl: tables.edvMl,
    esvMl: tables.esvMl,
  };
}
