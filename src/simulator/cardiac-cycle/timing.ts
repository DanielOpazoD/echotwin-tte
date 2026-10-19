import type { PhysiologyConfig, RhythmConfig } from '@/cases/schema';

/**
 * Cardiac cycle timing model. Phase 0 = mitral closure, the mechanical end-diastole; the ECG's QRS onset falls
 * ELECTROMECHANICAL_DELAY_S before it (decision 348). All times in seconds within one beat.
 * Ejection time follows an empirical linear HR dependence (LVET ≈ 0.413 − 0.0017·HR s, clamped),
 * documented in docs/DECISIONS.md as an approximation.
 */
export interface CycleTimings {
  rrS: number;
  ejectionStartS: number; // aortic valve opening: the pre-ejection period after QRS onset, less the electromechanical delay
  ejectionEndS: number; // aortic valve closure
  /** Pulmonary valve opening and closure (decision 162): before the aortic valve opens, after it closes. */
  pulmonaryOpenS: number;
  pulmonaryCloseS: number;
  /** Tricuspid valve opening (decision 162): before the mitral one, the right ventricle relaxing in a shorter time. */
  tricuspidOpenS: number;
  mitralOpenS: number; // end of IVRT
  eAccelS: number; // E-wave acceleration time
  eDecelS: number; // E-wave deceleration time
  eEndS: number;
  aStartS: number; // atrial contraction onset (mechanical); NaN when no organized atrial activity
  aEndS: number;
  pOnsetS: number; // ECG P-wave onset; NaN in AF
  hasAWave: boolean;
}

/**
 * Pre-ejection period (s), QRS onset to aortic valve opening, at a heart rate (decision 162): Weissler's regression for
 * men, 131 − 0.4·HR ms, the companion of the ejection time `ejectionTimeS` uses (413 − 1.7·HR ms), so the electromechanical
 * systole QS2 comes out at its own regression, 546 − 2.1·HR ms. It was a fixed 60 ms, 40–50 ms short at rest: the
 * aortic valve opened at 60 ms and the whole of systole ran early against the ECG.
 */
export function preEjectionPeriodS(heartRateBpm: number, contractility = 1): number {
  // a weaker ventricle takes longer to raise its pressure to the aortic one (decision 348): PEP/LVET, 0.35 ± 0.04 in
  // health, passes 0.44 with left ventricular dysfunction (Weissler and Garrard); the factor brings the heart failure
  // case (contractility 0.45) to 0.55
  const weaker = Math.min(1.8, Math.max(0.8, 2 - contractility));
  return Math.min(0.2, Math.max(0.07, (0.131 - 0.0004 * heartRateBpm) * weaker));
}

/**
 * QRS onset to mitral closure (s), the electromechanical delay that opens the pre-ejection period (decision 348). Phase 0
 * of the cycle is the mitral closure — the end of the A wave, where the end-diastolic frames are taken — and the ECG
 * draws its QRS this much earlier, so Weissler's pre-ejection period still runs from the QRS onset while the isovolumic
 * contraction, from mitral closure to aortic opening, is what is left of it: 55 ms at 65 bpm. Counted from phase 0 as if
 * it were the QRS onset, the whole 105 ms had been isovolumic contraction: the healthy heart's Tei index read
 * (105 + 75) / 303 = 0.59 against 0.39 ± 0.05 (Tei 1995), and end-diastole to end-systole 408 ms against 320 [300–360]
 * in EchoNet-Dynamic's normal videos at the same heart rate (decision 347).
 */
export const ELECTROMECHANICAL_DELAY_S = 0.05;
/** P-wave onset to the onset of atrial contraction (s): 90 ms, so the A wave ends at mitral closure with a 160 ms PR. */
export const P_TO_ATRIAL_CONTRACTION_S = 0.09;
/** Time (s) the leaflets take to close from diastasis at the onset of systole when no atrial contraction closes them first. */
export const SYSTOLIC_CLOSURE_S = 0.03;

/**
 * Where the QRS onset falls before phase 0 (s). With an A wave, phase 0 is its end, the mitral closure: the whole
 * electromechanical delay. Without one (atrial fibrillation) the leaflets close over the first SYSTOLIC_CLOSURE_S of
 * systole, and phase 0 is where they start: the QRS falls that much less before it, so the mitral valve closes at the
 * same delay after the QRS onset in both rhythms (decision 348).
 */
export function qrsBeforePhase0S(hasAWave: boolean): number {
  return hasAWave ? ELECTROMECHANICAL_DELAY_S : ELECTROMECHANICAL_DELAY_S - SYSTOLIC_CLOSURE_S;
}
/**
 * Right-sided valve events against the left-sided ones (decision 162). The right ventricle contracts and relaxes
 * against a fifth of the left one's pressure: its isovolumic periods are shorter, so the pulmonary valve opens before the
 * aortic one and closes after it (the physiological splitting of the second heart sound, P2 after A2 by 20–40 ms), the
 * tricuspid valve opens before the mitral one and closes after it (T1 after M1). They used to follow the left side one
 * hundredth of the beat apart in the same direction for every event, which closed the pulmonary valve before the aortic
 * one and opened the tricuspid after the mitral.
 */
export const PULMONARY_LEAD_S = 0.015;
export const PULMONARY_SPLIT_S = 0.025;
export const TRICUSPID_LEAD_S = 0.02;
export const TRICUSPID_LAG_S = 0.02;
export const PR_INTERVAL_S = 0.16;
export const A_WAVE_DURATION_S = 0.13;

export function ejectionTimeS(heartRateBpm: number, contractility = 1): number {
  const et = 0.413 - 0.0017 * heartRateBpm;
  const adj = et * (1 - 0.08 * (contractility - 1));
  return Math.min(0.36, Math.max(0.16, adj));
}

/**
 * Cycle timings of a beat of length `rrS`. The ejection time follows the heart rate of `ejectionRrS`: the beat's own RR in a
 * regular rhythm, and in atrial fibrillation the RR before it, whose filling the ventricle ejects (decision 107).
 */
export function computeCycleTimings(
  rrS: number,
  physiology: PhysiologyConfig,
  rhythm: RhythmConfig,
  ejectionRrS = rrS,
): CycleTimings {
  const et = Math.min(ejectionTimeS(60 / ejectionRrS, physiology.contractility), rrS * 0.55);
  const hasAWave = rhythm.type !== 'atrial-fibrillation' && physiology.aPeakMps > 0;
  const ejectionStartS =
    preEjectionPeriodS(60 / rrS, physiology.contractility) - qrsBeforePhase0S(hasAWave);
  const ejectionEndS = ejectionStartS + et;
  const ivrt = physiology.ivrtMs / 1000;
  const mitralOpenS = Math.min(ejectionEndS + ivrt, rrS - 0.05);
  const eAccelS = Math.min(0.1, physiology.decelerationTimeMs / 2000);
  const eDecelS = physiology.decelerationTimeMs / 1000;
  const eEndS = Math.min(mitralOpenS + eAccelS + eDecelS, rrS);
  const pOnsetS = hasAWave ? rrS - PR_INTERVAL_S - ELECTROMECHANICAL_DELAY_S : Number.NaN;
  const aStartS = hasAWave
    ? Math.max(mitralOpenS + 0.02, pOnsetS + P_TO_ATRIAL_CONTRACTION_S)
    : Number.NaN;
  const aEndS = hasAWave ? Math.min(rrS - 0.01, aStartS + A_WAVE_DURATION_S) : Number.NaN;
  return {
    rrS,
    ejectionStartS,
    ejectionEndS,
    pulmonaryOpenS: ejectionStartS - PULMONARY_LEAD_S,
    pulmonaryCloseS: Math.min(ejectionEndS + PULMONARY_SPLIT_S, mitralOpenS - TRICUSPID_LEAD_S),
    tricuspidOpenS: mitralOpenS - TRICUSPID_LEAD_S,
    mitralOpenS,
    eAccelS,
    eDecelS,
    eEndS,
    aStartS,
    aEndS,
    pOnsetS,
    hasAWave,
  };
}

/**
 * Normalized ejection flow shape on u∈[0,1]. Through a normal valve it peaks early (≈ 0.40 of ET) and its mean gradient is
 * half the peak one. A stenotic valve's jet peaks later and is rounder (decision 298): `stenosis` 0…1 moves the peak to
 * ≈ 0.48 of ET and the mean-to-peak gradient ratio from 0.50 to 0.62, the ≈ 0.6 of severe aortic stenosis — with one
 * shape for every valve, a severe stenosis of Vmax 4.7 m/s read a mean gradient of 44 mmHg and any Vmax of 4.0–4.4
 * would have read a falsely discordant mean gradient under 40.
 */
export function ejectionShape(u: number, stenosis = 0): number {
  if (u <= 0 || u >= 1) return 0;
  const s = Math.min(1, Math.max(0, stenosis));
  return Math.pow(u, 0.9 - 0.3 * s) * Math.pow(1 - u, 1.35 - 0.7 * s);
}

/** How stenotic an effective aortic valve area (cm²) is for the ejection shape: 0 from 1.5 cm², 1 at 0.9 cm² and below. */
export function aorticStenosisSeverity(effectiveAreaCm2: number): number {
  return Math.min(1, Math.max(0, (1.5 - effectiveAreaCm2) / 0.6));
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
