import type { AnchorsCached } from './anchors';
import type { HeartModel } from './heartModel';
import type { CycleState } from '@/simulator/cardiac-cycle/cycleModel';
import { computeChamberPose } from './heartPose';
import { classifyChambers } from './classify';
import { makeSample, Structure } from './tissue';
import {
  atrialQuadrature,
  ATRIAL_QUADRATURE_POINTS,
  LA_LATERAL_HINGE_CM,
  sizedLeftAtrium,
} from './laGeometry';

/** Most steps of the volume fit; the fit stops once the volume is within 0.2 % of the declared one. */
const ATRIAL_FIT_MAX_STEPS = 6;

/**
 * The blood volume of the left atrium as it is drawn at `state` (mL), by quadrature over a box that holds the body, its
 * prism back to the posterior wall (decision 330) and the lateral wall on the lateral hinge (decision 366); the centroid
 * of the blood counted is the landmark of the cavity (decision 330).
 */
function measureLa(
  m: HeartModel,
  a: AnchorsCached,
  state: CycleState,
  sample: ReturnType<typeof makeSample>,
): number {
  const hp = computeChamberPose(m, state);
  const top = a.laCenter.z - a.laR.z;
  const bottom = hp.zAnn + 0.25;
  const cz = (top + bottom) / 2,
    rz = (bottom - top) / 2;
  // the wall's distance from the centre along its normal (and nothing behind the wall)
  const n = a.laPostN;
  const ahead = Math.max(0, a.laPostD - (a.laCenter.x * n.x + a.laCenter.y * n.y + cz * n.z));
  const latReach = hp.valves.mitral.cx + hp.valves.mitral.R + LA_LATERAL_HINGE_CM - a.laCenter.x;
  const ex = Math.max(a.laR.x, latReach) + Math.max(0, n.x) * ahead,
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
  a.laCentroid = { x: sumX / inside, y: sumY / inside, z: sumZ / inside };
  const volume = (8 * hx * hy * hz * inside) / ATRIAL_QUADRATURE_POINTS;
  if (!(volume > 0)) throw new Error('Atrial normalization has no blood volume');
  return volume;
}

/**
 * Solve the declared volume for a scale s by the secant on the logarithms: the volume grows with a power of the scale,
 * read from the last two steps, `p0` on the first (with the square alone the body's fit took 7-8 steps of 16384 samples,
 * and the model build cost 2.3 times the base's; with the secant 2-4 steps).
 */
function solveVolume(
  m: HeartModel,
  a: AnchorsCached,
  state: CycleState,
  s0: number,
  p0: number,
  apply: (s: number) => void,
): void {
  const sample = makeSample();
  let s = s0;
  let prevLnS = NaN,
    prevLnV = NaN;
  for (let iteration = 0; iteration < ATRIAL_FIT_MAX_STEPS; iteration++) {
    const volume = measureLa(m, a, state, sample);
    if (Math.abs(volume / m.anatomy.la.volumeMl - 1) < 0.002) return;
    const lnS = Math.log(s),
      lnV = Math.log(volume);
    const p =
      Number.isFinite(prevLnS) && Math.abs(lnS - prevLnS) > 1e-6
        ? Math.min(3, Math.max(0.2, (lnV - prevLnV) / (lnS - prevLnS)))
        : p0;
    prevLnS = lnS;
    prevLnV = lnV;
    s *= Math.pow(m.anatomy.la.volumeMl / volume, 1 / p);
    apply(s);
  }
}

/** Fit the remaining atrial blood volume after neighbouring structures take their space.
 * Called once after publishing the provisional anchors, before vascular placement.
 * The AP axis stays fixed; transverse and longitudinal axes solve the volume constraint.
 * Nominal end-systole is explicit: this is geometric normalization, not a pressure model.
 *
 * The volume grows with a power of the radial scale between the square (a body whose AP axis is declared) and nothing
 * (the prism to the posterior wall and the base on the annulus do not scale, decision 330). The lateral wall of decision
 * 366 is counted with the body: paid with the body's half length alone the roof came down 3.4 mm (the dome holds little
 * volume), with its transverse radius alone the radius fell 20 %; scaled whole it costs 1–3 % of the scale.
 */
export function fitOccupiedAtrium(m: HeartModel, a: AnchorsCached, state: CycleState): void {
  const wall = { nx: a.laPostN.x, ny: a.laPostN.y, nz: a.laPostN.z, d: a.laPostD };
  solveVolume(m, a, state, a.laR.x / 2.5, 2, (k) => {
    const shape = sizedLeftAtrium(k, m.anatomy.la.apDiameterCm, wall);
    a.laCenter = shape.center;
    a.laR = shape.radii;
  });
}
