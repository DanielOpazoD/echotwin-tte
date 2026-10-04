import type { Vec3 } from '@/core/vec3';
import { makeSample, TISSUE_PROPS, Tissue } from '@/simulator/anatomy/tissue';
import type { Scene } from '@/simulator/renderer/types';
import { sceneClassifier } from '@/simulator/anatomy/sceneClassifier';
import {
  ATTEN_NP_PER_DB,
  calciumAttenDb,
  SOFT_TISSUE_ATTEN_DB,
} from '@/simulator/renderer/acoustic/acoustics';
import { DOPPLER_SHADOW_TRANSMISSION } from './color/colorDoppler';

/** 1 mm midpoint quadrature, independent of display resolution; refinements are checked explicitly. */
const PATH_STEP_CM = 0.1;

/**
 * Central-ray propagation at the spectral acquisition phase, never an older B-mode frame.
 * All transverse samples share this pencil ray: partial aperture occlusion is not resolved.
 * The returned query is lazy and advances only to the deepest source requested in this column.
 */
export function acousticAccess(
  scene: Scene,
  origin: Vec3,
  direction: Vec3,
  contact: number,
  stepCm = PATH_STEP_CM,
) {
  const classify = sceneClassifier(scene);
  const sample = makeSample();
  const transmission: number[] = [contact];
  // Doppler is transmitted at the fundamental; the B-mode THI toggle does not change its propagation.
  const k = ATTEN_NP_PER_DB * scene.physics.frequencyMHz * stepCm;
  return (depth: number): boolean => {
    if (contact <= 0 || depth < 0) return false;
    const n = Math.ceil(depth / stepCm);
    while (transmission.length <= n) {
      const i = transmission.length;
      const previous = transmission[i - 1]!;
      if (previous === 0) return false;
      const r = (i - 0.5) * stepCm;
      let t = previous;
      if (
        classify(
          origin.x + direction.x * r,
          origin.y + direction.y * r,
          origin.z + direction.z * r,
          sample,
        )
      ) {
        if (sample.tissue === Tissue.Lung) t = 0;
        else
          t *= Math.exp(
            -(
              TISSUE_PROPS[sample.tissue]!.attenuation +
              calciumAttenDb(sample.extraReflect) -
              SOFT_TISSUE_ATTEN_DB
            ) * k,
          );
      }
      transmission.push(t);
    }
    return transmission[n]! >= DOPPLER_SHADOW_TRANSMISSION;
  };
}
