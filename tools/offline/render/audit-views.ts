/**
 * View geometry audit: for each view target, compare the *achievable* canonical beam (from the
 * intercostal window of the synthetic thorax) with the *anatomical* plane the view is supposed to
 * show. Prints the plane-normal angle, the in-plane rotation error, the offset of the target from
 * the beam centre line and, per required landmark, its distance from the beam plane.
 *   npx tsx tools/offline/render/audit-views.ts [caseId]
 */
import { loadCaseById } from '@/cases';
import { createHeartModel, heartLandmarks, heartToTorso } from '@/simulator/anatomy/heartModel';
import { createThoraxModel } from '@/simulator/anatomy/thoraxModel';
import {
  VIEW_TARGETS,
  canonicalBeam,
  canonicalControl,
  canonicalPlane,
} from '@/simulator/windows/viewTargets';
import { cross, dot, normalize, scale, sub } from '@/core/vec3';

const c = loadCaseById(process.argv[2] ?? 'normal-excellent-window');
const thorax = createThoraxModel(c.bodyHabitus, c.acousticWindow, {
  position: 'left-lateral',
  respiration: 'expiration',
  headElevationDeg: 0,
});
const heart = createHeartModel(c.anatomy, c.physiology, thorax.heartOffset, c.seed);
const landmarks = heartLandmarks(heart);
const deg = (r: number) => (r * 180) / Math.PI;
for (const view of VIEW_TARGETS) {
  const plane = canonicalPlane(view, heart);
  const beam = canonicalBeam(view, heart, thorax);
  const ctrl = canonicalControl(view, heart, thorax);
  const planeAngle = deg(Math.acos(Math.min(1, Math.abs(dot(plane.normal, beam.normal)))));
  const rightProj = normalize(sub(plane.right, scale(beam.normal, dot(plane.right, beam.normal))));
  const inPlane = deg(Math.acos(Math.min(1, Math.max(-1, dot(rightProj, beam.lateral)))));
  const rel = sub(plane.target, beam.origin);
  const along = dot(rel, beam.forward);
  const off = Math.hypot(dot(rel, beam.lateral), dot(rel, beam.normal));
  const lat = dot(rel, beam.lateral);
  const elev = dot(rel, beam.normal);
  process.stdout.write(
    `\n${view.id.padEnd(11)} plane ${planeAngle.toFixed(1).padStart(5)}°  in-plane ${inPlane.toFixed(1).padStart(5)}°  target off ${off.toFixed(2)} cm (lat ${lat.toFixed(2)}, elev ${elev.toFixed(2)}) at depth ${along.toFixed(1)}  ctrl u=${ctrl.u.toFixed(1)} v=${ctrl.v.toFixed(1)} rot=${ctrl.rotationDeg.toFixed(0)} tilt=${ctrl.tiltDeg.toFixed(0)} rock=${ctrl.rockDeg.toFixed(0)}\n`,
  );
  const req = view.requiredLandmarks.map((r) => r.landmarkId);
  const rows: string[] = [];
  for (const id of req) {
    const lm = landmarks.find((l) => l.id === id);
    if (!lm) continue;
    const p = heartToTorso(heart.frame, lm.p);
    const d = sub(p, beam.origin);
    const e = dot(d, beam.normal);
    const l = dot(d, beam.lateral);
    const f = dot(d, beam.forward);
    const ang = deg(Math.atan2(l, f));
    rows.push(
      `${id}: elev ${e.toFixed(2)} (r ${lm.radius}) lat ${ang.toFixed(0)}° depth ${f.toFixed(1)}`,
    );
  }
  process.stdout.write('  ' + rows.join(' | ') + '\n');
  void cross;
}
