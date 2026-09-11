/**
 * Unit conventions (spec 54). Internally: lengths in cm, velocities in m/s, pressures in mmHg,
 * volumes in mL, time in seconds, cardiac phase normalized [0,1). Conversions are explicit.
 */
export const cmToMm = (cm: number): number => cm * 10;
export const mmToCm = (mm: number): number => mm / 10;
export const cmToM = (cm: number): number => cm / 100;
export const mToCm = (m: number): number => m * 100;
export const mpsToCmps = (mps: number): number => mps * 100;
export const cmpsToMps = (cmps: number): number => cmps / 100;
export const sToMs = (s: number): number => s * 1000;
export const msToS = (ms: number): number => ms / 1000;
export const bpmToPeriodS = (bpm: number): number => 60 / bpm;
export const periodSToBpm = (s: number): number => 60 / s;
export const SPEED_OF_SOUND_MPS = 1540; // conventional soft-tissue value (spec 7.2)
