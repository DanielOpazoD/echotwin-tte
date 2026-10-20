/**
 * What the simulator core loads on demand for the experimental image (decision 354): the convolution image formation of
 * decision 351 (point scatterers anchored in tissue, the DAS kernels of a 64-element array, one look) and its GPU side.
 * A chunk of its own, so the simulation worker does not carry the kernels' array model while the lattice image is in use.
 */
import { buildColeKernels } from '@/simulator/renderer/acoustic/colePsf';
import { SCATTER_FIELD } from '@/simulator/renderer/acoustic/scatterers';
import { scatterFieldGpu } from '@/simulator/renderer/gpu/scatterFieldGpu';
import type { ImageFormation } from '@/simulator/renderer/types';

/** Point scatterers with the kernels of a delay-and-sum array, in one look (decision 351). */
export const COLE_FORMATION: ImageFormation = {
  looks: 1,
  scatterers: SCATTER_FIELD,
  kernels: buildColeKernels,
};

/** The same formation for the GPU port. */
export const COLE_GPU = scatterFieldGpu(COLE_FORMATION, 'cole');
