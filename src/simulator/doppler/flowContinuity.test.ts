// @tier slow
import { describe, expect, it } from 'vitest';
import { CASE_INPUTS, loadCaseById } from '@/cases';
import { buildCaseModels } from '@/simulator/anatomy/caseModels';
import { classifyHeart, computeHeartPose, torsoToHeart } from '@/simulator/anatomy/heartModel';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { makeSample, Tissue } from '@/simulator/anatomy/tissue';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import { add, dot, scale } from '@/core/vec3';
import { buildFlowParams, sampleFlow, type FlowSample } from './flow-primitives/flowField';
import { sampleTable } from '@/simulator/cardiac-cycle/cycleModel';

/**
 * The colour map draws the flow where its primitives are present, so a primitive whose velocity stops on a cylinder, a
 * cone or a plane draws that surface as a straight colour border (decision 166): the mitral inflow of the normal
 * four-chamber view was a rectangle. Measured on each view plane of every case, over a 1 mm grid of blood samples: a
 * colour border is a pair of neighbours 1 mm apart where the flow of one moves at less than 5 cm/s (under a wall filter)
 * and the other shows more than 15 cm/s along the beam (where the flow turns across the beam its projection falls to zero
 * while it still moves: the black line between red and blue is not a border), and a straight border is a run of them
 * along a row, a column or a diagonal. The flows through the valves and the veins may draw no straight border longer
 * than 5 mm, the criterion of the expert panel. Regurgitant jets are left out: a 2-5 m/s jet keeps a thin shear layer,
 * so its colour stops within a millimetre at the side of its cone. Before the decision the normal case drew straight
 * borders of 7-13 mm and the HFrEF one 29 mm.
 */

const STEP = 0.1;
const MAX_STRAIGHT_BORDER_CM = 0.5;
const VIEWS = ['a4c', 'a3c', 'a2c', 'plax', 'psax-av'] as const;

function longestStraightBorder(caseId: string, viewId: string, phase: number): number {
  const c = loadCaseById(caseId);
  const { thorax, heart, tables } = buildCaseModels(c, {
    position: 'left-lateral',
    respiration: 'expiration',
    headElevationDeg: 0,
  });
  const flow = buildFlowParams(c, heart, tables);
  // fast jets keep a thin shear layer: their colour border is sharp by construction
  for (const k of ['mr-jet', 'ar-jet', 'tr-jet']) flow.enabled[k] = false;
  const hp = computeHeartPose(heart, cycleStateAt(tables, phase));
  const beam = beamFrameFromPose(
    poseFromControl(thorax, canonicalControl(getViewTarget(viewId), heart, thorax)),
    1,
  );
  const hf = heart.frame;
  const s = makeSample();
  const fs: FlowSample = { vx: 0, vy: 0, vz: 0, dispersion: 0, present: 0 };
  const D = 16,
    W = 8;
  const nx = Math.round((2 * W) / STEP),
    ny = Math.round(D / STEP);
  const v = new Float32Array(nx * ny).fill(Number.NaN);
  const speed = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const dep = (j + 0.5) * STEP,
        lat = -W + (i + 0.5) * STEP;
      if (Math.abs(Math.atan2(lat, dep)) > (40 * Math.PI) / 180) continue;
      const pT = add(beam.origin, add(scale(beam.forward, dep), scale(beam.lateral, lat)));
      const pH = torsoToHeart(hf, pT);
      if (!classifyHeart(heart, hp, pH.x, pH.y, pH.z, s) || s.tissue !== Tissue.Blood) continue;
      sampleFlow(flow, tables, hp, phase, pH.x, pH.y, pH.z, fs);
      const n = Math.hypot(dep, lat);
      const dir = add(scale(beam.forward, dep / n), scale(beam.lateral, lat / n));
      v[j * nx + i] = -(
        fs.vx * dot(dir, hf.ex) +
        fs.vy * dot(dir, hf.ey) +
        fs.vz * dot(dir, hf.ez)
      );
      speed[j * nx + i] = Math.hypot(fs.vx, fs.vy, fs.vz);
    }
  const border = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const a = Math.abs(v[j * nx + i]!);
      if (Number.isNaN(a)) continue;
      const sa = speed[j * nx + i]!;
      for (const [di, dj] of [
        [1, 0],
        [0, 1],
      ] as const) {
        if (i + di >= nx || j + dj >= ny) continue;
        const b = Math.abs(v[(j + dj) * nx + i + di]!);
        if (Number.isNaN(b)) continue;
        const sb = speed[(j + dj) * nx + i + di]!;
        // the colour ends because the flow does: where it turns across the beam (the black line between red and blue)
        // its projection falls to zero while it still moves
        if ((sa < 0.05 && b > 0.15) || (sb < 0.05 && a > 0.15)) border[j * nx + i] = 1;
      }
    }
  let longest = 0;
  for (const [di, dj] of [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ] as const)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        if (!border[j * nx + i]) continue;
        const pi = i - di,
          pj = j - dj;
        if (pi >= 0 && pj >= 0 && pi < nx && pj < ny && border[pj * nx + pi]) continue;
        let n = 0,
          ii = i,
          jj = j;
        while (ii >= 0 && jj >= 0 && ii < nx && jj < ny && border[jj * nx + ii]) {
          n++;
          ii += di;
          jj += dj;
        }
        longest = Math.max(longest, n * STEP * (di && dj ? Math.SQRT2 : 1));
      }
  return longest;
}

describe('the flows draw no straight colour border (decision 166)', () => {
  it(
    'in five views of every case, at the E and A peaks, in mid-diastole and in systole',
    { timeout: 900_000 },
    () => {
      const long: string[] = [];
      for (const input of CASE_INPUTS) {
        const { tables } = buildCaseModels(loadCaseById(input.id), {
          position: 'left-lateral',
          respiration: 'expiration',
          headElevationDeg: 0,
        });
        const tm = tables.timings;
        const rr = tables.rrS;
        const phases: Record<string, number> = {
          E: (tm.mitralOpenS + tm.eAccelS) / rr,
          'mid-diastole': (tm.mitralOpenS + tm.eAccelS + 0.5 * tm.eDecelS) / rr,
          systole: (tm.ejectionStartS + 0.35 * (tm.ejectionEndS - tm.ejectionStartS)) / rr,
        };
        if (tm.hasAWave) phases['A'] = (tm.aStartS + 0.5 * (rr - tm.aStartS)) / rr;
        for (const view of VIEWS)
          for (const [name, phase] of Object.entries(phases)) {
            const cm = longestStraightBorder(input.id, view, phase);
            const key = `${input.id} ${view} ${name}`;
            if (cm > MAX_STRAIGHT_BORDER_CM + 1e-9) long.push(`${key}: ${(cm * 10).toFixed(0)} mm`);
          }
      }
      expect(long, 'straight colour borders longer than 5 mm').toEqual([]);
    },
  );
});

/**
 * The inflow through an atrioventricular valve carries the flow of its table through the orifice and up to the leaflet
 * tips (decision 166): the E velocity of the case times the effective orifice area. The convergence and the jet used the
 * anatomical radius of the annulus with the velocity of the effective area, and the orifice section carried 1.3-1.6 times
 * the transmitral flow at the E peak (1.9-2.2 at the tips). Measured with the other primitives off, integrating the
 * velocity along the long axis over the section 0.3 cm beyond the annulus (within 5 %) and at the tips, 1.2 cm beyond
 * it (within 15 %: the filling wave, whose front is a hemisphere around the orifice, reaches the edge of the section
 * later than its axis; 0.86-1.09 of the flow).
 */
describe('the inflow through the atrioventricular valves carries their flow (decision 166)', () => {
  it('through the orifice and the leaflet tips at the E peak, in the twelve cases', () => {
    const off: string[] = [];
    for (const input of CASE_INPUTS) {
      const c = loadCaseById(input.id);
      const { heart, tables } = buildCaseModels(c, {
        position: 'left-lateral',
        respiration: 'expiration',
        headElevationDeg: 0,
      });
      const tm = tables.timings;
      for (const valve of ['mitral', 'tricuspid'] as const) {
        const p = buildFlowParams(c, heart, tables);
        const keep = valve === 'mitral' ? 'mitral-inflow' : 'tricuspid-inflow';
        for (const k of [
          'mitral-inflow',
          'tricuspid-inflow',
          'lvot',
          'aortic-valve',
          'rvot',
          'tr-jet',
          'mr-jet',
          'ar-jet',
          'pulmonary-vein',
        ])
          p.enabled[k] = k === keep;
        const table = valve === 'mitral' ? tables.mitralFlowMlps : tables.tricuspidFlowMlps;
        // the peak of the E wave of this valve's own table
        let phase = 0,
          q = 0;
        for (let t = tm.mitralOpenS - 0.05; t < tm.mitralOpenS + tm.eAccelS + 0.05; t += 0.002) {
          const f = sampleTable(table, t / tables.rrS);
          if (f > q) {
            q = f;
            phase = t / tables.rrS;
          }
        }
        const hp = computeHeartPose(heart, cycleStateAt(tables, phase));
        const centre = valve === 'mitral' ? p.mvCenter : p.tvCenter;
        const zAnn = valve === 'mitral' ? hp.zAnn : p.tvCenter.z + hp.tvZ;
        const fs: FlowSample = { vx: 0, vy: 0, vz: 0, dispersion: 0, present: 0 };
        for (const zr of [0.3, 1.2]) {
          const h = 0.05;
          let flux = 0;
          for (let x = -4; x <= 4; x += h)
            for (let y = -4; y <= 4; y += h) {
              sampleFlow(p, tables, hp, phase, centre.x + x, centre.y + y, zAnn + zr, fs);
              flux += fs.vz * 100 * h * h;
            }
          // the tips section sees the hemispheric front of the filling wave reach its edge later than its axis
          if (Math.abs(flux / q - 1) > (zr < 1 ? 0.05 : 0.15))
            off.push(`${c.id} ${valve} ${zr} cm: ${(flux / q).toFixed(2)} × the flow`);
        }
      }
    }
    expect(off).toEqual([]);
  });
});
