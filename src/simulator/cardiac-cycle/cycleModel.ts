import type { PhysiologyConfig, RhythmConfig, HemodynamicConfig } from '@/cases/schema';
import { lvotNarrowing, solveLvotObstruction } from './outflow';
import {
  computeCycleTimings,
  ejectionShape,
  eWaveShape,
  aWaveShape,
  TRICUSPID_LAG_S,
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
  /**
   * End-systole (s): the least left ventricular volume, never before aortic closure (decision 245). Without mitral
   * regurgitation it is aortic closure; with it the ventricle keeps emptying into the atrium until the mitral valve opens.
   * The smallest cavity is the end-systolic frame of the chamber quantification guideline (ASE/EACVI 2015).
   */
  endSystoleS: number;
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
  /**
   * The outflow tract (decision 245): its area and whether its obstruction is dynamic (SAM). With it the left ventricular
   * pressure that drives the mitral regurgitation adds a subaortic gradient; without it, only a valvular one.
   */
  outflow?: { lvotAreaCm2: number; dynamicObstruction: boolean };
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
  // AR decays through diastole with the case's pressure half-time. MR runs from mitral closure to mitral opening, driven
  // by the left ventricle's pressure over the atrium's (decision 245): it used to follow the ejection ±20 ms at a speed
  // set by the arterial pressure alone, so it lasted 314–339 ms instead of the 400–475 ms from closure to opening, and in
  // the obstructive cardiomyopathy it read 5.24 m/s where the ventricle pushes against a 64 mmHg outflow gradient too.
  const mrFlow = new Float32Array(n);
  const arFlow = new Float32Array(n);
  const mr = hemo.regurgitation.mr;
  const ar = hemo.regurgitation.ar;
  const arVmax = ar && ar.eroaCm2 > 0 ? Math.sqrt(Math.max(1, hemo.diastolicBpMmHg - 12) / 4) : 0;
  const arPht = ar?.phtMs ?? 450;
  const et = timings.ejectionEndS - timings.ejectionStartS;
  // left ventricular pressure (mmHg) at time t of the beat, with an outflow gradient during ejection
  const lap = MR_LA_PRESSURE_MMHG;
  const dbp = hemo.diastolicBpMmHg,
    sbp = hemo.systolicBpMmHg;
  const ivr = Math.max(0.01, timings.mitralOpenS - timings.ejectionEndS);
  const lvPressure = (t: number, gradient: (t: number) => number): number => {
    if (t < SYSTOLIC_CLOSURE_S || t >= timings.mitralOpenS) return lap;
    if (t < timings.ejectionStartS) {
      // isovolumic contraction: from the atrium's pressure to the aorta's diastolic one
      const x =
        (t - SYSTOLIC_CLOSURE_S) / Math.max(1e-3, timings.ejectionStartS - SYSTOLIC_CLOSURE_S);
      return lap + (dbp - lap) * 0.5 * (1 - Math.cos(Math.PI * x));
    }
    if (t < timings.ejectionEndS) {
      const u = (t - timings.ejectionStartS) / et;
      return dbp + (sbp - dbp) * aorticPulse(u) + gradient(t);
    }
    // isovolumic relaxation: an exponential fall from the end-systolic pressure, reaching the atrium's at mitral opening
    const pEs = dbp + (sbp - dbp) * aorticPulse(1);
    const s = t - timings.ejectionEndS;
    const tail = Math.exp(-ivr / LV_RELAXATION_TAU_S);
    return lap + ((pEs - lap) * (Math.exp(-s / LV_RELAXATION_TAU_S) - tail)) / (1 - tail);
  };
  let mrVmax = 0,
    mrVti = 0;
  const fillMr = (gradient: (t: number) => number): void => {
    mrVmax = 0;
    mrVti = 0;
    if (!mr || mr.eroaCm2 <= 0) return;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) * dt;
      const v = Math.sqrt(Math.max(0, lvPressure(t, gradient) - lap) / 4);
      mrFlow[i] = v * 100 * mr.eroaCm2;
      mrVti += v * 100 * dt;
      mrVmax = Math.max(mrVmax, v);
    }
  };
  // first without the outflow gradient, which needs the forward flow the regurgitation leaves; then with it
  fillMr(() => 0);
  let arVti = 0;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) * dt;
    if (arVmax > 0) {
      const tDia =
        t >= timings.ejectionEndS ? t - timings.ejectionEndS : t + rrS - timings.ejectionEndS; // time since AV closure
      const inDiastole = t >= timings.ejectionEndS || t < timings.ejectionStartS;
      const v = inDiastole ? arVmax * Math.pow(2, -tDia / ((2 * arPht) / 1000)) : 0;
      arFlow[i] = v * 100 * ar!.eroaCm2;
      arVti += v * 100 * dt;
    }
  }
  let shapeInt = 0;
  for (let i = 0; i < 400; i++) shapeInt += ejectionShape((i + 0.5) / 400) * (et / 400);
  if (mr && mr.eroaCm2 > 0) {
    const kFirst = Math.max(5, svTotal - mr.eroaCm2 * mrVti) / shapeInt;
    const aorticFirst = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) * dt;
      if (t > timings.ejectionStartS && t < timings.ejectionEndS)
        aorticFirst[i] = kFirst * ejectionShape((t - timings.ejectionStartS) / et);
    }
    const obstruction = opts.outflow
      ? solveLvotObstruction(
          { n, rrS, timings, aorticFlowMlps: aorticFirst },
          opts.outflow.lvotAreaCm2,
          hemo.lvotPeakGradientMmHg,
          opts.outflow.dynamicObstruction,
        )
      : null;
    // the valvular and the subaortic gradients are in series and add
    fillMr((t) => {
      const q = aorticFirst[Math.min(n - 1, Math.floor(t / dt))] ?? 0;
      if (q <= 0) return 0;
      const vAv = q / hemo.avEffectiveAreaCm2 / 100;
      let g = 4 * vAv * vAv;
      if (obstruction && opts.outflow) {
        const u = (t - timings.ejectionStartS) / et;
        const area =
          opts.outflow.lvotAreaCm2 * (1 - lvotNarrowing(obstruction.fMax, obstruction.dynamic, u));
        const vL = q / Math.max(0.05, area) / 100;
        g += 4 * vL * vL;
      }
      return g;
    });
  }
  // a beat cannot regurgitate more than it ejects: a short beat of atrial fibrillation that filled little lost to the
  // regurgitation computed from pressure alone more than it held, and its volume no longer closed
  if (mrVmax > 0 && mr!.eroaCm2 * mrVti > svTotal - MIN_FORWARD_ML) {
    const k = Math.max(0, svTotal - MIN_FORWARD_ML) / (mr!.eroaCm2 * mrVti);
    for (let i = 0; i < n; i++) mrFlow[i] = (mrFlow[i] ?? 0) * k;
    mrVti *= k;
    // a beat that holds little drives the jet with a lower pressure: its speed falls with its volume
    mrVmax *= k;
  }
  const rvolMr = mrVmax > 0 ? mr!.eroaCm2 * mrVti : 0;
  const rvolAr = arVmax > 0 ? ar!.eroaCm2 * arVti : 0;
  // forward (aortic) ejection = total − MR; mitral inflow = total − AR (the AR volume enters through the aorta)
  const sv = Math.max(MIN_FORWARD_ML, svTotal - rvolMr);
  const svMitral = Math.max(5, svTotal - rvolAr);

  // Ejection: Q_ao = k·shape(u), ∫ = SV
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
  // the tricuspid valve opens TRICUSPID_LEAD_S before the mitral one (decision 162): its early wave runs that much earlier
  const tvLead = timings.mitralOpenS - timings.tricuspidOpenS;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) * dt;
    const atrial = aScale * aCm * aShapeAt(t);
    const v = eAt(t) * mitralEFactor + atrial;
    mvVelocity[i] = v;
    tvVelocity[i] = eAt(t + tvLead) * tricuspidEFactor + atrial;
    velIntegralCm += v * dt;
  }
  // a beat of atrial fibrillation fills through the case's orifice for as long as its diastole lasts (decision 107)
  const mvArea = af
    ? af.mvAreaCm2
    : (hemo.mvEffectiveAreaCm2 ?? svMitral / Math.max(velIntegralCm, 1e-6));
  const scaleMv =
    !af && hemo.mvEffectiveAreaCm2 ? svMitral / Math.max(mvArea * velIntegralCm, 1e-6) : 1; // enforce ∫=SV if area forced

  // Right ventricular ejection (decision 105): the forward stroke volume with a skewed shape peaking at the acceleration
  // time of the case's mean pulmonary pressure (it used to copy the aortic flow, whose peak at 0.4 of ejection gave 121 ms
  // in the normal heart and 108 ms at 72 mmHg), over the right ventricle's own ejection period (decision 162): from the
  // pulmonary opening, before the aortic one, to the pulmonary closure, after it.
  const etRv = timings.pulmonaryCloseS - timings.pulmonaryOpenS;
  const pulmonaryAccelerationS = Math.min(
    0.6 * etRv,
    Math.max(0.12 * etRv, pulmonaryAccelerationTimeS(meanPulmonaryPressureMmHg(hemo.paspMmHg))),
  );
  const peakU = pulmonaryAccelerationS / etRv;
  const pvShape = (u: number): number =>
    u <= 0 || u >= 1 ? 0 : Math.pow(u, 2.25 * peakU) * Math.pow(1 - u, 2.25 * (1 - peakU));
  let pvInt = 0;
  for (let i = 0; i < 400; i++) pvInt += pvShape((i + 0.5) / 400) * (etRv / 400);
  const kPv = Math.max(5, af?.rvEjectMl ?? sv - rvolAr) / pvInt;

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
    const tp = (((t - timings.pulmonaryOpenS) % rrS) + rrS) % rrS;
    if (tp < etRv) pulmonaryFlow[i] = kPv * pvShape(tp / etRv);
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
  // the annuli shorten with the ejection and stop at aortic closure: a regurgitant mitral valve keeps emptying the ventricle
  // through isovolumic relaxation, but the myocardium is no longer shortening, and an annulus that followed that volume
  // drew post-systolic shortening on tissue Doppler (decision 245). Their course reaches its full excursion at aortic closure.
  const atClosure = vol[Math.min(n - 1, Math.floor(timings.ejectionEndS / dt))] ?? esvRef;
  const esvAnnulus = esvRef + Math.max(0, atClosure - minV);
  const contraction = new Float32Array(n);
  for (let i = 0; i < n; i++)
    contraction[i] = Math.min(
      1,
      (edvRef - (vol[i] ?? edvRef)) / Math.max(edvRef - esvAnnulus, 1e-6),
    );
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
  // atrialSpeed > 1 compresses the course during atrial contraction the same way (decision 162), solved below for a′
  let atrialSpeed = 1;
  // speed > 1 compresses the early-diastolic course in time: a healthy annulus recoils ahead of the filling it drives
  // (e′ precedes E), so it can move faster than the volume curve alone allows
  // sysSpeed compresses the ejection course the same way (decision 106): the tricuspid annulus reaches its excursion
  // earlier in systole than the volume curve when its case S′ asks for it
  // the ventricle shortens until its volume is least: at aortic closure, or with a regurgitant mitral valve at its opening,
  // the ventricle still emptying into the atrium through isovolumic relaxation (decision 245)
  let shortenEndS = timings.ejectionEndS;
  {
    // only a regurgitant mitral valve empties the ventricle past aortic closure: a volume that drifts by a few thousandths
    // of a mL through isovolumic relaxation (the periodicity correction) is not a later end-systole
    let regurgitates = false;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) * dt;
      if (t > timings.ejectionEndS && t < timings.mitralOpenS && (mrFlow[i] ?? 0) > 0.5)
        regurgitates = true;
    }
    let least = Infinity;
    if (regurgitates)
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) * dt;
        if (t < timings.ejectionStartS || t > timings.mitralOpenS) continue;
        if ((vol[i] ?? 0) < least - 1e-6) {
          least = vol[i] ?? 0;
          shortenEndS = Math.max(timings.ejectionEndS, t);
        }
      }
  }
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
        const atrialKick = timings.hasAWave && t > timings.aStartS;
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
            : atrialKick
              ? contractionAt(
                  Math.min(timings.aEndS, timings.aStartS + (t - timings.aStartS) * atrialSpeed),
                )
              : (contraction[i] ?? 0);
        const tau = t < timings.ejectionEndS ? SYSTOLIC_TAU_S : t > earlyEnd ? 0.035 : tauE;
        // past aortic closure the annulus only recoils: the myocardium has stopped shortening, and a follower still short of
        // its target kept shortening through isovolumic relaxation and into early diastole (7–14 % of s′ in every case,
        // 22 % with a regurgitant mitral valve, decision 245)
        const step = ((target - l) * dt) / tau;
        if (t < timings.ejectionEndS || step < 0) l += step;
        into[i] = l;
      }
    }
  };
  const peakRecoilCmps = (): number => {
    let peak = 0;
    for (let i = 1; i < n - 1; i++) {
      const t = (i + 0.5) * dt;
      // both neighbours of the central difference inside the window: at its edge it reads the next phase (decision 162)
      if (t - dt < timings.mitralOpenS || t + dt > earlyEnd) continue;
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
      hi = 1.5;
    for (let it = 0; it < 24; it++) {
      const mid = Math.sqrt(lo * hi);
      simulate(mid, 1);
      if (peakRecoilCmps() > ePrime) lo = mid;
      else hi = mid;
    }
    tauEarly = hi;
  }
  simulate(tauEarly, earlySpeed);
  // a′ (decision 162): atrial contraction moves the annulus back towards the atrium by what the atrial filling adds to
  // the ventricle, but over its volume course the tissue Doppler read 3.9 cm/s in the normal heart, where adults show
  // 8–10. The annulus is solved to move ahead of that filling, as it recoils ahead of the early one for e′, until it
  // reaches a′ = A·e′/E: the assumption that tissue and blood keep one ratio in both filling waves (7.6 cm/s here).
  if (timings.hasAWave && physiology.ePeakMps > 0) {
    const aPrimeTarget = (physiology.aPeakMps * physiology.ePrimeSeptalCmps) / physiology.ePeakMps;
    const peakAtrialCmps = (): number => {
      let peak = 0;
      for (let i = 1; i < n - 1; i++) {
        const t = (i + 0.5) * dt;
        if (t - dt < timings.aStartS || t + dt > timings.aEndS) continue;
        peak = Math.max(
          peak,
          (-((longitudinal[i + 1] ?? 0) - (longitudinal[i - 1] ?? 0)) / (2 * dt)) *
            physiology.mapseCm,
        );
      }
      return peak;
    };
    if (peakAtrialCmps() < aPrimeTarget) {
      let lo = 1,
        hi = 6;
      for (let it = 0; it < 20; it++) {
        atrialSpeed = (lo + hi) / 2;
        simulate(tauEarly, earlySpeed);
        if (peakAtrialCmps() < aPrimeTarget) lo = atrialSpeed;
        else hi = atrialSpeed;
      }
      atrialSpeed = hi;
      simulate(tauEarly, earlySpeed);
    }
  }
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
    endSystoleS: shortenEndS,
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
  /**
   * Arterial pressure in the descending aorta behind the left atrium, as a fraction of the pulse pressure above the
   * diastolic one (decision 272): 0 at the foot of the pulse, 1 at the systolic peak.
   */
  aorticPressure: number;
}

/**
 * Transit time (s) of the pulse from the aortic valve to the descending aorta behind the left atrium: some 20 cm of
 * ascending aorta and arch at the aortic pulse wave velocity of a young adult (carotid–femoral 6.2 m/s under 30 years,
 * Reference Values for Arterial Stiffness' Collaboration, Eur Heart J 2010;31:2338-2350). The path length is an assumption
 * and the delay does not grow shorter with age, as the stiffer aorta of the old would make it.
 */
const DESC_AORTA_PULSE_DELAY_S = 0.032;
/**
 * Time constant (s) of the diastolic fall of arterial pressure (the windkessel's resistance × compliance), an assumed
 * typical adult value: the pressure decays from the dicrotic notch toward the next upstroke, which starts from the
 * diastolic pressure.
 */
const ARTERIAL_DECAY_TAU_S = 1.5;

/**
 * Pressure in the descending aorta at time `t` (s) of the beat, as a fraction of the pulse pressure (decision 272): the
 * aortic pulse over ejection, then an exponential diastolic decay from the dicrotic notch that reaches the diastolic
 * pressure as the next ejection starts, delayed by the transit of the pulse along the arch.
 */
export function aorticPressureFraction(tables: BeatTables, t: number): number {
  const tm = tables.timings;
  const rr = tables.rrS;
  const et = Math.max(1e-3, tm.ejectionEndS - tm.ejectionStartS);
  const s = (((t - DESC_AORTA_PULSE_DELAY_S - tm.ejectionStartS) % rr) + rr) % rr;
  if (s < et) return aorticPulse(s / et);
  const diastole = Math.max(1e-3, rr - et);
  const tail = Math.exp(-diastole / ARTERIAL_DECAY_TAU_S);
  return (aorticPulse(1) * (Math.exp(-(s - et) / ARTERIAL_DECAY_TAU_S) - tail)) / (1 - tail);
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

/** Left atrial pressure (mmHg) under a regurgitant mitral valve: the 15 the model has always assumed, not a case value. */
const MR_LA_PRESSURE_MMHG = 15;
/** Time constant (s) of the annuli following the contraction through ejection. */
const SYSTOLIC_TAU_S = 0.03;
/** The least a beat ejects forward (mL), the floor the forward stroke volume always had. */
const MIN_FORWARD_ML = 5;
/**
 * Time constant (s) of isovolumic relaxation: a typical normal value of the monoexponential τ (some 30–50 ms), taken as an
 * assumption for every case (decision 245). It shapes the fall of the regurgitant jet's speed; where it ends, at mitral
 * opening, is the case's own.
 */
const LV_RELAXATION_TAU_S = 0.045;

/**
 * Aortic pressure over ejection as a fraction of the pulse pressure above the diastolic one (decision 245): up to the
 * systolic peak at 0.4 of ejection, then down to 0.55 at the dicrotic notch — a shape assumed from the textbook waveform,
 * without a published table behind its numbers.
 */
function aorticPulse(u: number): number {
  if (u <= 0) return 0;
  if (u < 0.4) {
    const s = Math.sin((Math.PI / 2) * (u / 0.4));
    return s * s;
  }
  return 1 - 0.45 * Math.pow(Math.min(1, (u - 0.4) / 0.6), 1.5);
}

/**
 * Leaflet opening of an atrioventricular valve at phase p: it follows the inflow while that opens it wider than
 * DIASTASIS_OPENING, floats at DIASTASIS_OPENING from peak early inflow until atrial contraction peaks, then closes with
 * the end of the A wave — or, without one, in the first SYSTOLIC_CLOSURE_S of systole.
 */
function inflowOpening(
  tables: BeatTables,
  p: number,
  qMax: number,
  table: Float32Array = tables.mitralFlowMlps,
  side: 'mitral' | 'tricuspid' = 'mitral',
): number {
  const x = ((p % 1) + 1) % 1;
  const flow = Math.min(1, Math.pow(Math.max(0, sampleTable(table, x)) / qMax, 0.6));
  const tm = tables.timings;
  const t = x * tables.rrS;
  // the tricuspid valve opens at its own time and closes TRICUSPID_LAG_S after the mitral one (T1 after M1, decision 162)
  const openS = side === 'tricuspid' ? tm.tricuspidOpenS : tm.mitralOpenS;
  // closing runs on a clock TRICUSPID_LAG_S late: before it reaches zero the valve is still in the previous beat's end
  const tc = t - (side === 'tricuspid' ? TRICUSPID_LAG_S : 0);
  const afterE = t >= openS + tm.eAccelS;
  let floor = 0;
  if (tm.hasAWave) {
    const tw = ((tc % tables.rrS) + tables.rrS) % tables.rrS;
    const u = (tw - tm.aStartS) / (tm.aEndS - tm.aStartS);
    if (afterE && u < 0.5) floor = DIASTASIS_OPENING;
    else if (u >= 0.5 && u < 1) floor = DIASTASIS_OPENING * aWaveShape(u);
  } else if (afterE || tc < 0) floor = DIASTASIS_OPENING;
  else if (tc < SYSTOLIC_CLOSURE_S) floor = DIASTASIS_OPENING * (1 - tc / SYSTOLIC_CLOSURE_S);
  return Math.max(flow, floor);
}

/**
 * Instants (s from the start of the beat) at which each valve opens and closes, [open, close]: the aortic valve with the
 * start and end of left ventricular ejection, the pulmonary valve with the right ventricle's (before and after it), the
 * mitral valve at the end of isovolumic relaxation and with the end of atrial contraction (or once closed early in systole
 * without one), the tricuspid valve before the mitral one and closing after it (decision 162).
 */
export function valveEventTimes(tables: BeatTables): {
  mitral: [number, number];
  aortic: [number, number];
  tricuspid: [number, number];
  pulmonary: [number, number];
} {
  const tm = tables.timings;
  const mitral: [number, number] = [tm.mitralOpenS, tm.hasAWave ? tm.aEndS : SYSTOLIC_CLOSURE_S];
  return {
    mitral,
    aortic: [tm.ejectionStartS, tm.ejectionEndS],
    tricuspid: [tm.tricuspidOpenS, mitral[1] + TRICUSPID_LAG_S],
    pulmonary: [tm.pulmonaryOpenS, tm.pulmonaryCloseS],
  };
}

export function cycleStateAt(tables: BeatTables, phase: number): CycleState {
  const p = ((phase % 1) + 1) % 1;
  const vol = sampleTable(tables.lvVolumeMl, p);
  const qmv = sampleTable(tables.mitralFlowMlps, p);
  const qao = sampleTable(tables.aorticFlowMlps, p);
  let qmvMax = 1e-6,
    qtvMax = 1e-6,
    qaoMax = 1e-6,
    qpvMax = 1e-6;
  for (let i = 0; i < tables.n; i++) {
    qmvMax = Math.max(qmvMax, tables.mitralFlowMlps[i] ?? 0);
    qtvMax = Math.max(qtvMax, tables.tricuspidFlowMlps[i] ?? 0);
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
    tvOpen: inflowOpening(tables, p, qtvMax, tables.tricuspidFlowMlps, 'tricuspid'),
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
    aorticPressure: aorticPressureFraction(tables, t),
  };
}
