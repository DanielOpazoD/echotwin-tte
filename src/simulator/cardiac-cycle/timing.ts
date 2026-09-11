import type { PhysiologyConfig, RhythmConfig } from '@/cases/schema';

/**
 * Cardiac cycle timing model. Phase 0 = QRS onset. All times in seconds within one beat.
 * Ejection time follows an empirical linear HR dependence (LVET ≈ 0.413 − 0.0017·HR s, clamped),
 * documented in docs/DECISIONS.md as an approximation.
 */
export interface CycleTimings {
  rrS: number;
  ejectionStartS: number; // aortic valve opening (after electromechanical delay + IVC)
  ejectionEndS: number; // aortic valve closure
  mitralOpenS: number; // end of IVRT
  eAccelS: number; // E-wave acceleration time
  eDecelS: number; // E-wave deceleration time
  eEndS: number;
  aStartS: number; // atrial contraction onset (mechanical); NaN when no organized atrial activity
  aEndS: number;
  pOnsetS: number; // ECG P-wave onset; NaN in AF
  hasAWave: boolean;
}

export const ELECTROMECHANICAL_DELAY_S = 0.06; // QRS onset → AV opening (includes IVC)
export const PR_INTERVAL_S = 0.16;
export const A_WAVE_DURATION_S = 0.13;

export function ejectionTimeS(heartRateBpm: number, contractility = 1): number {
  const et = 0.413 - 0.0017 * heartRateBpm;
  const adj = et * (1 - 0.08 * (contractility - 1));
  return Math.min(0.36, Math.max(0.16, adj));
}

export function computeCycleTimings(rrS: number, physiology: PhysiologyConfig, rhythm: RhythmConfig): CycleTimings {
  const hr = 60 / rrS;
  const et = Math.min(ejectionTimeS(hr, physiology.contractility), rrS * 0.55);
  const ejectionStartS = ELECTROMECHANICAL_DELAY_S;
  const ejectionEndS = ejectionStartS + et;
  const ivrt = physiology.ivrtMs / 1000;
  const mitralOpenS = Math.min(ejectionEndS + ivrt, rrS - 0.05);
  const eAccelS = Math.min(0.1, physiology.decelerationTimeMs / 2000);
  const eDecelS = physiology.decelerationTimeMs / 1000;
  const eEndS = Math.min(mitralOpenS + eAccelS + eDecelS, rrS);
  const hasAWave = rhythm.type !== 'atrial-fibrillation' && physiology.aPeakMps > 0;
  const pOnsetS = hasAWave ? rrS - PR_INTERVAL_S : Number.NaN;
  const aStartS = hasAWave ? Math.max(mitralOpenS + 0.02, pOnsetS + 0.04) : Number.NaN;
  const aEndS = hasAWave ? Math.min(rrS - 0.01, aStartS + A_WAVE_DURATION_S) : Number.NaN;
  return { rrS, ejectionStartS, ejectionEndS, mitralOpenS, eAccelS, eDecelS, eEndS, aStartS, aEndS, pOnsetS, hasAWave };
}

/** Normalized ejection flow shape on u∈[0,1]: skewed with early peak (≈ 0.4 of ET). */
export function ejectionShape(u: number): number {
  if (u <= 0 || u >= 1) return 0;
  return Math.pow(u, 0.9) * Math.pow(1 - u, 1.35);
}

/** Normalized E-wave shape: sine-squared acceleration, then near-linear deceleration. */
export function eWaveShape(tS: number, accelS: number, decelS: number): number {
  if (tS <= 0) return 0;
  if (tS < accelS) {
    const s = Math.sin((Math.PI / 2) * (tS / accelS));
    return s * s;
  }
  const d = (tS - accelS) / decelS;
  if (d >= 1) return 0;
  // slightly convex decay: keeps deceleration slope measurable (DT) while avoiding a hard corner
  return 1 - d * (1 - 0.15 * (1 - d));
}

/** Normalized A-wave shape on u∈[0,1]: half sine. */
export function aWaveShape(u: number): number {
  if (u <= 0 || u >= 1) return 0;
  return Math.sin(Math.PI * u);
}
