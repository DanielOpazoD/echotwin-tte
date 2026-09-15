import {
  heartAnchors,
  ROOT_EXCURSION,
  type HeartModel,
  type HeartPose,
} from '@/simulator/anatomy/heartModel';
import { valveEventTimes, type BeatTables } from '@/simulator/cardiac-cycle/cycleModel';
import { CLICK_SIGMA_S } from './spectrum';

/** Distance (cm) at which a valve's click has fallen to 1/e: its leaflets must lie in or next to the sample volume. */
const CLICK_REACH_CM = 0.5;
/** Axial extent (cm) the leaflets of a valve sweep from its annulus as they open and close. */
const LEAFLET_SWEEP_CM = 1.5;

/** Distance (cm) from a point to the cylinder a valve's leaflets sweep: the annulus radius, from its plane along its axis. */
function valveDistance(
  px: number,
  py: number,
  pz: number,
  cx: number,
  cy: number,
  cz: number,
  ax: number,
  ay: number,
  az: number,
  radius: number,
): number {
  const dx = px - cx,
    dy = py - cy,
    dz = pz - cz;
  const t = dx * ax + dy * ay + dz * az;
  const radial = Math.max(0, Math.hypot(dx - ax * t, dy - ay * t, dz - az * t) - radius);
  const axial = t < 0 ? -t : t > LEAFLET_SWEEP_CM ? t - LEAFLET_SWEEP_CM : 0;
  return Math.hypot(radial, axial);
}

/** Weight of a Gaussian click of CLICK_SIGMA_S centred on `event` at `t`, both in seconds from the start of a beat of `rr`. */
function clickTime(t: number, event: number, rr: number): number {
  let d = Math.abs(t - event) % rr;
  if (d > rr / 2) d = rr - d;
  return Math.exp(-0.5 * (d / CLICK_SIGMA_S) ** 2);
}

/**
 * Valve click (decision 103) for a spectral column at `timeInBeatS`, sampled at heart-frame `points` (x, y, z, …): the PW
 * gate centre and ends or the points of a CW line. Each valve clicks as it opens and as it closes, 1 with its leaflets at a
 * point and fading as they lie farther from the nearest one.
 */
export function valveClickWeight(
  heart: HeartModel,
  hp: HeartPose,
  tables: BeatTables,
  timeInBeatS: number,
  points: ArrayLike<number>,
): number {
  const A = heartAnchors(heart);
  const events = valveEventTimes(tables);
  const rr = tables.rrS;
  const valves: {
    c: [number, number, number];
    a: [number, number, number];
    r: number;
    times: [number, number];
  }[] = [
    { c: [A.mvCenter.x, A.mvCenter.y, hp.zAnn], a: [0, 0, 1], r: A.mvR, times: events.mitral },
    {
      c: [A.avCenter.x, A.avCenter.y, A.avCenter.z + hp.zAnn * ROOT_EXCURSION],
      a: [A.avAxis.x, A.avAxis.y, A.avAxis.z],
      r: A.avR,
      times: events.aortic,
    },
    {
      c: [A.tvCenter.x, A.tvCenter.y, A.tvCenter.z + hp.tvZ],
      a: [0, 0, 1],
      r: A.tvR,
      times: events.tricuspid,
    },
    {
      c: [A.rvotB.x, A.rvotB.y, A.rvotB.z],
      a: [A.paDir.x, A.paDir.y, A.paDir.z],
      r: A.pvR,
      times: events.pulmonary,
    },
  ];
  let weight = 0;
  for (const v of valves) {
    const inTime = Math.max(
      clickTime(timeInBeatS, v.times[0], rr),
      clickTime(timeInBeatS, v.times[1], rr),
    );
    if (inTime < 1e-3) continue;
    let d = Infinity;
    for (let i = 0; i + 2 < points.length; i += 3)
      d = Math.min(
        d,
        valveDistance(
          points[i]!,
          points[i + 1]!,
          points[i + 2]!,
          v.c[0],
          v.c[1],
          v.c[2],
          v.a[0],
          v.a[1],
          v.a[2],
          v.r,
        ),
      );
    const near = Math.exp(-((d / CLICK_REACH_CM) ** 2));
    if (near < 0.02) continue;
    weight += near * inTime;
  }
  return weight;
}
