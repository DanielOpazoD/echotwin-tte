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
  const sv = svNominal * preload;
  const dt = rrS / n;

  // Ejection: Q_ao = k·shape(u), ∫ = SV
  const et = timings.ejectionEndS - timings.ejectionStartS;
  let shapeInt = 0;
  for (let i = 0; i < 400; i++) shapeInt += ejectionShape((i + 0.5) / 400) * (et / 400);
  const kAo = sv / shapeInt;

  // Filling: E and A shapes with peak velocities; solve mitral flow area A_mv so ∫Q_mv = SV.
  const eCm = physiology.ePeakMps * 100 * Math.sqrt(preload);
  const aCm = timings.hasAWave ? physiology.aPeakMps * 100 : 0;
  const eDur = timings.eAccelS + timings.eDecelS;
  let eInt = 0;
  for (let i = 0; i < 400; i++) eInt += eWaveShape(((i + 0.5) / 400) * eDur, timings.eAccelS, timings.eDecelS) * (eDur / 400);
  const aDur = timings.hasAWave ? timings.aEndS - timings.aStartS : 0;
  let aInt = 0;
  for (let i = 0; i < 200; i++) aInt += aWaveShape((i + 0.5) / 200) * (aDur / 200);
  const velIntegralCm = eCm * eInt + aCm * aInt; // cm (VTI of mitral inflow)
  const mvArea = hemo.mvEffectiveAreaCm2 ?? sv / Math.max(velIntegralCm, 1e-6);
  const scaleMv = hemo.mvEffectiveAreaCm2 ? sv / Math.max(mvArea * velIntegralCm, 1e-6) : 1; // enforce ∫=SV if area forced

  const aorticFlow = new Float32Array(n);
  const mitralFlow = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) * dt;
    if (t > timings.ejectionStartS && t < timings.ejectionEndS) {
      aorticFlow[i] = kAo * ejectionShape((t - timings.ejectionStartS) / et);
    }
    let vmv = 0;
    if (t > timings.mitralOpenS) vmv += eCm * eWaveShape(t - timings.mitralOpenS, timings.eAccelS, timings.eDecelS);
    if (timings.hasAWave && t > timings.aStartS && t < timings.aEndS) vmv += aCm * aWaveShape((t - timings.aStartS) / aDur);
    mitralFlow[i] = vmv * mvArea * scaleMv;
  }
  // Integrate volume; then correct tiny drift so V(0)=V(RR)=EDV exactly (ensures periodicity).
  const vol = new Float32Array(n);
  let v = edv;
  for (let i = 0; i < n; i++) {
    v += ((mitralFlow[i] ?? 0) - (aorticFlow[i] ?? 0)) * dt;
    vol[i] = v;
  }
  const drift = v - edv;
  for (let i = 0; i < n; i++) vol[i] = (vol[i] ?? 0) - (drift * (i + 1)) / n;
  let minV = Infinity;
  for (let i = 0; i < n; i++) minV = Math.min(minV, vol[i] ?? 0);

  // Longitudinal annular displacement: follows contraction fraction with a first-order relaxation lag
  // in diastole (τ from e′). e′ ≈ MAPSE·(peak of d(long)/dt during early filling).
  const contraction = new Float32Array(n);
  for (let i = 0; i < n; i++) contraction[i] = (edv - (vol[i] ?? edv)) / Math.max(edv - minV, 1e-6);
  const longitudinal = new Float32Array(n);
  const longVel = new Float32Array(n);
  const tauS = Math.max(0.02, 0.09 * (10 / Math.max(physiology.ePrimeSeptalCmps, 3)));
  let l = 0;
  // two passes for periodic steady state
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      const target = contraction[i] ?? 0;
      const t = (i + 0.5) * dt;
      const inSystole = t < timings.ejectionEndS;
      // systole: the annulus follows the volume curve closely; early diastole: recoil limited by relaxation
      // (τ from e′); atrial systole (A′) pulls the annulus back to its basal position by end-diastole
      const inAtrial = timings.hasAWave && t > timings.aStartS;
      const tau = inSystole ? 0.03 : inAtrial ? 0.035 : tauS;
      l += ((target - l) * dt) / tau;
      longitudinal[i] = l;
    }
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
    edvMl: edv,
    esvMl: minV,
    strokeVolumeMl: edv - minV,
    lvVolumeMl: vol,
    aorticFlowMlps: aorticFlow,
    mitralFlowMlps: mitralFlow,
    mvEffectiveAreaCm2: mvArea * scaleMv,
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
  mitralFlowMlps: number;
  aorticFlowMlps: number;
  edvMl: number;
  esvMl: number;
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
  const mvOpen = Math.min(1, Math.pow(qmv / qmvMax, 0.6));
  const avOpen = Math.min(1, Math.pow(qao / qaoMax, 0.5));
  return {
    phase: p,
    timeInBeatS: t,
    rrS: tables.rrS,
    lvVolumeMl: vol,
    contraction: (tables.edvMl - vol) / Math.max(tables.edvMl - tables.esvMl, 1e-6),
    mvOpen,
    avOpen,
    tvOpen: Math.min(1, Math.pow(sampleTable(tables.mitralFlowMlps, p - 0.01) / qmvMax, 0.6)),
    pvOpen: Math.min(1, Math.pow(sampleTable(tables.aorticFlowMlps, p + 0.01) / qaoMax, 0.5)),
    longitudinal: sampleTable(tables.longitudinal, p),
    atrialContraction: atrial,
    mitralFlowMlps: qmv,
    aorticFlowMlps: qao,
    edvMl: tables.edvMl,
    esvMl: tables.esvMl,
  };
}
