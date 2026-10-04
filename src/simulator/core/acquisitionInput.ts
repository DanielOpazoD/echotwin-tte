import { DUPLEX_BMODE_SHARE, pulsedAcquisition } from '@/simulator/renderer/pulseTiming';
import type { SimInput } from './protocol';

type AcquisitionInput = Pick<
  SimInput,
  'settings' | 'color' | 'spectral' | 'modality' | 'gateDepthCm'
>;

/** Shared by the console store and the headless/worker boundary. No UI-only physics. */
export function acquisitionLimits(input: AcquisitionInput) {
  const { settings, spectral, color } = input;
  const gateDepthCm = Math.max(0.1, Math.min(settings.depthCm, input.gateDepthCm));
  return {
    gateDepthCm,
    color: pulsedAcquisition(
      input.modality === 'cmm' ? settings.depthCm : Math.min(settings.depthCm, color.boxRMaxCm),
      settings.frequencyMHz,
      color.scaleMps,
    ),
    spectral: pulsedAcquisition(
      gateDepthCm + spectral.gateLengthCm / 2,
      settings.frequencyMHz,
      spectral.scaleMps,
      1 - DUPLEX_BMODE_SHARE,
    ),
  };
}

export function constrainAcquisition<T extends AcquisitionInput>(input: T): T {
  const limits = acquisitionLimits(input);
  const pulsed = input.modality === 'pw' || input.modality === 'tdi';
  return {
    ...input,
    gateDepthCm: limits.gateDepthCm,
    color:
      limits.color.scaleMps === input.color.scaleMps
        ? input.color
        : { ...input.color, scaleMps: limits.color.scaleMps },
    spectral:
      !pulsed || limits.spectral.scaleMps === input.spectral.scaleMps
        ? input.spectral
        : { ...input.spectral, scaleMps: limits.spectral.scaleMps },
  };
}
