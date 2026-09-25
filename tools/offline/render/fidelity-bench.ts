/**
 * Multiview fidelity bench (decision 139): the numbers a change of the heart's position, of the thorax or of a window
 * rule has to be judged by, for every case at once, on the planes the windows really reach.
 *   npx tsx tools/offline/render/fidelity-bench.ts [caseId,caseId,... | all]
 * Per apical view: probe skin point, angle of the drawn plane to the view's plane, where the LV cavity apex falls in the
 * beam (lateral, depth, elevation, cm), tilt of the long axis to the centre line and the share of the LV wall behind lung or rib (ribs count since decision 215).
 * Per parasternal view: obliquity to the long axis (short axes) or to the plane (PLAX), and the first tissue on the PLAX
 * centre line. Per case: how far the apex tip sits behind the chest wall along the axis and the deepest intrusion of the
 * heart into the wall (as chestWall.test.ts measures it).
 */
import { CASE_INPUTS, loadCaseById } from '@/cases';
import { buildCaseModels, type CaseModels } from '@/simulator/anatomy/caseModels';
import {
  classifyHeart,
  computeHeartPose,
  heartDirToTorso,
  heartRootAxis,
  heartToTorso,
  torsoToHeart,
} from '@/simulator/anatomy/heartModel';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { skinZ } from '@/simulator/anatomy/thoraxModel';
import { makeSample } from '@/simulator/anatomy/tissue';
import {
  canonicalControl,
  canonicalPlane,
  getViewTarget,
  ventricleHiddenShare,
} from '@/simulator/windows/viewTargets';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import { add, dot, scale, sub, v3 } from '@/core/vec3';

const deg = (r: number): number => (r * 180) / Math.PI;
const f = (x: number, d = 1): string => (Number.isFinite(x) ? x.toFixed(d) : 'NaN');
const APICAL = ['a4c', 'a5c', 'a2c', 'a3c', 'rv-focused'];
const PARASTERNAL = ['plax', 'psax-av', 'psax-mv', 'psax-pm', 'psax-apex'];

function apical(m: CaseModels, viewId: string): string {
  const view = getViewTarget(viewId);
  const ctrl = canonicalControl(view, m.heart, m.thorax);
  const beam = beamFrameFromPose(poseFromControl(m.thorax, ctrl), 1);
  const plane = canonicalPlane(view, m.heart);
  const apex = heartToTorso(m.heart.frame, v3(0, 0, m.heart.lv.lengthCm));
  const base = heartToTorso(m.heart.frame, v3(0, 0, 0.3));
  const d = sub(apex, beam.origin);
  const ab = sub(base, apex);
  const tilt = deg(Math.atan2(dot(ab, beam.lateral), dot(ab, beam.forward)));
  const dev = deg(Math.acos(Math.min(1, Math.abs(dot(plane.normal, beam.normal)))));
  const hidden = ventricleHiddenShare(m.heart, m.thorax, ctrl);
  return `| ${viewId} | ${f(ctrl.u)}, ${f(ctrl.v)} | ${f(dev)} | ${f(dot(d, beam.lateral), 2)} / ${f(dot(d, beam.forward), 2)} / ${f(dot(d, beam.normal), 2)} | ${f(tilt)} | ${f(100 * hidden, 0)} % |`;
}

function parasternal(m: CaseModels, viewId: string): string {
  const view = getViewTarget(viewId);
  const ctrl = canonicalControl(view, m.heart, m.thorax);
  const beam = beamFrameFromPose(poseFromControl(m.thorax, ctrl), 1);
  const lvAxis = heartDirToTorso(m.heart.frame, v3(0, 0, 1));
  const ref =
    viewId === 'psax-av' ? heartDirToTorso(m.heart.frame, heartRootAxis(m.heart)) : lvAxis;
  const axisToPlane = deg(Math.asin(Math.min(1, Math.abs(dot(ref, beam.normal)))));
  const obliquity = viewId === 'plax' ? axisToPlane : 90 - axisToPlane;
  const plane = canonicalPlane(view, m.heart);
  const dev = deg(Math.acos(Math.min(1, Math.abs(dot(plane.normal, beam.normal)))));
  let near = '';
  if (viewId === 'plax') {
    const pose = computeHeartPose(m.heart, cycleStateAt(m.tables, 0));
    const s = makeSample();
    for (let r = 0.05; r < 10; r += 0.05) {
      const p = torsoToHeart(m.heart.frame, add(beam.origin, scale(beam.forward, r)));
      if (classifyHeart(m.heart, pose, p.x, p.y, p.z, s)) {
        near = f(r, 2);
        break;
      }
    }
  }
  return `| ${viewId} | ${f(ctrl.u)}, ${f(ctrl.v)} | ${f(obliquity)} | ${f(dev)} | ${near} |`;
}

/** Deepest heart tissue inside the chest wall (cm), as chestWall.test.ts reads it, at end-diastole or 60% of ejection. */
function intrusion(m: CaseModels, systole: boolean): number {
  const { heart, thorax, tables } = m;
  const t = tables.timings;
  const phase = systole
    ? (t.ejectionStartS + 0.6 * (t.ejectionEndS - t.ejectionStartS)) / tables.rrS
    : 0;
  const pose = computeHeartPose(heart, cycleStateAt(tables, phase));
  const q = makeSample();
  let worst = 0;
  for (let x = -2; x <= 11; x += 0.25)
    for (let y = -9; y <= 6; y += 0.25) {
      const zs = skinZ(thorax, x, y);
      for (let d = 0.2; d < thorax.chestWall - worst; d += 0.05) {
        const h = torsoToHeart(heart.frame, v3(x, y, zs - d));
        if (classifyHeart(heart, pose, h.x, h.y, h.z, q)) {
          worst = Math.max(worst, thorax.chestWall - d);
          break;
        }
      }
    }
  return worst;
}

/** Distance from the epicardial apex tip to the skin along the long axis (cm). */
function tipToSkin(m: CaseModels): number {
  const tip = heartToTorso(m.heart.frame, v3(0, 0, m.heart.lv.lengthCm + 0.7));
  const axis = heartDirToTorso(m.heart.frame, v3(0, 0, 1));
  for (let t = 0; t < 15; t += 0.02) {
    const p = add(tip, scale(axis, t));
    if (p.z >= skinZ(m.thorax, p.x, p.y)) return t;
  }
  return NaN;
}

const arg = process.argv[2] ?? 'normal-excellent-window';
const ids = arg === 'all' ? CASE_INPUTS.map((c) => c.id) : arg.split(',');
for (const id of ids) {
  const m = buildCaseModels(loadCaseById(id), {
    position: 'left-lateral',
    respiration: 'expiration',
    headElevationDeg: 0,
  });
  const gap = tipToSkin(m) - m.thorax.chestWall;
  process.stdout.write(
    `\n## ${id}\nApex tip ${f(gap, 2)} cm behind the chest wall along the axis (wall ${f(m.thorax.chestWall, 2)} cm); heart inside the wall ${f(intrusion(m, false), 2)} cm at end-diastole, ${f(intrusion(m, true), 2)} cm in systole.\n\n` +
      `| apical view | probe u, v | plane dev (°) | apex lat / depth / elev (cm) | axis tilt (°) | wall behind lung or rib |\n|---|---|---|---|---|---|\n` +
      APICAL.map((v) => apical(m, v)).join('\n') +
      `\n\n| parasternal view | probe u, v | obliquity (°) | plane dev (°) | first tissue (cm) |\n|---|---|---|---|---|\n` +
      PARASTERNAL.map((v) => parasternal(m, v)).join('\n') +
      '\n',
  );
}
