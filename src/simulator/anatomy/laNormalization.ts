import type { AnchorsCached } from './anchors';
import type { HeartModel } from './heartModel';
import type { CycleState } from '@/simulator/cardiac-cycle/cycleModel';
import { computeChamberPose } from './heartPose';
import { classifyChambers } from './classify';
import { makeSample, Structure } from './tissue';
import { atrialQuadrature, ATRIAL_QUADRATURE_POINTS, sizedLeftAtrium } from './laGeometry';

/** Fit the remaining atrial blood volume after neighbouring structures take their space.
 * Called once after publishing the provisional anchors, before vascular placement.
 * The AP axis stays fixed; transverse and longitudinal axes solve the volume constraint.
 * Nominal end-systole is explicit: this is geometric normalization, not a pressure model.
 */
export function fitOccupiedAtrium(m: HeartModel, a: AnchorsCached, state: CycleState): void {
  let k = a.laR.x / 2.5;
  const sample = makeSample();
  for (let iteration = 0; iteration < 5; iteration++) {
    const hp = computeChamberPose(m, state);
    const top = a.laCenter.z - a.laR.z;
    const bottom = hp.zAnn + 0.25;
    const cz = (top + bottom) / 2,
      rz = (bottom - top) / 2;
    let inside = 0;
    for (let i = 0; i < ATRIAL_QUADRATURE_POINTS; i++) {
      const x = a.laCenter.x + a.laR.x * atrialQuadrature[3 * i]!;
      const y = a.laCenter.y + a.laR.y * atrialQuadrature[3 * i + 1]!;
      const z = cz + rz * atrialQuadrature[3 * i + 2]!;
      if (classifyChambers(m, hp, x, y, z, sample) && sample.structure === Structure.LaCavity)
        inside++;
    }
    const volume = (8 * a.laR.x * a.laR.y * rz * inside) / ATRIAL_QUADRATURE_POINTS;
    if (!(volume > 0)) throw new Error('Atrial normalization has no blood volume');
    if (Math.abs(volume / m.anatomy.la.volumeMl - 1) < 0.002) break;
    k *= Math.sqrt(m.anatomy.la.volumeMl / volume);
    const shape = sizedLeftAtrium(k, m.anatomy.la.apDiameterCm);
    a.laCenter = shape.center;
    a.laR = shape.radii;
  }
}
