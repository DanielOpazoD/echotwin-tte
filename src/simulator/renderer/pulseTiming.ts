import { SPEED_OF_SOUND_MPS } from '@/core/units';

/** Switching/reverberation allowance per pulse; scanner assumption, not a measured device. */
const LINE_OVERHEAD_S = 0.00002;

/** Mean duplex time budget: scanner assumption, not an explicit gapped pulse schedule. */
export const DUPLEX_BMODE_SHARE = 0.25;

export function lineTimeS(depthCm: number): number {
  return (2 * (depthCm / 100)) / SPEED_OF_SOUND_MPS + LINE_OVERHEAD_S;
}

/** Conventional range-unambiguous Doppler, v_N = c·PRF/(4·f0), without angle correction.
 * f0 is the transmitted fundamental: the B-mode harmonics switch does not double it.
 * HPRF and its range ambiguity are deliberately not represented.
 */
export function pulsedAcquisition(
  depthCm: number,
  frequencyMHz: number,
  requestedScaleMps: number,
  activeFraction = 1,
) {
  const maxPrfHz = 1 / lineTimeS(Math.max(0.1, depthCm));
  const hzPerMps = (4 * Math.max(0.1, frequencyMHz) * 1e6) / SPEED_OF_SOUND_MPS;
  const maxScaleMps = maxPrfHz / hzPerMps;
  const scaleMps = Math.min(maxScaleMps, Math.max(0.01, requestedScaleMps));
  const prfHz = scaleMps * hzPerMps;
  // Intra-packet PRF sets Nyquist. B-mode gaps reduce the mean pulse count, not that PRF.
  return {
    scaleMps,
    maxScaleMps,
    prfHz,
    maxPrfHz,
    meanPrfHz: prfHz * activeFraction,
    activeFraction,
  };
}
