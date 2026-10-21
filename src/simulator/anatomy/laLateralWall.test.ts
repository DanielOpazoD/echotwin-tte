// @tier slow
import { describe, expect, it } from 'vitest';
import { CASE_INPUTS, loadCaseById } from '@/cases';
import { add, scale } from '@/core/vec3';
import { buildCaseModels } from '@/simulator/anatomy/caseModels';
import { torsoToHeart } from '@/simulator/anatomy/heartFrame';
import { classifyHeart, computeHeartPose } from '@/simulator/anatomy/heartModel';
import { makeSample, Structure } from '@/simulator/anatomy/tissue';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import { canonicalControl, VIEW_TARGETS } from '@/simulator/windows/viewTargets';

/**
 * The lateral wall of the left atrium rises from a shelf over the lateral mitral hinge (decision 366). On the drawn
 * four-chamber plane the atrium's lateral edge, read every 2 mm above the lateral hinge, stands at least SHELF_MIN_MM
 * beyond the hinge at SHELF_AT_MM (the shelf over the top of the ventricular wall), never steps back toward the septum by
 * more than STEP_MAX_MM between neighbouring heights up to ROOF_MM (the shelf's upper slope recedes 4 mm per 2 mm in the
 * CT heart; above ROOF_MM the roof of a small atrium curves in), and from BROAD_FROM_MM to BROAD_TO_MM it stands at most
 * INSIDE_MAX_MM short of the hinge; 2 mm above the hinge, where the shelf has not risen, it stays within HINGE_LEVEL_MAX_MM
 * of it. Before the decision the flared base of decision 328 widened 27° from the hinge for
 * 12 mm and then stepped 9–18 mm back to a body 6–13 mm medial of the hinge, in eight of the twelve cases: a wedge
 * pointing laterally. In the mean CT heart (Rodero et al. 2021) the cavity's lateral edge lies 12 mm beyond the hinge
 * 6 mm above it, 3 mm at 12 and 0.5–1.5 mm from 14 to 26.
 */
const HEIGHTS_MM = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24];
const STEP_MAX_MM = 5;
const ROOF_MM = 20;
const BROAD_FROM_MM = 6;
const BROAD_TO_MM = 20;
const INSIDE_MAX_MM = 1;
const SHELF_AT_MM = 8;
const SHELF_MIN_MM = 3;
/** Just above the hinge (2 mm) the edge is still near the ring: the shelf rises from LA_BASE_SHELF_RISE_CM, as in CT. */
const HINGE_LEVEL_MAX_MM = 4;
const HINGE_LEVEL_RISE_MM = 2;

/** The atrium's lateral edge beyond the lateral hinge (mm) at each height above it, along the drawn four-chamber plane. */
function lateralProfile(id: string, phase: number): number[] {
  const c = loadCaseById(id);
  const { heart, thorax, tables } = buildCaseModels(c, {
    position: 'left-lateral',
    respiration: 'expiration',
    headElevationDeg: 0,
  });
  const view = VIEW_TARGETS.find((v) => v.id === 'a4c')!;
  const beam = beamFrameFromPose(poseFromControl(thorax, canonicalControl(view, heart, thorax)), 1);
  const hp = computeHeartPose(heart, cycleStateAt(tables, phase));
  const s = makeSample();
  const at = (d: number, u: number): Structure => {
    const h = torsoToHeart(
      heart.frame,
      add(add(beam.origin, scale(beam.forward, d)), scale(beam.lateral, u)),
    );
    return classifyHeart(heart, hp, h.x + hp.swingX, h.y, h.z, s) ? s.structure : Structure.None;
  };
  // the lateral hinge: the most lateral sample of the mitral annulus on the plane, found coarsely and then refined
  let hinge = { d: 10, u: 0 };
  let found = false;
  for (const step of [0.05, 0.01]) {
    const d0: number = found ? hinge.d - 0.1 : 5;
    const d1: number = found ? hinge.d + 0.1 : 15;
    const u0: number = found ? hinge.u - 0.1 : -4;
    const u1: number = found ? hinge.u + 0.1 : 5;
    let best: { d: number; u: number } | null = null;
    for (let d = d0; d < d1; d += step)
      for (let u = u0; u < u1; u += step)
        if (at(d, u) === Structure.MitralAnnulus && (!best || u > best.u)) best = { d, u };
    if (!best)
      throw new Error(`${id} @${phase}: no lateral mitral hinge on the four-chamber plane`);
    hinge = best;
    found = true;
  }
  const h = hinge;
  return HEIGHTS_MM.map((mm) => {
    const d = h.d + mm / 10;
    let edge = NaN;
    for (let u = h.u - 3; u < h.u + 3; u += 0.01) if (at(d, u) === Structure.LaCavity) edge = u;
    return (edge - h.u) * 10;
  });
}

describe('the lateral wall of the left atrium rises from a shelf over the lateral hinge on the four-chamber plane (decision 366)', () => {
  for (const { id } of CASE_INPUTS)
    for (const phase of [0, 0.35])
      it(`${id} @${phase}`, () => {
        const edges = lateralProfile(id, phase);
        const profile = edges.map((e) => e.toFixed(1)).join(', ');
        const problems: string[] = [];
        for (let i = 1; i < edges.length && HEIGHTS_MM[i]! <= ROOF_MM; i++) {
          const back = edges[i - 1]! - edges[i]!;
          if (!(back <= STEP_MAX_MM))
            problems.push(
              `steps ${back.toFixed(1)} mm back toward the septum from ${HEIGHTS_MM[i - 1]} to ${HEIGHTS_MM[i]} mm above the hinge (${profile})`,
            );
        }
        // (a dilated body wider than its ring still rises from the hinge to the shelf by HINGE_LEVEL_RISE_MM)
        if (!(edges[0]! <= HINGE_LEVEL_MAX_MM || edges[0]! <= edges[2]! - HINGE_LEVEL_RISE_MM))
          problems.push(
            `stands ${edges[0]!.toFixed(1)} mm beyond the hinge 2 mm above it, where the shelf has not risen (${profile})`,
          );
        const shelf = edges[HEIGHTS_MM.indexOf(SHELF_AT_MM)]!;
        if (!(shelf >= SHELF_MIN_MM))
          problems.push(
            `stands ${shelf.toFixed(1)} mm beyond the hinge at ${SHELF_AT_MM} mm, where the shelf reaches ${SHELF_MIN_MM} (${profile})`,
          );
        const inside = Math.max(
          ...HEIGHTS_MM.map((hm, i) =>
            hm >= BROAD_FROM_MM && hm <= BROAD_TO_MM ? -edges[i]! : -Infinity,
          ),
        );
        if (inside > INSIDE_MAX_MM)
          problems.push(
            `stands ${inside.toFixed(1)} mm inside the hinge between ${BROAD_FROM_MM} and ${BROAD_TO_MM} mm above it (${profile})`,
          );
        expect(problems).toEqual([]);
      });
});
