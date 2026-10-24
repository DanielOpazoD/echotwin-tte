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
 * The lateral wall of the right atrium rises from the lateral tricuspid hinge (decision 367), as the left atrium's does
 * from the mitral one (decision 366). On the drawn four-chamber plane the atrium's lateral edge, read every 2 mm above
 * the lateral hinge, never steps back toward the septum by more than STEP_MAX_MM between neighbouring heights up to
 * ROOF_MM, stands at least SHELF_MIN_MM beyond the hinge at SHELF_AT_MM (over the top of the ventricular free wall) and
 * at most INSIDE_MAX_MM short of it from BROAD_FROM_MM to BROAD_TO_MM; and from WALL_FROM_MM up no right ventricular wall
 * stands beyond it, and beyond the atrium's wall lies the sac, not nothing. Before the decision the free wall of the ventricle rose 4–8 mm above the hinge, and over it the
 * cavity stepped 9 mm back toward the septum 6–8 mm above the hinge, with its blood against the groove's fat.
 */
const HEIGHTS_MM = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24];
const STEP_MAX_MM = 5;
const ROOF_MM = 20;
const BROAD_FROM_MM = 6;
const BROAD_TO_MM = 18;
const INSIDE_MAX_MM = 1;
const SHELF_AT_MM = 8;
const SHELF_MIN_MM = 2;
const WALL_FROM_MM = 4;
/**
 * How far inside the hinge (mm) the edge stands between BROAD_FROM_MM and BROAD_TO_MM where it is short by more than
 * INSIDE_MAX_MM: the four-chamber plane of the difficult window leaves the wall's arc 14 mm above the hinge in
 * end-diastole, where the body is narrower than the ring.
 */
const KNOWN_RA_EDGE_INSIDE: Record<string, number> = {
  'normal-difficult-window @0': 1.5,
};

interface Row {
  edge: number;
  rvWallBeyond: boolean;
  /** What first lies beyond the atrium's wall: the sac's fat or pericardium, never nothing. */
  beyondWall: Structure;
}

/** Per height above the lateral tricuspid hinge: the atrium's lateral edge beyond it (mm) and whether RV wall lies beyond. */
function lateralProfile(id: string, phase: number): Row[] {
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
  // the right ventricle's side of the image, and its lateral hinge: the outermost tricuspid annulus sample on the plane
  let su = 0;
  for (let d = 5; d < 14; d += 0.25)
    for (let u = -6; u < 6; u += 0.25) if (at(d, u) === Structure.RvCavity) su += u;
  const side = su < 0 ? -1 : 1;
  let hinge = { d: 10, u: 0 };
  let found = false;
  for (const step of [0.05, 0.01]) {
    const d0: number = found ? hinge.d - 0.1 : 5;
    const d1: number = found ? hinge.d + 0.1 : 15;
    const u0: number = found ? hinge.u - 0.1 : -9;
    const u1: number = found ? hinge.u + 0.1 : 9;
    let best: { d: number; u: number } | null = null;
    for (let d = d0; d < d1; d += step)
      for (let u = u0; u < u1; u += step)
        if (at(d, u) === Structure.TricuspidAnnulus && (!best || side * u > side * best.u))
          best = { d, u };
    if (!best)
      throw new Error(`${id} @${phase}: no lateral tricuspid hinge on the four-chamber plane`);
    hinge = best;
    found = true;
  }
  const h = hinge;
  return HEIGHTS_MM.map((mm) => {
    const d = h.d + mm / 10;
    let edge = NaN;
    let lastWall = NaN;
    for (let k = -3; k < 1.5; k += 0.01) {
      const st = at(d, h.u + side * k);
      if (st === Structure.RaCavity) edge = k;
      if (st === Structure.RvWall) lastWall = k;
    }
    let beyondWall = Structure.RaCavity;
    for (let k = edge; k < edge + 1.5; k += 0.01) {
      const st = at(d, h.u + side * k);
      if (st !== Structure.RaCavity && st !== Structure.RaWall) {
        beyondWall = st;
        break;
      }
    }
    return { edge: edge * 10, rvWallBeyond: lastWall * 10 > edge * 10, beyondWall };
  });
}

describe('the lateral wall of the right atrium rises from the lateral tricuspid hinge on the four-chamber plane (decision 367)', () => {
  for (const { id } of CASE_INPUTS)
    for (const phase of [0, 0.35])
      it(`${id} @${phase}`, () => {
        const rows = lateralProfile(id, phase);
        const edges = rows.map((r) => r.edge);
        const profile = edges.map((e) => e.toFixed(1)).join(', ');
        const problems: string[] = [];
        for (let i = 1; i < edges.length && HEIGHTS_MM[i]! <= ROOF_MM; i++) {
          const back = edges[i - 1]! - edges[i]!;
          if (!(back <= STEP_MAX_MM))
            problems.push(
              `steps ${back.toFixed(1)} mm back toward the septum from ${HEIGHTS_MM[i - 1]} to ${HEIGHTS_MM[i]} mm above the hinge (${profile})`,
            );
        }
        const shelf = edges[HEIGHTS_MM.indexOf(SHELF_AT_MM)]!;
        if (!(shelf >= SHELF_MIN_MM))
          problems.push(
            `stands ${shelf.toFixed(1)} mm beyond the hinge at ${SHELF_AT_MM} mm, where it reaches over the free wall by ${SHELF_MIN_MM} (${profile})`,
          );
        const inside = Math.max(
          ...HEIGHTS_MM.map((hm, i) =>
            hm >= BROAD_FROM_MM && hm <= BROAD_TO_MM ? -edges[i]! : -Infinity,
          ),
        );
        const known = KNOWN_RA_EDGE_INSIDE[`${id} @${phase}`];
        if (known !== undefined) {
          if (!(inside > INSIDE_MAX_MM && Math.abs(inside - known) <= 0.3))
            problems.push(
              `stands ${inside.toFixed(1)} mm inside the hinge where KNOWN_RA_EDGE_INSIDE declares ${known} (${profile})`,
            );
        } else if (inside > INSIDE_MAX_MM)
          problems.push(
            `stands ${inside.toFixed(1)} mm inside the hinge between ${BROAD_FROM_MM} and ${BROAD_TO_MM} mm above it (${profile})`,
          );
        const walls = HEIGHTS_MM.filter((hm, i) => hm >= WALL_FROM_MM && rows[i]!.rvWallBeyond);
        if (walls.length > 0)
          problems.push(
            `right ventricular wall beyond the atrium at ${walls.join(', ')} mm above the hinge (${profile})`,
          );
        const open = HEIGHTS_MM.filter((_, i) => rows[i]!.beyondWall === Structure.None);
        if (open.length > 0)
          problems.push(
            `nothing beyond the atrium's wall at ${open.join(', ')} mm above the hinge: the sac does not wrap it (${profile})`,
          );
        expect(problems).toEqual([]);
      });
});
