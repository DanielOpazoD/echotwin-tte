import { describe, expect, it } from 'vitest';
import { CASE_INPUTS, loadCaseById } from '@/cases';
import { classifyHeart, computeHeartPose, createHeartModel, heartAnchors, heartToTorso, ROOT_EXCURSION, torsoToHeart, type HeartModel, type HeartPose } from './heartModel';
import { mitralLeafletPoint, MV_BINS } from './mitralValve';
import { createThoraxModel, type ThoraxModel } from './thoraxModel';
import { makeSample, Structure, Tissue } from './tissue';
import { buildBeatTables, cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import { add, dot, scale, sub, v3 } from '@/core/vec3';

/**
 * Valve apparatus and great-vessel continuity (decision 75). These are the "subtleties" a cardiologist sees at once
 * and none of the size measures catches: a wall that steps, a closure line that runs where the cusps do not meet, a
 * leaflet hinged on nothing. Each check reads the implicit model directly, in the heart frame.
 */
function setup(id: string) {
  const c = loadCaseById(id);
  const thorax = createThoraxModel(c.bodyHabitus, c.acousticWindow, { position: 'left-lateral', respiration: 'expiration', headElevationDeg: 0 }, c.anatomy.ivc.collapsePct);
  const heart = createHeartModel(c.anatomy, c.physiology, thorax.heartOffset, c.seed, thorax.ivcCollapse);
  const tables = buildBeatTables(60 / c.rhythm.heartRateBpm, c.physiology, c.rhythm, c.hemodynamics);
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
        const c0 = [A.avCenter.x + A.avAxis.x * t, A.avCenter.y + A.avAxis.y * t, cz + A.avAxis.z * t];
        const e = A.avE2;
        const inside = (u: number): boolean => classifyHeart(heart, pose, c0[0]! + e.x * u, c0[1]! + e.y * u, c0[2]! + e.z * u, s) && lumen.includes(s.structure) && s.tissue !== Tissue.VesselWall;
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
      expect(worst, `${input.id}: largest diameter change over 0.5 mm of root, at t = ${at.toFixed(2)} cm`).toBeLessThan(0.1);
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
    // a thin cylinder of 0.6 mm around the axis, from the annulus to 0.1 cm below the band
    for (let t = 0.05; t < pose.valves.cuspTipT - 0.45; t += 0.02)
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * 2 * Math.PI;
        const r = 0.03;
        const x = A.avCenter.x + A.avAxis.x * t + (A.avE1.x * Math.cos(a) + A.avE2.x * Math.sin(a)) * r;
        const y = A.avCenter.y + A.avAxis.y * t + (A.avE1.y * Math.cos(a) + A.avE2.y * Math.sin(a)) * r;
        const z = cz + A.avAxis.z * t + (A.avE1.z * Math.cos(a) + A.avE2.z * Math.sin(a)) * r;
        if (classifyHeart(heart, pose, x, y, z, s) && s.structure === Structure.AorticValve) hits.push(t.toFixed(2));
      }
    expect(hits, 'valve tissue on the ventricular side of the coaptation band').toEqual([]);
  });
});

/** The same pose with the mitral leaflets removed (the annulus, chordae and everything else stay). */
const withoutLeaflets = (pose: HeartPose): HeartPose => ({ ...pose, valves: { ...pose.valves, mitral: { ...pose.valves.mitral, thickness: -10 } } });

/**
 * Closed mitral valve as drawn in a view: displacement of the leaflets toward the atrium (billow) and toward the apex
 * (tenting) relative to the line through the two annulus points the plane cuts.
 */
function closedValveInView(heart: HeartModel, thorax: ThoraxModel, pose: HeartPose, viewId: string): { billow: number; tenting: number } {
  const beam = beamFrameFromPose(poseFromControl(thorax, canonicalControl(getViewTarget(viewId), heart, thorax)), 1);
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
      const p = torsoToHeart(heart.frame, add(beam.origin, add(scale(beam.forward, dep), scale(beam.lateral, lat))));
      if (!classifyHeart(heart, pose, p.x, p.y, p.z, s)) continue;
      if (s.structure === Structure.MitralAnnulus) ring.push([lat, dep]);
      else if (s.structure === Structure.MitralAnterior || s.structure === Structure.MitralPosterior) leaf.push([lat, dep]);
      else if (s.structure === Structure.LaCavity) atrium.push([lat, dep]);
    }
  const mean = (q: [number, number][]): [number, number] => [q.reduce((a, p) => a + p[0], 0) / q.length, q.reduce((a, p) => a + p[1], 0) / q.length];
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
  const side = ([x, y]: [number, number]): boolean => (x - mx) * Math.cos(ang) + (y - my) * Math.sin(ang) < 0;
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
              if ((s.tissue === Tissue.VesselWall && s.structure === Structure.AorticRoot) || (s.tissue === Tissue.Fibrous && s.structure !== Structure.MitralAnnulus)) nearest = r;
            }
          if (nearest > 0.3) problems.push(`${input.id} @${phase.toFixed(2)}: anterior hinge ${nearest.toFixed(2)} cm from the root wall`);
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
            classifyHeart(heart, hidden, hx + mv.ux * d + pose.swingX, hy + mv.uy * d, hz + 0.15, s);
            if (s.tissue === Tissue.Blood) {
              blood = d;
              break;
            }
          }
          if (blood > 0.2) problems.push(`${input.id} @${phase.toFixed(2)}: ${blood.toFixed(2)} cm of tissue between the posterior hinge and the cavity`);
          classifyHeart(heart, hidden, hx - mv.ux * 0.2 + pose.swingX, hy - mv.uy * 0.2, hz, s);
          if (s.tissue === Tissue.Blood) problems.push(`${input.id} @${phase.toFixed(2)}: blood behind the posterior annulus`);
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
              if (s.tissue !== Tissue.Blood && s.tissue !== Tissue.Chordae) problems.push(`${input.id} @${phase.toFixed(2)} ${leaflet ? 'posterior' : 'anterior'} q ${q} at ${along}: tissue ${s.tissue}, structure ${s.structure}`);
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
      const pose = computeHeartPose(heart, cycleStateAt(tables, (t.ejectionStartS + 0.5 * (t.ejectionEndS - t.ejectionStartS)) / tables.rrS));
      const plax = closedValveInView(heart, thorax, pose, 'plax');
      const a4c = closedValveInView(heart, thorax, pose, 'a4c');
      const label = `${input.id}: PLAX billow ${plax.billow.toFixed(2)}, tenting ${plax.tenting.toFixed(2)}; A4C billow ${a4c.billow.toFixed(2)}`;
      if (input.id === 'mvp-primary-mr') {
        if (!(plax.billow > 0.2)) problems.push(`${label} (the prolapse must show)`);
        continue;
      }
      if (!(plax.billow <= 0.2 && plax.tenting >= 0.15 && plax.tenting <= 0.6 && a4c.billow <= 0.35)) problems.push(label);
    }
    expect(problems).toEqual([]);
  });
});
