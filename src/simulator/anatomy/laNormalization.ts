import type { AnchorsCached } from './anchors';
import type { HeartModel } from './heartModel';
import type { CycleState } from '@/simulator/cardiac-cycle/cycleModel';
import { computeChamberPose } from './heartPose';
import { classifyChambers } from './classify';
import { makeSample, Structure } from './tissue';
import { atrialQuadrature, ATRIAL_QUADRATURE_POINTS, sizedLeftAtrium } from './laGeometry';

/** Most steps of the volume fit; the fit stops once the volume is within 0.2 % of the declared one. */
const ATRIAL_FIT_MAX_STEPS = 6;

/** Fit the remaining atrial blood volume after neighbouring structures take their space.
 * Called once after publishing the provisional anchors, before vascular placement.
 * The AP axis stays fixed; transverse and longitudinal axes solve the volume constraint.
 * Nominal end-systole is explicit: this is geometric normalization, not a pressure model.
 */
export function fitOccupiedAtrium(m: HeartModel, a: AnchorsCached, state: CycleState): void {
  let k = a.laR.x / 2.5;
  const sample = makeSample();
  const wall = { nx: a.laPostN.x, ny: a.laPostN.y, nz: a.laPostN.z, d: a.laPostD };
  // the volume grows with a power of the radial scale between the square (a body whose AP axis is declared) and
  // nothing (the prism to the posterior wall and the base on the annulus do not scale, decision 330): the exponent is
  // read from the last two steps, the square on the first (with the square alone the fit took 7-8 steps of 16384
  // samples, and the model build cost 2.3 times the base's; with the secant 2-4 steps)
  let prevLnK = NaN,
    prevLnV = NaN;
  for (let iteration = 0; iteration < ATRIAL_FIT_MAX_STEPS; iteration++) {
    const hp = computeChamberPose(m, state);
    const top = a.laCenter.z - a.laR.z;
    const bottom = hp.zAnn + 0.25;
    const cz = (top + bottom) / 2,
      rz = (bottom - top) / 2;
    // the box holds the body and its prism back to the posterior wall (decision 330): the wall's distance from the
    // centre along its normal (and nothing behind the wall)
    const n = a.laPostN;
    const ahead = Math.max(0, a.laPostD - (a.laCenter.x * n.x + a.laCenter.y * n.y + cz * n.z));
    const ex = a.laR.x + Math.max(0, n.x) * ahead,
      ey = a.laR.y + Math.max(0, n.y) * ahead,
      ez = rz + Math.max(0, n.z) * ahead;
    const sx = a.laR.x + Math.max(0, -n.x) * ahead,
      sy = a.laR.y + Math.max(0, -n.y) * ahead,
      sz = rz + Math.max(0, -n.z) * ahead;
    const hx = (ex + sx) / 2,
      hy = (ey + sy) / 2,
      hz = (ez + sz) / 2;
    const ox = (ex - sx) / 2,
      oy = (ey - sy) / 2,
      oz = (ez - sz) / 2;
    let inside = 0,
      sumX = 0,
      sumY = 0,
      sumZ = 0;
    for (let i = 0; i < ATRIAL_QUADRATURE_POINTS; i++) {
      const x = a.laCenter.x + ox + hx * atrialQuadrature[3 * i]!;
      const y = a.laCenter.y + oy + hy * atrialQuadrature[3 * i + 1]!;
      const z = cz + oz + hz * atrialQuadrature[3 * i + 2]!;
      if (classifyChambers(m, hp, x, y, z, sample) && sample.structure === Structure.LaCavity) {
        inside++;
        sumX += x;
        sumY += y;
        sumZ += z;
      }
    }
    // the centroid of the blood counted: the landmark of the cavity (decision 330)
    a.laCentroid = { x: sumX / inside, y: sumY / inside, z: sumZ / inside };
    const volume = (8 * hx * hy * hz * inside) / ATRIAL_QUADRATURE_POINTS;
    if (!(volume > 0)) throw new Error('Atrial normalization has no blood volume');
    if (Math.abs(volume / m.anatomy.la.volumeMl - 1) < 0.002) break;
    const lnK = Math.log(k),
      lnV = Math.log(volume);
    const p =
      Number.isFinite(prevLnK) && Math.abs(lnK - prevLnK) > 1e-6
        ? Math.min(3, Math.max(0.5, (lnV - prevLnV) / (lnK - prevLnK)))
        : 2;
    prevLnK = lnK;
    prevLnV = lnV;
    k *= Math.pow(m.anatomy.la.volumeMl / volume, 1 / p);
    const shape = sizedLeftAtrium(k, m.anatomy.la.apDiameterCm, wall);
    a.laCenter = shape.center;
    a.laR = shape.radii;
  }
}
