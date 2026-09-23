// @tier fast
import { describe, expect, it } from 'vitest';
import { CASE_INPUTS, loadCaseById } from '@/cases';
import { buildCaseModels } from '@/simulator/anatomy/caseModels';
import { heartLandmarks, heartToTorso } from '@/simulator/anatomy/heartModel';
import { dot, sub } from '@/core/vec3';
import { canonicalPlane, landmarkReachCm, VIEW_TARGETS } from './viewTargets';

/**
 * Every landmark a view asks for lies within reach of the plane that defines it (decision 164). The view engine counts
 * a landmark as seen within 0.45 + 0.55 × its radius of the drawn plane (`testLandmark` in `viewQuality.ts`) and scores
 * the view by the landmarks it sees, so one beyond that distance from the view's own plane is one no probe can show
 * while holding the view: it caps the view's score for everyone. The mitral short axis asked for the RV inflow, the
 * inferoseptum and the inferolateral wall of the mid ventricle, 1.6–2.5 cm toward the apex from its plane, and its own
 * preset scored 69 with the mitral valve as the only landmark it saw. Measured on the defined plane (the drawn one adds
 * the obliquity of its window) at end-diastole, in the twelve cases.
 */
const KNOWN_UNREACHABLE_LANDMARKS: ReadonlySet<string> = new Set([
  // optional landmarks outside the plane in every case: the descending aorta behind the PLAX, the mid-level RV inflow of
  // the papillary short axis, the apex tip in the apical short axis, the interatrial septum of the A4C, the mitral
  // valve and the RV inflow of the A5C, and the LV apex of the RV-focused view; the left atrium and the tricuspid
  // valve of the subcostal four-chamber view, up to 1.11 and 1.32 reaches away in some cases: its window is below the
  // four-chamber plane, and its solved plane keeps the required landmarks nearer (decision 167)
  'plax/desc-aorta',
  'psax-pm/rv',
  'psax-apex/lv-apex',
  'a4c/ias',
  'a5c/mv',
  'a5c/rv',
  'subcostal-4c/la',
  'subcostal-4c/tv',
  'rv-focused/lv-apex',
  // the tricuspid valve of the great-vessel short axis, outside in four cases (decision 148 turns the plane toward it)
  'psax-av/tv',
]);

describe('the landmarks a view asks for lie on its own plane', () => {
  it('within the reach the view engine allows, in the twelve cases', () => {
    const off = new Map<string, string>();
    for (const input of CASE_INPUTS) {
      const c = loadCaseById(input.id);
      const { heart, thorax } = buildCaseModels(c, {
        position: 'left-lateral',
        respiration: 'expiration',
        headElevationDeg: 0,
      });
      const landmarks = new Map(heartLandmarks(heart).map((l) => [l.id, l]));
      for (const view of VIEW_TARGETS) {
        const plane = canonicalPlane(view, heart, thorax);
        for (const want of view.requiredLandmarks) {
          const l = landmarks.get(want.landmarkId);
          expect(l, `${view.id} asks for an unknown landmark ${want.landmarkId}`).toBeDefined();
          const d = dot(sub(heartToTorso(heart.frame, l!.p), plane.target), plane.normal);
          const reach = landmarkReachCm(l!.radius);
          const key = `${view.id}/${want.landmarkId}`;
          if (Math.abs(d) > reach && !off.has(key))
            off.set(
              key,
              `${key} ${d.toFixed(2)} cm from the plane in ${c.id} (reach ${reach.toFixed(2)})`,
            );
        }
      }
    }
    const undeclared = [...off]
      .filter(([k]) => !KNOWN_UNREACHABLE_LANDMARKS.has(k))
      .map(([, v]) => v);
    const stale = [...KNOWN_UNREACHABLE_LANDMARKS].filter((k) => !off.has(k));
    expect({ undeclared, stale }).toEqual({ undeclared: [], stale: [] });
  });
});
