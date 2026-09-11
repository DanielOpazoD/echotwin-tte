/**
 * 8-bit logarithmic code of the two-way transmission (1e-4..1): u = round(−ln t / TRANS_K · 255).
 * One step is 3.7 % of the value, fine for the shadow thresholds of view analysis and Doppler. Shared by
 * the atlas cache (compact frames) and the GPU console, whose packed read-back carries it (decision 54).
 */
export const TRANS_K = 9.2;
export const TRANS_DECODE = Float32Array.from({ length: 256 }, (_, u) => Math.exp((-u * TRANS_K) / 255));

export function encodeTransmission(t: number): number {
  const v = Math.round((-Math.log(Math.max(1e-4, Math.min(1, t))) / TRANS_K) * 255);
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

export function decodeTransmission(u: number): number {
  return Math.exp((-u * TRANS_K) / 255);
}
