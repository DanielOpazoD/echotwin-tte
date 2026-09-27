import {
  meanGradientFromEnvelope,
  simplifiedBernoulli,
  vtiFromEnvelope,
} from '@/clinical/formulas';

/**
 * VTI, peak velocity and Bernoulli gradients of a traced or auto-traced spectral envelope (spec 16.4).
 * UI measurement tools call this instead of the clinical formulas directly (layer rule): the envelope
 * may be signed (CW below baseline), so the magnitude is taken first.
 */
export interface VtiSummary {
  vtiCm: number;
  vmaxMps: number;
  meanGradientMmHg: number;
  peakGradientMmHg: number;
}

export function summarizeEnvelope(velocitiesMps: readonly number[], dtS: number): VtiSummary {
  const vel = velocitiesMps.map(Math.abs);
  const vmaxMps = vel.length ? Math.max(...vel) : 0;
  return {
    vtiCm: vtiFromEnvelope(vel, dtS),
    vmaxMps,
    // the mean gradient is the mean over the flow, not over the time selected (decision 232): a trace that runs past the
    // end of ejection, or over the whole beat, holds columns without flow (0), and averaging them in divided the gradient
    // of a severe stenosis by three
    meanGradientMmHg: meanGradientFromEnvelope(vel.filter((v) => v > 0)),
    peakGradientMmHg: simplifiedBernoulli(vmaxMps),
  };
}
