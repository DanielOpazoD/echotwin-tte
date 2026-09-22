// @tier slow
import { describe, expect, it } from 'vitest';
import { CASE_INPUTS, loadCaseById } from '@/cases';
import {
  classifyHeart,
  computeHeartPose,
  createHeartModel,
  heartAnchors,
  heartToTorso,
  ROOT_EXCURSION,
  torsoToHeart,
  type HeartModel,
  type HeartPose,
} from './heartModel';
import { mitralFreeEdge, mitralLeafletPoint, MV_BINS } from './mitralValve';
import { rootRadiusAt } from './aorticValve';
import { rvCrescent } from './rv';
import { tvInflowSdf, skirtDistance, skirtHit, skirtOffset } from './valveSkirt';
import { smin } from './sdf';
import { SimulatorCore } from '@/simulator/core/simulatorCore';
import { baseInput } from '@/simulator/core/baseInput';
import { createThoraxModel, type ThoraxModel } from './thoraxModel';
import { makeSample, Structure, Tissue } from './tissue';
import { buildBeatTables, cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import { add, cross, dot, normalize, scale, sub, v3, type Vec3 } from '@/core/vec3';

/**
 * Valve apparatus and great-vessel continuity (decision 75). These are the "subtleties" a cardiologist sees at once
 * and none of the size measures catches: a wall that steps, a closure line that runs where the cusps do not meet, a
 * leaflet hinged on nothing. Each check reads the implicit model directly, in the heart frame.
 */
function setup(id: string) {
  const c = loadCaseById(id);
  const thorax = createThoraxModel(
    c.bodyHabitus,
    c.acousticWindow,
    { position: 'left-lateral', respiration: 'expiration', headElevationDeg: 0 },
    c.anatomy.ivc.collapsePct,
  );
  const heart = createHeartModel(
    c.anatomy,
    c.physiology,
    thorax.heartOffset,
    c.seed,
    thorax.ivcCollapse,
  );
  const tables = buildBeatTables(
    60 / c.rhythm.heartRateBpm,
    c.physiology,
    c.rhythm,
    c.hemodynamics,
  );
  return { c, heart, tables, thorax };
}

describe('valve apparatus continuity', () => {
  it('the aortic root wall runs without steps from the annulus through the sinuses and junction into the ascending aorta', () => {
    // until 2026-09-13 the lumen diameter jumped by 0.4-0.6 cm at 2.2 and 3.2 cm along the root
    for (const input of CASE_INPUTS) {
      const { heart, tables } = setup(input.id);
      const A = heartAnchors(heart);
      const pose = computeHeartPose(heart, cycleStateAt(tables, 0));
      const s = makeSample();
      const lumen = [Structure.AorticRoot, Structure.AorticValve];
      const diameter = (t: number): number => {
        const cz = A.avCenter.z + pose.zAnn * ROOT_EXCURSION;
        const c0 = [
          A.avCenter.x + A.avAxis.x * t,
          A.avCenter.y + A.avAxis.y * t,
          cz + A.avAxis.z * t,
        ];
        const e = A.avE2;
        const inside = (u: number): boolean =>
          classifyHeart(heart, pose, c0[0]! + e.x * u, c0[1]! + e.y * u, c0[2]! + e.z * u, s) &&
          lumen.includes(s.structure) &&
          s.tissue !== Tissue.VesselWall;
        let a = 0,
          b = 0;
        while (a > -3 && inside(a - 0.01)) a -= 0.01;
        while (b < 3 && inside(b + 0.01)) b += 0.01;
        return b - a;
      };
      let worst = 0,
        at = 0,
        prev = diameter(0.3);
      for (let t = 0.35; t <= 3.6; t += 0.05) {
        const d = diameter(t);
        if (Math.abs(d - prev) > worst) {
          worst = Math.abs(d - prev);
          at = t;
        }
        prev = d;
      }
      expect(
        worst,
        `${input.id}: largest diameter change over 0.5 mm of root, at t = ${at.toFixed(2)} cm`,
      ).toBeLessThan(0.1);
    }
  });

  it('the closed aortic valve has no valve tissue along its axis on the ventricular side of the coaptation band', () => {
    // the coaptation fins used to reach 0.65 cm into the LVOT side and, lying 3.7° from the PLAX plane, drew a long
    // bright line through the middle of the closed valve
    const { heart, tables } = setup('normal-excellent-window');
    const A = heartAnchors(heart);
    const pose = computeHeartPose(heart, cycleStateAt(tables, 0));
    expect(pose.state.avOpen).toBeLessThan(0.2);
    const s = makeSample();
    const cz = A.avCenter.z + pose.zAnn * ROOT_EXCURSION;
    const hits: string[] = [];
    // a thin cylinder of 0.6 mm around the axis, from the annulus to 1 mm below the bottom of the coaptation zone
    const av = pose.valves.aortic;
    expect(av.eH - av.cH).toBeGreaterThan(0.3);
    for (let t = 0.05; t < av.eH - av.cH - 0.1; t += 0.02)
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * 2 * Math.PI;
        const r = 0.03;
        const x =
          A.avCenter.x + A.avAxis.x * t + (A.avE1.x * Math.cos(a) + A.avE2.x * Math.sin(a)) * r;
        const y =
          A.avCenter.y + A.avAxis.y * t + (A.avE1.y * Math.cos(a) + A.avE2.y * Math.sin(a)) * r;
        const z = cz + A.avAxis.z * t + (A.avE1.z * Math.cos(a) + A.avE2.z * Math.sin(a)) * r;
        if (classifyHeart(heart, pose, x, y, z, s) && s.structure === Structure.AorticValve)
          hits.push(t.toFixed(2));
      }
    expect(hits, 'valve tissue on the ventricular side of the coaptation band').toEqual([]);
  });
});

/** The same pose with the mitral leaflets removed (the annulus, chordae and everything else stay). */
const withoutLeaflets = (pose: HeartPose): HeartPose => ({
  ...pose,
  valves: { ...pose.valves, mitral: { ...pose.valves.mitral, thickness: -10 } },
});

/**
 * Closed mitral valve as drawn in a view: displacement of the leaflets toward the atrium (billow) and toward the apex
 * (tenting) relative to the line through the two annulus points the plane cuts.
 */
function closedValveInView(
  heart: HeartModel,
  thorax: ThoraxModel,
  pose: HeartPose,
  viewId: string,
): { billow: number; tenting: number } {
  const beam = beamFrameFromPose(
    poseFromControl(thorax, canonicalControl(getViewTarget(viewId), heart, thorax)),
    1,
  );
  const mv = pose.valves.mitral;
  const d0 = sub(heartToTorso(heart.frame, v3(mv.cx, mv.cy, mv.cz)), beam.origin);
  const cLat = dot(d0, beam.lateral),
    cDep = dot(d0, beam.forward);
  const s = makeSample();
  const ring: [number, number][] = [],
    leaf: [number, number][] = [],
    atrium: [number, number][] = [];
  const STEP = 0.03;
  for (let i = -84; i <= 84; i++)
    for (let j = -84; j <= 84; j++) {
      const lat = cLat + i * STEP,
        dep = cDep + j * STEP;
      const p = torsoToHeart(
        heart.frame,
        add(beam.origin, add(scale(beam.forward, dep), scale(beam.lateral, lat))),
      );
      if (!classifyHeart(heart, pose, p.x, p.y, p.z, s)) continue;
      if (s.structure === Structure.MitralAnnulus) ring.push([lat, dep]);
      else if (
        s.structure === Structure.MitralAnterior ||
        s.structure === Structure.MitralPosterior
      )
        leaf.push([lat, dep]);
      else if (s.structure === Structure.LaCavity) atrium.push([lat, dep]);
    }
  const mean = (q: [number, number][]): [number, number] => [
    q.reduce((a, p) => a + p[0], 0) / q.length,
    q.reduce((a, p) => a + p[1], 0) / q.length,
  ];
  // the plane cuts the annulus twice: split the ring samples along their principal direction
  const [mx, my] = mean(ring);
  let sxx = 0,
    sxy = 0,
    syy = 0;
  for (const [x, y] of ring) {
    sxx += (x - mx) ** 2;
    sxy += (x - mx) * (y - my);
    syy += (y - my) ** 2;
  }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const side = ([x, y]: [number, number]): boolean =>
    (x - mx) * Math.cos(ang) + (y - my) * Math.sin(ang) < 0;
  const [ax, ay] = mean(ring.filter(side)),
    [bx, by] = mean(ring.filter((p) => !side(p)));
  const len = Math.hypot(bx - ax, by - ay);
  let nx = -(by - ay) / len,
    ny = (bx - ax) / len;
  const [lx, ly] = mean(atrium);
  if ((lx - mx) * nx + (ly - my) * ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  let billow = -Infinity,
    tenting = -Infinity;
  for (const [x, y] of leaf) {
    const t = ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / (len * len);
    if (t < 0.08 || t > 0.92) continue;
    const toAtrium = (x - ax) * nx + (y - ay) * ny;
    billow = Math.max(billow, toAtrium);
    tenting = Math.max(tenting, -toAtrium);
  }
  return { billow, tenting };
}

describe('mitral apparatus (decision 76)', () => {
  it('the anterior leaflet hangs from the aortic root and the posterior one from the atrioventricular junction, all through the cycle', () => {
    // Until 2026-09-13 the anterior hinge sat inside the outflow tract, 0.6 cm from its axis, and the posterior hinge
    // 0.2-0.8 cm (diastole) to 1.2 cm (systole) inside the inferolateral wall: in the parasternal long axis the anterior
    // leaflet hung from nothing and the posterior one grew out of myocardium.
    const s = makeSample();
    const problems: string[] = [];
    for (const input of CASE_INPUTS) {
      const { heart, tables } = setup(input.id);
      for (let phase = 0; phase < 1; phase += 0.15) {
        const pose = computeHeartPose(heart, cycleStateAt(tables, phase));
        const mv = pose.valves.mitral;
        const k = MV_BINS >> 1;
        // geometry-frame points are queried with the heart swing of tamponade added back (classifyHeart removes it)
        // anterior: the nearest aortic root wall or fibrous curtain, in the plane of the anteroposterior axis and the long axis
        {
          const L = mv.anterior;
          const hv = L.focusV + L.hinge[k]!,
            hz = mv.cz + L.hingeZ[k]!;
          const hx = mv.cx + mv.ux * hv,
            hy = mv.cy + mv.uy * hv;
          let nearest = Infinity;
          for (let a = -0.5; a <= 0.5; a += 0.03)
            for (let b = -0.5; b <= 0.5; b += 0.03) {
              const r = Math.hypot(a, b);
              if (r >= nearest) continue;
              classifyHeart(heart, pose, hx + mv.ux * a + pose.swingX, hy + mv.uy * a, hz + b, s);
              if (
                (s.tissue === Tissue.VesselWall && s.structure === Structure.AorticRoot) ||
                (s.tissue === Tissue.Fibrous && s.structure !== Structure.MitralAnnulus)
              )
                nearest = r;
            }
          if (nearest > 0.3)
            problems.push(
              `${input.id} @${phase.toFixed(2)}: anterior hinge ${nearest.toFixed(2)} cm from the root wall`,
            );
        }
        // posterior: ventricular blood just inside the hinge (past the fibrous ring), wall behind it
        {
          const L = mv.posterior;
          const hv = L.focusV - L.hinge[k]!,
            hz = mv.cz + L.hingeZ[k]!;
          const hx = mv.cx + mv.ux * hv,
            hy = mv.cy + mv.uy * hv;
          const hidden = withoutLeaflets(pose);
          let blood = Infinity;
          for (let d = 0; d <= 1.2; d += 0.02) {
            classifyHeart(
              heart,
              hidden,
              hx + mv.ux * d + pose.swingX,
              hy + mv.uy * d,
              hz + 0.15,
              s,
            );
            if (s.tissue === Tissue.Blood) {
              blood = d;
              break;
            }
          }
          if (blood > 0.2)
            problems.push(
              `${input.id} @${phase.toFixed(2)}: ${blood.toFixed(2)} cm of tissue between the posterior hinge and the cavity`,
            );
          classifyHeart(heart, hidden, hx - mv.ux * 0.2 + pose.swingX, hy - mv.uy * 0.2, hz, s);
          if (s.tissue === Tissue.Blood)
            problems.push(`${input.id} @${phase.toFixed(2)}: blood behind the posterior annulus`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('open leaflets stay in the blood', () => {
    // the open profiles share their angles; a fibre facing a wall that runs parallel to the long axis (the posterior
    // leaflet under the posterior annulus) or a flattened septum (the anterior leaflet in pulmonary hypertension) used
    // to open through it
    const s = makeSample();
    const pt = [0, 0, 0];
    const problems: string[] = [];
    for (const input of CASE_INPUTS) {
      const { heart, tables } = setup(input.id);
      for (let phase = 0.45; phase < 1; phase += 0.05) {
        const pose = computeHeartPose(heart, cycleStateAt(tables, phase));
        if (pose.valves.mitral.open < 0.5) continue;
        const hidden = withoutLeaflets(pose);
        for (const leaflet of [0, 1] as const)
          for (const q of [-0.8, -0.5, -0.2, 0.2, 0.5, 0.8])
            for (const along of [0.4, 0.7, 1]) {
              mitralLeafletPoint(pose.valves.mitral, leaflet, q, along, pt);
              classifyHeart(heart, hidden, pt[0]! + pose.swingX, pt[1]!, pt[2]!, s);
              if (s.tissue !== Tissue.Blood && s.tissue !== Tissue.Chordae)
                problems.push(
                  `${input.id} @${phase.toFixed(2)} ${leaflet ? 'posterior' : 'anterior'} q ${q} at ${along}: tissue ${s.tissue}, structure ${s.structure}`,
                );
            }
      }
    }
    expect(problems).toEqual([]);
  });

  it('the closed valve coapts apical to the annulus without prolapse in the long axis and four-chamber views, and prolapses when the case says so', () => {
    // A closed body that hugged the height of its hinge put a normal valve 6 mm toward the atrium in the four-chamber
    // view, whose hinges are the low commissural points of the saddle; the prolapse criterion is 2 mm in the long axis.
    const problems: string[] = [];
    for (const input of CASE_INPUTS) {
      if (input.id === 'hocm-sam') continue; // systolic anterior motion: the anterior leaflet leaves the coaptation by design
      const { heart, tables, thorax } = setup(input.id);
      const t = tables.timings;
      const pose = computeHeartPose(
        heart,
        cycleStateAt(
          tables,
          (t.ejectionStartS + 0.5 * (t.ejectionEndS - t.ejectionStartS)) / tables.rrS,
        ),
      );
      const plax = closedValveInView(heart, thorax, pose, 'plax');
      const a4c = closedValveInView(heart, thorax, pose, 'a4c');
      const label = `${input.id}: PLAX billow ${plax.billow.toFixed(2)}, tenting ${plax.tenting.toFixed(2)}; A4C billow ${a4c.billow.toFixed(2)}`;
      if (input.id === 'mvp-primary-mr') {
        if (!(plax.billow > 0.2)) problems.push(`${label} (the prolapse must show)`);
        continue;
      }
      // the dilated, spherical ventricle tethers its valve: tenting height 8–12 mm with functional MR, 5–6 mm normal
      const [lo, hi] = input.id === 'hfref-severe-mr' ? [0.7, 1.2] : [0.15, 0.6];
      if (!(plax.billow <= 0.2 && plax.tenting >= lo && plax.tenting <= hi && a4c.billow <= 0.35))
        problems.push(label);
    }
    expect(problems).toEqual([]);
  });

  it("the tether comes from the papillary muscles, not from the case: longer chordae release the remodelled ventricle's valve (decision 82)", () => {
    const tenting = (c: ReturnType<typeof loadCaseById>): number => {
      const thorax = createThoraxModel(
        c.bodyHabitus,
        c.acousticWindow,
        { position: 'left-lateral', respiration: 'expiration', headElevationDeg: 0 },
        c.anatomy.ivc.collapsePct,
      );
      const heart = createHeartModel(
        c.anatomy,
        c.physiology,
        thorax.heartOffset,
        c.seed,
        thorax.ivcCollapse,
      );
      const tables = buildBeatTables(
        60 / c.rhythm.heartRateBpm,
        c.physiology,
        c.rhythm,
        c.hemodynamics,
      );
      const t = tables.timings;
      const pose = computeHeartPose(
        heart,
        cycleStateAt(
          tables,
          (t.ejectionStartS + 0.5 * (t.ejectionEndS - t.ejectionStartS)) / tables.rrS,
        ),
      );
      return closedValveInView(heart, thorax, pose, 'plax').tenting;
    };
    const hf = loadCaseById('hfref-severe-mr');
    const tethered = tenting(hf);
    // the same ventricle with an apparatus long enough to span its displaced papillary muscles
    const released = tenting({
      ...hf,
      anatomy: {
        ...hf.anatomy,
        mitral: {
          ...hf.anatomy.mitral,
          anteriorLeafletLengthCm: 3.0,
          posteriorLeafletLengthCm: 1.9,
        },
      },
    });
    const normal = tenting(loadCaseById('normal-excellent-window'));
    expect(
      tethered - normal,
      `tenting ${tethered.toFixed(2)} vs normal ${normal.toFixed(2)}`,
    ).toBeGreaterThan(0.3);
    expect(
      Math.abs(released - normal),
      `released ${released.toFixed(2)} vs normal ${normal.toFixed(2)}`,
    ).toBeLessThan(0.08);
  });
});

/** Largest gap (cm) between the pieces of closed tricuspid leaflet drawn in a view; 0 when they form one piece. */
function tricuspidGapInView(
  heart: HeartModel,
  thorax: ThoraxModel,
  pose: HeartPose,
  viewId: string,
): number {
  const beam = beamFrameFromPose(
    poseFromControl(thorax, canonicalControl(getViewTarget(viewId), heart, thorax)),
    1,
  );
  const tv = pose.valves.tv;
  const d0 = sub(heartToTorso(heart.frame, v3(tv.cx + pose.swingX, tv.cy, tv.cz)), beam.origin);
  const cLat = dot(d0, beam.lateral),
    cDep = dot(d0, beam.forward);
  const N = 120,
    STEP = 0.025;
  const s = makeSample();
  const cells: [number, number][] = [];
  const grid = new Uint8Array(N * N);
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) {
      const p = torsoToHeart(
        heart.frame,
        add(
          beam.origin,
          add(
            scale(beam.forward, cDep + (j - N / 2) * STEP),
            scale(beam.lateral, cLat + (i - N / 2) * STEP),
          ),
        ),
      );
      if (
        classifyHeart(heart, pose, p.x, p.y, p.z, s) &&
        s.structure === Structure.TricuspidValve
      ) {
        grid[i * N + j] = 1;
        cells.push([i, j]);
      }
    }
  // flood fill from the first cell; whatever it does not reach is another piece
  const seen = new Uint8Array(N * N);
  const pieces: [number, number][][] = [];
  for (const [ci, cj] of cells) {
    if (seen[ci * N + cj]) continue;
    const piece: [number, number][] = [];
    const stack: [number, number][] = [[ci, cj]];
    seen[ci * N + cj] = 1;
    while (stack.length) {
      const [a, b] = stack.pop()!;
      piece.push([a, b]);
      for (let da = -1; da <= 1; da++)
        for (let db = -1; db <= 1; db++) {
          const na = a + da,
            nb = b + db;
          if (na < 0 || nb < 0 || na >= N || nb >= N || !grid[na * N + nb] || seen[na * N + nb])
            continue;
          seen[na * N + nb] = 1;
          stack.push([na, nb]);
        }
    }
    if (piece.length > 10) pieces.push(piece);
  }
  if (pieces.length < 2) return 0;
  pieces.sort((x, y) => y.length - x.length);
  let gap = Infinity;
  for (const [a, b] of pieces[0]!)
    for (const [c, d] of pieces[1]!) gap = Math.min(gap, Math.hypot(a - c, b - d) * STEP);
  return gap;
}

describe('tricuspid apparatus (decision 78)', () => {
  it('the annulus sits at the junction of atrium and ventricle: an open orifice, both hinges against their walls, all through the cycle', () => {
    // Until 2026-09-13 the RV crescent closed with its wall at the tricuspid plane, a floor 0.5-1.5 cm thick across
    // the orifice, and its free wall pulled in during systole while the annulus kept its size: the lateral hinge lay
    // outside the heart in 6-10 of 10 frames of eleven of the twelve cases.
    const s = makeSample();
    const problems: string[] = [];
    for (const input of CASE_INPUTS) {
      const { heart, tables } = setup(input.id);
      for (let i = 0; i < 10; i++) {
        const pose = computeHeartPose(heart, cycleStateAt(tables, i / 10));
        const tv = pose.valves.tv;
        const hidden: HeartPose = {
          ...pose,
          valves: { ...pose.valves, tv: { ...tv, thickness: -10 } },
        };
        const at = (x: number, y: number, z: number): Tissue =>
          classifyHeart(heart, hidden, x + pose.swingX, y, z, s) ? s.tissue : Tissue.None;
        const hingeZ = (ang: number): number => tv.cz + skirtOffset(tv, ang);
        const label = `${input.id} @${(i / 10).toFixed(1)}`;
        // lateral hinge (−x, toward the free wall): heart behind it, ventricular blood within 2 mm inside it
        if (at(tv.cx - tv.R - 0.2, tv.cy, hingeZ(Math.PI)) === Tissue.None)
          problems.push(`${label}: outside the heart behind the lateral hinge`);
        let blood = Infinity;
        for (let d = 0; d <= 1; d += 0.02)
          if (at(tv.cx - tv.R + d, tv.cy, hingeZ(Math.PI) + 0.15) === Tissue.Blood) {
            blood = d;
            break;
          }
        if (blood > 0.2)
          problems.push(`${label}: ${blood.toFixed(2)} cm between the lateral hinge and the blood`);
        // the orifice is open: no wall along the axis from 1 cm on the atrial side to 1 cm on the ventricular side
        let wall = 0;
        for (let dz = -1; dz <= 1; dz += 0.02) {
          const t = at(tv.cx, tv.cy, tv.cz + dz);
          if (t === Tissue.Myocardium || t === Tissue.Fibrous) wall += 0.02;
        }
        if (wall > 0.05)
          problems.push(`${label}: ${wall.toFixed(2)} cm of wall across the orifice`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('the annulus is in one place: the pose moves the tricuspid plane with the leaflets, by TAPSE along the RV table (decision 110)', () => {
    // Decision 106 gave the leaflets the RV longitudinal table and left the pose's displacement, which the classifier uses
    // for the tricuspid plane, the RV inflow, the atrium-ventricle boundary and the shader, on the LV curve: in mid-systole
    // the leaflets hung up to 3.8 mm apical of the plane the rest of the right heart used.
    const problems: string[] = [];
    for (const input of CASE_INPUTS) {
      const { c, heart, tables } = setup(input.id);
      const A = heartAnchors(heart);
      let worst = 0;
      for (let i = 0; i < 40; i++) {
        const state = cycleStateAt(tables, i / 40);
        const pose = computeHeartPose(heart, state);
        worst = Math.max(
          worst,
          Math.abs(pose.valves.tv.cz - (A.tvCenter.z + pose.tvZ)),
          Math.abs(pose.tvZ - c.physiology.tapseCm * state.rvLongitudinal),
        );
      }
      if (worst > 1e-6)
        problems.push(
          `${input.id}: ${(worst * 10).toFixed(1)} mm between the leaflet ring and the pose's tricuspid displacement`,
        );
    }
    expect(problems).toEqual([]);
  });

  it('open tricuspid leaflets stay in the blood', () => {
    // the septal leaflet used to open into the septum and the anterior one through the free wall
    const s = makeSample();
    const problems: string[] = [];
    for (const input of CASE_INPUTS) {
      const { heart, tables } = setup(input.id);
      for (let phase = 0.45; phase < 1; phase += 0.05) {
        const pose = computeHeartPose(heart, cycleStateAt(tables, phase));
        const tv = pose.valves.tv;
        if (1 - tv.closed < 0.5) continue;
        const hidden: HeartPose = {
          ...pose,
          valves: { ...pose.valves, tv: { ...tv, thickness: -10 } },
        };
        for (const zn of tv.zones)
          for (const off of [-0.6, 0, 0.6]) {
            const ang = zn.phi + off * zn.halfSpan;
            for (const v of [2, 3]) {
              const rho = zn.prof[v * 2]!,
                zz = zn.prof[v * 2 + 1]!;
              if (
                !classifyHeart(
                  heart,
                  hidden,
                  tv.cx + rho * Math.cos(ang) + pose.swingX,
                  tv.cy + rho * Math.sin(ang),
                  tv.cz + zz + skirtOffset(tv, ang),
                  s,
                ) ||
                (s.tissue !== Tissue.Blood && s.tissue !== Tissue.Chordae)
              )
                problems.push(
                  `${input.id} @${phase.toFixed(2)} leaflet at ${((ang * 180) / Math.PI).toFixed(0)}°, vertex ${v}: tissue ${s.tissue}`,
                );
            }
          }
      }
    }
    expect(problems).toEqual([]);
  });

  it('the closed tricuspid valve coapts in the four-chamber, RV-focused and five-chamber views', () => {
    // each leaflet closed by its own angles, shorter toward its commissures, and the four-chamber plane crosses the
    // annulus near one: a 0.3-1.3 cm gap between the leaflets in all twelve cases
    const problems: string[] = [];
    for (const input of CASE_INPUTS) {
      const { heart, tables, thorax } = setup(input.id);
      const t = tables.timings;
      const pose = computeHeartPose(
        heart,
        cycleStateAt(
          tables,
          (t.ejectionStartS + 0.5 * (t.ejectionEndS - t.ejectionStartS)) / tables.rrS,
        ),
      );
      for (const view of ['a4c', 'rv-focused', 'a5c']) {
        const gap = tricuspidGapInView(heart, thorax, pose, view);
        if (gap > 0.05) problems.push(`${input.id} ${view}: ${gap.toFixed(2)} cm`);
      }
    }
    expect(problems).toEqual([]);
  });
});

describe('aortic cusps (decision 79)', () => {
  /** Root-frame point → heart frame (the root centre follows the base by ROOT_EXCURSION). */
  const rootPoint = (
    heart: HeartModel,
    pose: HeartPose,
    t: number,
    r: number,
    phi: number,
  ): [number, number, number] => {
    const A = heartAnchors(heart);
    const cz = A.avCenter.z + pose.zAnn * ROOT_EXCURSION;
    const ux = A.avE1.x * Math.cos(phi) + A.avE2.x * Math.sin(phi),
      uy = A.avE1.y * Math.cos(phi) + A.avE2.y * Math.sin(phi),
      uz = A.avE1.z * Math.cos(phi) + A.avE2.z * Math.sin(phi);
    return [
      A.avCenter.x + A.avAxis.x * t + ux * r + pose.swingX,
      A.avCenter.y + A.avAxis.y * t + uy * r,
      cz + A.avAxis.z * t + uz * r,
    ];
  };

  it('the closed normal valve has the published heights: effective ~9 mm, coaptation 4-5 mm, geometric > 16 mm', () => {
    // flat two-segment cusps closed with the free margin 13.5 mm above the annulus
    const { heart, tables } = setup('normal-excellent-window');
    const pose = computeHeartPose(heart, cycleStateAt(tables, 0.9));
    expect(pose.state.avOpen).toBe(0);
    const s = makeSample();
    // valve tissue on the axis: the central coaptation, from its bottom to the free margin
    let bottom = Infinity,
      top = -Infinity;
    for (let t = 0; t < 2; t += 0.01) {
      for (let k = 0; k < 6; k++) {
        const p = rootPoint(heart, pose, t, 0.012, (k * Math.PI) / 3);
        if (
          classifyHeart(heart, pose, p[0], p[1], p[2], s) &&
          s.structure === Structure.AorticValve
        ) {
          bottom = Math.min(bottom, t);
          top = Math.max(top, t);
        }
      }
    }
    expect(top, 'effective height').toBeGreaterThan(0.8);
    expect(top, 'effective height').toBeLessThan(1.0);
    expect(top - bottom, 'coaptation height').toBeGreaterThan(0.35);
    expect(top - bottom, 'coaptation height').toBeLessThan(0.55);
    // geometric height: along the cusp in the radial plane through its centre, from the nadir to the free margin
    const av = pose.valves.aortic;
    let length = av.cH,
      prev: [number, number] | null = null;
    for (let r = rootRadiusAt(pose.valves.root, 0, 0.5); r >= 0; r -= 0.01) {
      let tc = NaN;
      for (let t = -0.3; t < 1; t += 0.005) {
        const p = rootPoint(heart, pose, t, r, 0.5);
        if (
          classifyHeart(heart, pose, p[0], p[1], p[2], s) &&
          s.structure === Structure.AorticValve
        ) {
          tc = t;
          break;
        }
      }
      if (Number.isNaN(tc)) continue;
      if (prev) length += Math.hypot(prev[0] - r, prev[1] - tc);
      prev = [r, tc];
    }
    expect(length, 'geometric height').toBeGreaterThan(1.6);
  });

  it('closed, the cusps meet along the lines to the commissures (a Y in short axis), with no triangle between them', () => {
    // straight free edges of flat cusps drew a triangle at every short-axis level
    const { heart, tables } = setup('normal-excellent-window');
    const pose = computeHeartPose(heart, cycleStateAt(tables, 0.9));
    const av = pose.valves.aortic;
    const t = av.eH - av.cH / 2;
    const R = rootRadiusAt(pose.valves.root, t, 0.5);
    const s = makeSample();
    const valveAt = (r: number, phi: number): boolean => {
      const p = rootPoint(heart, pose, t, r, phi);
      return (
        classifyHeart(heart, pose, p[0], p[1], p[2], s) && s.structure === Structure.AorticValve
      );
    };
    const problems: string[] = [];
    for (let i = 0; i < av.count; i++) {
      const commissure = 0.5 + ((i + 0.5) * 2 * Math.PI) / av.count;
      const centre = 0.5 + (i * 2 * Math.PI) / av.count;
      // along each commissure line: the pressed-together cusps as one line from the centre to the wall. Until decision
      // 147 the two cusps parted from 60 % of the radius to attach on either side of a 5 mm wide interleaflet triangle;
      // with the narrow commissural posts the arm stays within 1.2 mm of the line all the way
      let covered = 0,
        n = 0;
      for (let r = 0.1 * R; r < 0.85 * R; r += 0.01) {
        n++;
        const reach = 0.12;
        let hit = false;
        for (let d = -reach; d <= reach && !hit; d += 0.01)
          hit = valveAt(r, commissure + d / Math.max(r, 0.1));
        if (hit) covered++;
      }
      if (covered / n < 0.9)
        problems.push(`commissure ${i}: ${((100 * covered) / n).toFixed(0)}% of the line`);
      // across the middle of each cusp, nothing between a third of the radius and the wall
      for (let r = 0.35 * R; r < 0.85 * R; r += 0.02)
        if (valveAt(r, centre)) problems.push(`cusp ${i}: tissue at ${(r / R).toFixed(2)} R`);
    }
    expect(problems).toEqual([]);
  });

  it('the parasternal short axis of the great vessels cuts the closed valve at its coaptation: the centre of the Y is in the image', () => {
    const { heart, tables, thorax } = setup('normal-excellent-window');
    const beam = beamFrameFromPose(
      poseFromControl(thorax, canonicalControl(getViewTarget('psax-av'), heart, thorax)),
      1,
    );
    const A = heartAnchors(heart);
    const s = makeSample();
    for (const phase of [0, 0.7, 0.9]) {
      const pose = computeHeartPose(heart, cycleStateAt(tables, phase));
      const av = pose.valves.aortic;
      // where the root axis crosses the drawn plane
      const n = sub(torsoToHeart(heart.frame, beam.normal), torsoToHeart(heart.frame, v3()));
      const o = torsoToHeart(heart.frame, beam.origin);
      const cz = A.avCenter.z + pose.zAnn * ROOT_EXCURSION;
      const tAxis =
        -(n.x * (A.avCenter.x - o.x) + n.y * (A.avCenter.y - o.y) + n.z * (cz - o.z)) /
        (n.x * A.avAxis.x + n.y * A.avAxis.y + n.z * A.avAxis.z);
      expect(tAxis, `plane level on the root axis @${phase}`).toBeGreaterThan(av.eH - av.cH);
      expect(tAxis, `plane level on the root axis @${phase}`).toBeLessThan(av.eH);
      const hub = rootPoint(heart, pose, tAxis, 0, 0);
      const d0 = sub(heartToTorso(heart.frame, v3(hub[0], hub[1], hub[2])), beam.origin);
      const lat0 = dot(d0, beam.lateral),
        dep0 = dot(d0, beam.forward);
      let found = false;
      for (let i = -8; i <= 8 && !found; i++)
        for (let j = -8; j <= 8 && !found; j++) {
          const pT = add(
            beam.origin,
            add(scale(beam.forward, dep0 + j * 0.025), scale(beam.lateral, lat0 + i * 0.025)),
          );
          const p = torsoToHeart(heart.frame, pT);
          found =
            classifyHeart(heart, pose, p.x, p.y, p.z, s) && s.structure === Structure.AorticValve;
        }
      expect(found, `valve tissue within 2 mm of the axis in PSAX-AV @${phase}`).toBe(true);
    }
  });
});

describe('mitral leaflet motion in the parasternal M-mode (decision 100)', () => {
  it('the anterior leaflet edge traces the normal E, F and A points along the parasternal beam', () => {
    // M-mode at the leaflet tips, read without a cursor: the free edge of the anterior leaflet (A2) projected on the beam
    // from the parasternal probe through its position at peak early inflow, against the closed position at mitral opening.
    // Normal values (Park et al., Diagnostics 2023; 13:2412, n = 30): E-point opening 2.6 ± 0.4 cm, A-point 1.8 ± 0.4 cm,
    // their ratio 1.4 (IQR 1.3–1.5) and 144 ± 19 ms from the E point to the nadir; E-F slope 70–150 mm/s; in diastasis
    // the leaflets float semi-closed, the orifice about half its size at peak E (Govindarajan et al., Sci Rep 2018).
    // Before: the valve closed completely in diastasis, 5 mm past the closed position, and the E-F slope read 185 mm/s.
    for (const id of ['normal-excellent-window', 'normal-difficult-window']) {
      const { heart, tables, thorax } = setup(id);
      const beam = beamFrameFromPose(
        poseFromControl(thorax, canonicalControl(getViewTarget('plax'), heart, thorax)),
        1,
      );
      const t = tables.timings;
      const N = 512;
      const dt = tables.rrS / N;
      const edge = [0, 0, 0];
      const states = Array.from({ length: N }, (_, k) => cycleStateAt(tables, k / N));
      const tips = states.map((st) => {
        const pose = computeHeartPose(heart, st);
        mitralFreeEdge(pose.valves.mitral, 0, 0, edge);
        return heartToTorso(heart.frame, v3(edge[0]! + pose.swingX, edge[1], edge[2]));
      });
      const inWindow = (k: number, from: number, to: number) => k * dt >= from && k * dt < to;
      let kE = Math.ceil(t.mitralOpenS / dt);
      for (let k = kE; inWindow(k, t.mitralOpenS, t.aStartS); k++)
        if (states[k]!.mvOpen > states[kE]!.mvOpen) kE = k;
      const dir = scale(sub(tips[kE]!, beam.origin), 1);
      const unit = scale(dir, 1 / Math.hypot(dir.x, dir.y, dir.z));
      const closed = dot(sub(tips[Math.floor(t.mitralOpenS / dt) - 1]!, beam.origin), unit);
      const exc = tips.map((p) => (closed - dot(sub(p, beam.origin), unit)) * 10); // mm toward the probe
      let kEp = kE;
      for (let k = Math.ceil(t.mitralOpenS / dt); inWindow(k, t.mitralOpenS, t.aStartS); k++)
        if (exc[k]! > exc[kEp]!) kEp = k;
      let kA = Math.ceil(t.aStartS / dt);
      for (let k = kA; inWindow(k, t.aStartS, t.aEndS); k++) if (exc[k]! > exc[kA]!) kA = k;
      let sum = 0,
        count = 0;
      for (let k = Math.ceil(t.eEndS / dt); inWindow(k, t.eEndS, t.aStartS); k++) {
        sum += exc[k]!;
        count++;
      }
      expect(count, `${id}: diastasis samples`).toBeGreaterThan(20);
      const diastasis = sum / count;
      let kF = kEp;
      while (exc[kF]! > diastasis + 1) kF++;
      const E = exc[kEp]!,
        A = exc[kA]!;
      const efMs = (kF - kEp) * dt * 1000;
      const slope = (E - diastasis) / ((kF - kEp) * dt);
      const report = `${id}: E ${E.toFixed(1)} mm, A ${A.toFixed(1)} mm, diastasis ${diastasis.toFixed(1)} mm, E→F ${efMs.toFixed(0)} ms, E-F slope ${slope.toFixed(0)} mm/s`;
      expect(E, report).toBeGreaterThan(18);
      expect(E, report).toBeLessThan(34);
      expect(A, report).toBeGreaterThan(10);
      expect(A, report).toBeLessThan(26);
      expect(E / A, report).toBeGreaterThan(1.3);
      expect(E / A, report).toBeLessThan(1.5);
      expect(diastasis / E, report).toBeGreaterThan(0.25);
      expect(diastasis / E, report).toBeLessThan(0.6);
      expect(efMs, report).toBeGreaterThan(106);
      expect(efMs, report).toBeLessThan(182);
      expect(slope, report).toBeGreaterThan(70);
      expect(slope, report).toBeLessThan(150);
    }
  });
});

/** Centre of the pulmonary valve this frame: the centroid of the three cusp hinges (it moves with the base, decision 111). */
const pulmonaryValveCentre = (pose: HeartPose) => {
  const g = pose.valves.pvSegs;
  return v3(
    (g[0]! + g[12]! + g[24]!) / 3,
    (g[1]! + g[13]! + g[25]!) / 3,
    (g[2]! + g[14]! + g[26]!) / 3,
  );
};

describe('pulmonary root (decision 109)', () => {
  it('a dilated trunk widens above the sinuses: at the valve plane the cusp hinges stay against the wall, in every case and through the cycle', () => {
    // The trunk used to begin at the valve plane with its full radius. With the case diameter of pulmonary hypertension
    // (3.2 cm) the cusps, hinged 1.05 cm from the axis, hung 5.5 mm from a wall 1.60 cm away, and the rounded end of the
    // trunk widened the outflow tract to a radius of 1.39 cm 8 mm below the valve (0.83 cm before).
    const s = makeSample();
    const problems: string[] = [];
    for (const input of CASE_INPUTS) {
      const { c, heart, tables } = setup(input.id);
      const A = heartAnchors(heart);
      const d = A.paDir;
      const e1 = normalize(cross(d, v3(0, 0, 1)));
      const e2 = cross(d, e1);
      for (const phase of [0, 0.2, 0.6]) {
        const pose = computeHeartPose(heart, cycleStateAt(tables, phase));
        // how far the blood of the trunk reaches from its axis, walking out through its blood and cusps, in 16 directions
        // (the aortic root, the ventricle or the outflow tract bound it on some of them)
        const bloodRadii = (t: number): number[] => {
          const radii: number[] = [];
          for (let k = 0; k < 16; k++) {
            const a = (k / 16) * 2 * Math.PI;
            const u = add(scale(e1, Math.cos(a)), scale(e2, Math.sin(a)));
            let last = 0;
            for (let r = 0; r < 3; r += 0.01) {
              const p = add(add(pulmonaryValveCentre(pose), scale(d, t)), scale(u, r));
              if (!classifyHeart(heart, pose, p.x + pose.swingX, p.y, p.z, s)) break;
              if (s.tissue === Tissue.Blood && s.structure === Structure.PulmonaryArtery) last = r;
              else if (s.structure !== Structure.PulmonaryValve) break;
            }
            radii.push(last);
          }
          return radii.sort((p, q) => p - q);
        };
        const label = `${input.id} @${phase}`;
        // at the valve plane the cusp hinges lie against the wall: the blood ends within 2 mm of them, as at the tricuspid annulus
        const atValve = bloodRadii(0)[15]!;
        if (atValve > A.pvR + 0.2)
          problems.push(
            `${label}: trunk blood ${atValve.toFixed(2)} cm from the axis at the valve plane, cusps hinged at ${A.pvR.toFixed(2)}`,
          );
        // past the sinotubular junction the trunk has the diameter of the case
        const median = bloodRadii(2.2)[8]!;
        if (Math.abs(2 * median - c.anatomy.pulmonaryArtery.trunkDiameterCm) > 0.1)
          problems.push(
            `${label}: trunk ${(2 * median).toFixed(2)} cm at 2.2 cm from the valve, case ${c.anatomy.pulmonaryArtery.trunkDiameterCm} cm`,
          );
      }
    }
    expect(problems).toEqual([]);
  });
});

describe('outflow tract and pulmonary root motion (decision 111)', () => {
  it('the pulmonary root descends with the base in systole: about 8 mm toward the apex, caudally, ventrally and to the left', () => {
    // Pulmonary root displacement in systole: median 8.0 mm, predominantly caudal, ventral and leftward, by ECG-gated
    // CT in 100 adults with normal function (Lis et al., J Interv Card Electrophysiol 2026;69:99-107). It did not move.
    const { heart, tables } = setup('normal-excellent-window');
    const ed = computeHeartPose(heart, cycleStateAt(tables, 0));
    let es = ed;
    for (let i = 1; i < 50; i++) {
      const pose = computeHeartPose(heart, cycleStateAt(tables, i / 50));
      if (pose.zAnn > es.zAnn) es = pose;
    }
    const move = sub(
      heartToTorso(heart.frame, pulmonaryValveCentre(es)),
      heartToTorso(heart.frame, pulmonaryValveCentre(ed)),
    );
    const report = `torso displacement (+x left, +y cranial, +z anterior): ${[move.x, move.y, move.z].map((x) => x.toFixed(2)).join(', ')} cm`;
    expect(Math.hypot(move.x, move.y, move.z), report).toBeGreaterThan(0.5);
    expect(Math.hypot(move.x, move.y, move.z), report).toBeLessThan(1.1);
    expect(move.x, report).toBeGreaterThan(0);
    expect(move.y, report).toBeLessThan(0);
    expect(move.z, report).toBeGreaterThan(0);
  });
});

describe('right ventricular outflow junction', () => {
  function inRv(heart: HeartModel, pose: HeartPose, p: Vec3): number {
    const a = heartAnchors(heart),
      temp = new Float64Array(3);
    rvCrescent(heart, pose, a, p.x, p.y, p.z, Math.atan2(p.y, p.x), temp);
    return smin(temp[0]!, tvInflowSdf(p.x, p.y, p.z, pose.valves.tv, pose.tvZ), 0.3);
  }

  it.each(['normal-excellent-window', 'aortic-stenosis-severe', 'pulmonary-hypertension-rv'])(
    'does not put arterial wall inside the RV lumen across the cycle: %s',
    (id) => {
      const { heart, tables } = setup(id),
        a = heartAnchors(heart),
        sample = makeSample();
      let inside = 0,
        external = 0;
      for (let phase = 0; phase < 12; phase++) {
        const pose = computeHeartPose(heart, cycleStateAt(tables, phase / 12));
        const centre = add(a.rvotB, v3(0, 0, pose.pvZ));
        for (let t = -1.5; t <= 2; t += 0.15)
          for (const ratio of [0.85, 1, 1.15, 1.3, 1.45])
            for (let j = 0; j < 24; j++) {
              const angle = (j * 2 * Math.PI) / 24,
                r = ratio * a.paRootR;
              const p = add(
                add(centre, scale(a.paDir, t)),
                add(scale(a.pvE1, r * Math.cos(angle)), scale(a.pvE2, r * Math.sin(angle))),
              );
              if (
                !classifyHeart(heart, pose, p.x, p.y, p.z, sample) ||
                sample.structure !== Structure.PulmonaryArtery ||
                sample.tissue !== Tissue.VesselWall
              )
                continue;
              const d = inRv(heart, pose, p);
              if (d < -0.01) inside++;
              if (d > 0.05) external++;
            }
      }
      expect(external, 'preserve the external arterial wall').toBeGreaterThan(20);
      expect(inside, 'arterial wall intruding into the existing RV blood cavity').toBe(0);
    },
  );

  it('keeps the real PSAX-AV frame free of the intraluminal arterial shelf', () => {
    const c = loadCaseById('normal-excellent-window'),
      input = baseInput({ quality: 'high' }),
      core = new SimulatorCore(c, input);
    input.probe = canonicalControl(getViewTarget('psax-av'), core.models.heart, core.models.thorax);
    core.setInput(input);
    const out = core.step(0)!;
    const frame = core.lastFrame!,
      beam = core.lastBeam!,
      pose = core.heartPoseNow(),
      heart = core.models.heart;
    let inside = 0,
      external = 0;
    for (let i = 0; i < frame.structure.length; i++) {
      if (frame.structure[i] !== Structure.PulmonaryArtery || frame.tissue[i] !== Tissue.VesselWall)
        continue;
      const li = Math.floor(i / frame.spec.samples),
        si = i % frame.spec.samples;
      const theta =
        -frame.spec.sectorRad / 2 + (frame.spec.sectorRad * (li + 0.5)) / frame.spec.lines;
      const r = ((si + 0.5) * frame.spec.depthCm) / frame.spec.samples;
      const p = torsoToHeart(
        heart.frame,
        add(
          beam.origin,
          add(scale(beam.forward, r * Math.cos(theta)), scale(beam.lateral, r * Math.sin(theta))),
        ),
      );
      const d = inRv(heart, pose, p);
      if (d < -0.01) inside++;
      if (d > 0.05) external++;
    }
    core.recycle(out.rgba);
    expect(external).toBeGreaterThan(5);
    expect(inside).toBe(0);
  });
});

describe('pulmonary root beside the aortic root (decision 112)', () => {
  it('nothing of the aortic root, the aortic valve or the left ventricle is drawn inside the pulmonary root or on its hinge ring, in every case through the cycle', () => {
    // The pulmonary valve sat 2.3 cm from the aortic one in every case, closer than the two roots allow: near the wall,
    // 22-44% of the pulmonary root lumen was aortic root, aortic valve or left ventricular wall, and so were 17-33 of the
    // 64 points of the ring where the cusps hinge, so the valve had no cusp tissue on that side.
    const s = makeSample();
    const allowed = new Set([
      Structure.PulmonaryArtery,
      Structure.PulmonaryValve,
      Structure.Rvot,
      Structure.RvCavity,
    ]);
    const problems: string[] = [];
    for (const input of CASE_INPUTS) {
      const { heart, tables } = setup(input.id);
      const A = heartAnchors(heart);
      const d = A.paDir;
      const e1 = normalize(cross(d, v3(0, 0, 1)));
      const e2 = cross(d, e1);
      for (let i = 0; i < 10; i++) {
        const pose = computeHeartPose(heart, cycleStateAt(tables, i / 10));
        const c = pulmonaryValveCentre(pose);
        const found = new Map<string, number>();
        let n = 0;
        const probe = (p: Vec3) => {
          n++;
          const hit = classifyHeart(heart, pose, p.x + pose.swingX, p.y, p.z, s);
          if (hit && allowed.has(s.structure)) return;
          const name = hit ? `structure ${s.structure}` : 'outside the heart';
          found.set(name, (found.get(name) ?? 0) + 1);
        };
        // just inside the wall from the valve plane to the sinotubular junction, and the hinge ring
        for (let t = 0; t <= 1.9; t += 0.1) {
          const r = A.paRootR + ((A.paR - A.paRootR) * t) / 1.9 - 0.05;
          for (let k = 0; k < 36; k++) {
            const a = (k / 36) * 2 * Math.PI;
            probe(
              add(add(c, scale(d, t)), add(scale(e1, r * Math.cos(a)), scale(e2, r * Math.sin(a)))),
            );
          }
        }
        for (let k = 0; k < 64; k++) {
          const a = (k / 64) * 2 * Math.PI;
          probe(add(c, add(scale(e1, A.pvR * Math.cos(a)), scale(e2, A.pvR * Math.sin(a)))));
        }
        if (found.size)
          problems.push(
            `${input.id} @${i / 10}: ${[...found].map(([name, k]) => `${name} ${((k / n) * 100).toFixed(1)}%`).join(', ')}`,
          );
      }
    }
    expect(problems).toEqual([]);
  });

  it('the tricuspid leaflet normal follows the profile edge, not a fixed radial direction (decision 116)', () => {
    // until 2026-09-15 the tricuspid classifier used a fixed radial normal (dx/rho, dy/rho, 0.8),
    // so the specular echo (proportional to |n.beam|^4) was near zero for the closed valve in A4C
    // (nd ~ 0.52) and the valve was barely brighter than the RV cavity. The mitral valve already
    // used a profile-edge normal; the tricuspid should too. The old normal had a fixed z-component
    // of 0.8/sqrt(1+0.64) = 0.625; the profile-edge normal varies with the leaflet orientation and
    // is nearly vertical (z > 0.8) for the flat closed leaflet.
    for (const input of CASE_INPUTS) {
      const { heart, tables } = setup(input.id);
      const A = heartAnchors(heart);
      // a phase with the valve closed: the atrial fibrillation case is half open at phase 0 (no atrial contraction
      // closes it), and since decision 138 its open leaflets lie along the walls, so the blended profile is not flat
      let closedPhase = 0;
      while (cycleStateAt(tables, closedPhase).tvOpen > 0 && closedPhase < 0.5) closedPhase += 0.05;
      const pose = computeHeartPose(heart, cycleStateAt(tables, closedPhase));
      const tv = pose.valves.tv;
      const zn = tv.zones[0]!;
      const phi = zn.phi;
      let found = 0;
      for (const r of [A.tvR * 0.5, A.tvR * 0.8, A.tvR * 0.95]) {
        const x = tv.cx + r * Math.cos(phi);
        const y = tv.cy + r * Math.sin(phi);
        const z = tv.cz + 0.01;
        const t = skirtDistance(x, y, z, tv);
        if (skirtHit.d >= t) continue;
        const nLen = Math.hypot(skirtHit.nx, skirtHit.ny, skirtHit.nz);
        if (nLen < 1e-6) continue;
        const nz = Math.abs(skirtHit.nz) / nLen;
        // the old fixed normal had nz = 0.625; the profile-edge normal for the closed leaflet
        // (nearly horizontal) should have nz > 0.8
        expect(nz).toBeGreaterThan(0.7);
        found++;
      }
      expect(found).toBeGreaterThan(0);
    }
  });
});
