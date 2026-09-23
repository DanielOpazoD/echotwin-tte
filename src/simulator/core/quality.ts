import { CALIBRATED_TIER } from '@/simulator/renderer/types';
import type { QualityChoice, QualityTier } from './protocol';

/**
 * The tier a quality choice renders with (decision 154). «Auto» is the calibrated tier when the GPU forms the image,
 * the one every clinical comparison measures, and medium on the CPU tracer, which would take about a second per frame
 * at the calibrated tier. Until decision 154 the app opened on medium even with a GPU: a textbook of statistics was
 * calibrated on an image the learner never saw by default.
 */
export function resolveQualityTier(choice: QualityChoice, gpu: boolean): QualityTier {
  if (choice !== 'auto') return choice;
  return gpu ? CALIBRATED_TIER : 'medium';
}
