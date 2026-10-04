// @tier slow
import { describe, expect, it } from 'vitest';
import { CASE_INPUTS, loadCaseById } from '@/cases';
import { add, cross, dot, normalize, scale, sub, type Vec3 } from '@/core/vec3';
import { buildCaseModels, REST_PATIENT } from '@/simulator/anatomy/caseModels';
import { computeHeartPose, type HeartPose } from '@/simulator/anatomy/heartModel';
import { torsoToHeart } from '@/simulator/anatomy/heartFrame';
import {
  diaphragmY,
  DESC_AORTA_X,
  DESC_AORTA_Z,
  DESC_AORTA_R,
  descAortaScale,
  type ThoraxModel,
} from '@/simulator/anatomy/thoraxModel';
import { cycleStateAt, sampleTable } from '@/simulator/cardiac-cycle/cycleModel';
import {
  aorticSectionFlow,
  aorticVelocityProfile,
  buildAorticNetwork,
} from './flow-primitives/aorticNetwork';
import { buildFlowParams, sampleFlow, type FlowSample } from './flow-primitives/flowField';

const norm = (p: Vec3) => Math.hypot(p.x, p.y, p.z);
// Independent quadrature of geometric cross-sectional area, to partial outlet sections.
function controlVolume(
  hp: HeartPose,
  thorax: ThoraxModel,
  frame: Parameters<typeof torsoToHeart>[0],
): number {
  const paths = [hp.aorta.geometry.arch, ...hp.aorta.geometry.branches];
  const end = hp.aorta.geometry.arch.at(-1)!,
    z = DESC_AORTA_Z + thorax.columnShiftCm;
  paths.push([
    end,
    {
      p: torsoToHeart(frame, { x: DESC_AORTA_X, y: diaphragmY(thorax, DESC_AORTA_X, z), z }),
      radiusCm: DESC_AORTA_R * descAortaScale(thorax, hp.state.aorticPressure),
    },
  ]);
  let volume = 0;
  for (const [index, path] of paths.entries())
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]!,
        b = path[i]!,
        fraction = index === 0 ? 1 : 0.75,
        L = norm(sub(b.p, a.p));
      // Simpson integration is exact for the squared linear radius, without using the network's volume routine.
      const ra = a.radiusCm,
        rb = ra + (b.radiusCm - ra) * fraction,
        rm = (ra + rb) / 2;
      volume += (Math.PI * L * fraction * (ra * ra + 4 * rm * rm + rb * rb)) / 6;
    }
  return volume;
}

describe('aortic spatial flow follows the moving vascular control volume', () => {
  for (const { id } of CASE_INPUTS)
    it(`${id}: sampled outlet flux plus geometric storage equals valve inflow`, () => {
      const c = loadCaseById(id),
        { heart, thorax, tables } = buildCaseModels(c, REST_PATIENT),
        flow = buildFlowParams(c, heart, tables, thorax);
      const out: FlowSample = { vx: 0, vy: 0, vz: 0, present: 0, dispersion: 0 };
      for (const phase of [0.12, 0.22, 0.44, 0.78]) {
        const hp = computeHeartPose(heart, cycleStateAt(tables, phase)),
          network = buildAorticNetwork(heart, thorax, tables, hp, phase);
        let flux = 0;
        for (const index of [48, 49, 50, 51]) {
          const [a, b] = network.edges[index]!,
            u = 0.75,
            centre = add(a.p, scale(sub(b.p, a.p), u));
          const axis = normalize(sub(b.p, a.p)),
            e1 = normalize(
              cross(axis, Math.abs(axis.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 }),
            ),
            e2 = cross(axis, e1);
          const R = a.radiusCm + (b.radiusCm - a.radiusCm) * u;
          for (let j = 0; j < 32; j++)
            for (let k = 0; k < 48; k++) {
              const r = R * Math.sqrt((j + 0.5) / 32),
                angle = (2 * Math.PI * (k + 0.5)) / 48,
                p = add(
                  centre,
                  add(scale(e1, r * Math.cos(angle)), scale(e2, r * Math.sin(angle))),
                );
              sampleFlow(flow, tables, hp, phase, p.x, p.y, p.z, out);
              flux +=
                (dot({ x: out.vx, y: out.vy, z: out.vz }, axis) * 100 * Math.PI * R * R) /
                (32 * 48);
            }
        }
        // Half the network's differentiation interval independently checks its resolution.
        const h = 0.5 / tables.n;
        const before = computeHeartPose(heart, cycleStateAt(tables, phase - h)),
          after = computeHeartPose(heart, cycleStateAt(tables, phase + h));
        const storage =
          (controlVolume(after, thorax, heart.frame) - controlVolume(before, thorax, heart.frame)) /
          (2 * h * tables.rrS);
        const inflow =
          sampleTable(tables.aorticFlowMlps, phase) - sampleTable(tables.arFlowMlps, phase);
        expect(
          Math.abs(flux + storage - inflow),
          `${id} phase=${phase}: flux=${flux}, storage=${storage}, inflow=${inflow}`,
        ).toBeLessThan(Math.max(1, 0.03 * Math.abs(inflow), 0.03 * Math.abs(storage)));
      }
    });
  it('includes the moving section velocity in the absolute blood velocity Doppler samples', () => {
    const c = loadCaseById('normal-excellent-window'),
      { heart, thorax, tables } = buildCaseModels(c, REST_PATIENT),
      phase = 0.22,
      hp = computeHeartPose(heart, cycleStateAt(tables, phase));
    const n = buildAorticNetwork(heart, thorax, tables, hp, phase),
      index = 7,
      u = 0.5,
      [a, b] = n.edges[index]!,
      p = scale(add(a.p, b.p), 0.5),
      axis = normalize(sub(b.p, a.p)),
      R = (a.radiusCm + b.radiusCm) / 2;
    const before = scale(add(n.before[index]![0].p, n.before[index]![1].p), 0.5),
      after = scale(add(n.after[index]![0].p, n.after[index]![1].p), 0.5),
      wall = scale(sub(after, before), 1 / (n.dtS * 100));
    const relative =
      (aorticSectionFlow(n, index, u) / (Math.PI * R * R * 100)) * aorticVelocityProfile(0);
    const out: FlowSample = { vx: 0, vy: 0, vz: 0, present: 0, dispersion: 0 };
    sampleFlow(buildFlowParams(c, heart, tables, thorax), tables, hp, phase, p.x, p.y, p.z, out);
    expect(norm(wall)).toBeGreaterThan(0.001);
    expect(
      norm(sub({ x: out.vx, y: out.vy, z: out.vz }, add(wall, scale(axis, relative)))),
    ).toBeLessThan(1e-5);
  });
});
