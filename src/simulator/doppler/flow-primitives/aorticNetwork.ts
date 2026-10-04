import type { Vec3 } from '@/core/vec3';
import { heartToTorso, torsoToHeart } from '@/simulator/anatomy/heartFrame';
import { computeHeartPose, type HeartModel, type HeartPose } from '@/simulator/anatomy/heartModel';
import {
  vascularTubeDistance,
  type TubeDistance,
  type VascularPathPoint,
} from '@/simulator/anatomy/vascularTube';
import {
  DESC_AORTA_R,
  DESC_AORTA_X,
  DESC_AORTA_Z,
  descAortaScale,
  diaphragmY,
  type ThoraxModel,
} from '@/simulator/anatomy/thoraxModel';
import { cycleStateAt, sampleTable, type BeatTables } from '@/simulator/cardiac-cycle/cycleModel';
import type { FlowSample } from './flowField';

/** Reduced incompressible network: dV/dt + Qout - Qin = 0 on each material edge.
 * This solves continuity with prescribed wall motion, not momentum or pulse-wave propagation.
 * See DOI 10.1098/rsif.2020.0881, eq. 2.1; the missing momentum equation is an explicit limitation.
 */
type Edge = readonly [VascularPathPoint, VascularPathPoint];
export interface AorticNetwork {
  edges: Edge[];
  before: Edge[];
  after: Edge[];
  dtS: number;
  storageMlps: Float64Array;
  startMlps: Float64Array;
  outletsMlps: Float64Array;
  inflowMlps: number;
  /** Branch junction's main-edge index and material coordinate. */
  junctions: { segment: number; u: number; branch: number }[];
}
function length(e: Edge): number {
  return Math.hypot(e[1].p.x - e[0].p.x, e[1].p.y - e[0].p.y, e[1].p.z - e[0].p.z);
}
/** Volume of the swept 1-D frustum, not a voxel union of overlapping junctions. cm³ = mL. */
export function vascularEdgeVolume(e: Edge, u = 1): number {
  const r = e[0].radiusCm,
    d = e[1].radiusCm - r;
  return Math.PI * length(e) * (r * r * u + r * d * u * u + (d * d * u * u * u) / 3);
}
function edgesAt(heart: HeartModel, thorax: ThoraxModel, hp: HeartPose): Edge[] {
  const g = hp.aorta.geometry;
  const edges: Edge[] = [];
  for (const path of [g.arch, ...g.branches])
    for (let i = 1; i < path.length; i++) edges.push([path[i - 1]!, path[i]!]);
  const end = g.arch.at(-1)!,
    z = DESC_AORTA_Z + thorax.columnShiftCm;
  edges.push([
    end,
    {
      p: torsoToHeart(heart.frame, { x: DESC_AORTA_X, y: diaphragmY(thorax, DESC_AORTA_X, z), z }),
      radiusCm: DESC_AORTA_R * descAortaScale(thorax, hp.state.aorticPressure),
    },
  ]);
  return edges;
}
function projection(e: Edge, p: Vec3): number {
  const a = e[0].p,
    b = e[1].p,
    dx = b.x - a.x,
    dy = b.y - a.y,
    dz = b.z - a.z;
  return Math.max(
    0,
    Math.min(
      1,
      ((p.x - a.x) * dx + (p.y - a.y) * dy + (p.z - a.z) * dz) / (dx * dx + dy * dy + dz * dz),
    ),
  );
}
function radiusAt(e: Edge, u: number): number {
  return e[0].radiusCm + (e[1].radiusCm - e[0].radiusCm) * u;
}
export function buildAorticNetwork(
  heart: HeartModel,
  thorax: ThoraxModel,
  tables: BeatTables,
  hp: HeartPose,
  phase: number,
): AorticNetwork {
  const p = ((phase % 1) + 1) % 1,
    h = 1 / tables.n;
  // One-sided at the beat boundary: never borrow geometry from the opposite end of an irregular beat.
  const lo = Math.max(0, p - h),
    hi = Math.min(1 - 1e-8, p + h),
    dtS = (hi - lo) * tables.rrS;
  const edges = edgesAt(heart, thorax, hp),
    before = edgesAt(heart, thorax, computeHeartPose(heart, cycleStateAt(tables, lo))),
    after = edgesAt(heart, thorax, computeHeartPose(heart, cycleStateAt(tables, hi)));
  const storageMlps = Float64Array.from(
    edges,
    (_, i) => (vascularEdgeVolume(after[i]!) - vascularEdgeVolume(before[i]!)) / dtS,
  );
  const inflowMlps = sampleTable(tables.aorticFlowMlps, p) - sampleTable(tables.arFlowMlps, p);
  const available = inflowMlps - storageMlps.reduce((a, b) => a + b, 0);
  // Poiseuille r⁴ weights with equal effective downstream lengths, an explicit outlet assumption.
  // The displayed four-centimetre branch stubs are NOT used as peripheral resistance lengths.
  const weights = [48, 49, 50, 51].map((i) => edges[i]![0].radiusCm ** 4),
    sum = weights.reduce((a, b) => a + b, 0);
  const outletsMlps = Float64Array.from(weights, (w) => (available * w) / sum);
  const startMlps = new Float64Array(edges.length);
  const junctions: { segment: number; u: number; branch: number }[] = [];
  for (let branch = 0; branch < 3; branch++) {
    const point = edges[48 + branch]![0].p;
    let best = Infinity,
      segment = 0,
      u = 0;
    for (let i = 0; i < 48; i++) {
      const e = edges[i]!,
        v = projection(e, point),
        a = e[0].p,
        b = e[1].p;
      const d = Math.hypot(
        point.x - a.x - v * (b.x - a.x),
        point.y - a.y - v * (b.y - a.y),
        point.z - a.z - v * (b.z - a.z),
      );
      if (d < best) {
        best = d;
        segment = i;
        u = v;
      }
    }
    junctions.push({ segment, u, branch });
    startMlps[48 + branch] = outletsMlps[branch]! + storageMlps[48 + branch]!;
  }
  let q = inflowMlps;
  for (let i = 0; i < 48; i++) {
    startMlps[i] = q;
    q -= storageMlps[i]!;
    for (const j of junctions) if (j.segment === i) q -= startMlps[48 + j.branch]!;
  }
  startMlps[51] = q;
  return { edges, before, after, dtS, storageMlps, startMlps, outletsMlps, inflowMlps, junctions };
}
export function aorticSectionFlow(n: AorticNetwork, edge: number, u: number): number {
  let q =
    n.startMlps[edge]! -
    (vascularEdgeVolume(n.after[edge]!, u) - vascularEdgeVolume(n.before[edge]!, u)) / n.dtS;
  if (edge < 48)
    for (const j of n.junctions)
      if (j.segment === edge && u >= j.u) q -= n.startMlps[48 + j.branch]!;
  return q;
}
/** Normalized Poiseuille profile: disk average one, no slip at the moving wall.
 * Quasi-steady laminar approximation; pulsatile Womersley flattening and secondary flow are absent.
 */
export function aorticVelocityProfile(relativeRadius: number): number {
  return relativeRadius >= 1 ? 0 : 2 * (1 - relativeRadius * relativeRadius);
}
const cache = new WeakMap<
  HeartPose,
  { tables: BeatTables; phase: number; network: AorticNetwork }
>();
const hit: TubeDistance = { distance: Infinity, nx: 0, ny: 0, nz: 1, segment: -1 };
export function sampleAorticNetwork(
  heart: HeartModel,
  thorax: ThoraxModel,
  tables: BeatTables,
  hp: HeartPose,
  phase: number,
  x: number,
  y: number,
  z: number,
  out: FlowSample,
): boolean {
  const point = { x, y, z },
    g = hp.aorta.geometry,
    start = g.arch[0]!.p,
    axis = hp.aorta.joinAxis;
  let segment = -1;
  if (
    (x - start.x) * axis.x + (y - start.y) * axis.y + (z - start.z) * axis.z >= 0 &&
    vascularTubeDistance(hp.aorta.tube, x, y, z, hit) &&
    hit.distance < 0
  )
    segment = hit.segment;
  else {
    const p = heartToTorso(heart.frame, point),
      az = DESC_AORTA_Z + thorax.columnShiftCm;
    const r = DESC_AORTA_R * descAortaScale(thorax, hp.state.aorticPressure);
    if (
      p.y <= g.descendingTopTorsoY &&
      p.y >= diaphragmY(thorax, p.x, p.z) &&
      Math.hypot(p.x - DESC_AORTA_X, p.z - az) < r
    )
      segment = 51;
  }
  if (segment < 0) return false;
  let saved = cache.get(hp);
  if (!saved || saved.tables !== tables || saved.phase !== phase) {
    saved = { tables, phase, network: buildAorticNetwork(heart, thorax, tables, hp, phase) };
    cache.set(hp, saved);
  }
  const n = saved.network,
    e = n.edges[segment]!,
    u = projection(e, point),
    a = e[0].p,
    b = e[1].p,
    L = length(e),
    r = radiusAt(e, u);
  const dx = b.x - a.x,
    dy = b.y - a.y,
    dz = b.z - a.z;
  const radial = Math.hypot(x - a.x - u * dx, y - a.y - u * dy, z - a.z - u * dz);
  const velocity =
    (aorticSectionFlow(n, segment, u) / (Math.PI * r * r * 100)) *
    aorticVelocityProfile(radial / r);
  // Flux is relative to a moving material section. Doppler receives absolute velocity:
  // centre motion, radial expansion, and minimal rotation of the section (no imposed twist).
  const before = n.before[segment]!,
    after = n.after[segment]!;
  const lb = length(before),
    la = length(after);
  const td = {
    x: ((after[1].p.x - after[0].p.x) / la - (before[1].p.x - before[0].p.x) / lb) / n.dtS,
    y: ((after[1].p.y - after[0].p.y) / la - (before[1].p.y - before[0].p.y) / lb) / n.dtS,
    z: ((after[1].p.z - after[0].p.z) / la - (before[1].p.z - before[0].p.z) / lb) / n.dtS,
  };
  const omega = {
    x: (dy * td.z - dz * td.y) / L,
    y: (dz * td.x - dx * td.z) / L,
    z: (dx * td.y - dy * td.x) / L,
  };
  const rv = { x: x - a.x - u * dx, y: y - a.y - u * dy, z: z - a.z - u * dz };
  const expansion = (radiusAt(after, u) - radiusAt(before, u)) / (n.dtS * r);
  const centreVelocity = (key: keyof Vec3) =>
    (after[0].p[key] +
      u * (after[1].p[key] - after[0].p[key]) -
      (before[0].p[key] + u * (before[1].p[key] - before[0].p[key]))) /
    n.dtS;
  out.vx =
    (velocity * dx) / L +
    (centreVelocity('x') + expansion * rv.x + omega.y * rv.z - omega.z * rv.y) / 100;
  out.vy =
    (velocity * dy) / L +
    (centreVelocity('y') + expansion * rv.y + omega.z * rv.x - omega.x * rv.z) / 100;
  out.vz =
    (velocity * dz) / L +
    (centreVelocity('z') + expansion * rv.z + omega.x * rv.y - omega.y * rv.x) / 100;
  out.dispersion = 0;
  out.present = 1;
  return true;
}
