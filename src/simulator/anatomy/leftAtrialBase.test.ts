// @tier slow
import { describe, expect, it } from 'vitest';
import { CASE_INPUTS, loadCaseById } from '@/cases';
import { SimulatorCore } from '@/simulator/core/simulatorCore';
import { baseInput } from '@/simulator/core/baseInput';
import { classifyHeart, computeHeartPose } from '@/simulator/anatomy/heartModel';
import { LA_CORNER_ANTERIOR_MARGIN_CM } from '@/simulator/anatomy/laGeometry';
import { anchorsCached } from '@/simulator/anatomy/anchors';
import { LA_WALL_CM } from '@/simulator/anatomy/classify/pericardium';
import { mitralHingeZ } from '@/simulator/anatomy/mitralValve';
import { makeSample, Structure } from '@/simulator/anatomy/tissue';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { CUT_MAP_LABELS } from '@/simulator/anatomy/structurePalette';

const NAME = CUT_MAP_LABELS as Partial<Record<number, string>>;

/**
 * The left atrium sits broad on its annulus (decision 328): its wall rises from the hinge all around, so just outside the
 * annulus the blood lies a few millimetres above the hinge behind the atrial wall and nothing else. The ellipsoid tapered
 * to a tip above the annulus: 3 mm outside the ring (normal case, 24 azimuths) the blood lay more than 2.5 cm above the
 * hinge behind 6-19 mm of fat, the coronary sinus and the pulmonary veins, and under the anterior hinge of the two-chamber
 * view 10 mm of fat and fibrous filler stood where the atrium is. At 24 azimuths around the ring, 3 mm outside the annulus
 * outline and behind the curtain's bound (the aortic root stands in front of it), walking basally from the hinge: left
 * atrial blood within 10 mm, and before it only the ventricular wall's rim, the atrial wall and at most 1 mm of fat.
 */
/**
 * Declared (decision 330): with the posterior wall on the column the volume fit draws the tamponade's small atrium (42 mL)
 * shorter, and its left inferior pulmonary vein, placed at a fraction of the atrium's length, lies 1.0 cm above the
 * annulus at end-diastole: its lumen crosses the column 3 mm outside the posterolateral ring, 3-5 mm above the hinge, in
 * front of the atrial blood. Since decision 335, where the atrium meets its septal face beside the root, the fit draws
 * the difficult window's atrium the same way at end-diastole (0.6 mm of fat and the vein). An entry whose column shows no
 * vein is stale.
 */
const KNOWN_VEIN_AT_HINGE: Record<string, string> = {
  'pericardial-effusion-tamponade @0': '210°',
};
const MAX_BELOW_MM = 10;
const MAX_FAT_MM = 1;
const RING_OUTSIDE_CM = 0.3;
const WALLS = new Set<number>([
  Structure.LvWallSeptal,
  Structure.LvWallAnterior,
  Structure.LvWallInferior,
  Structure.LvWallLateral,
  Structure.LaWall,
  Structure.LvCavity,
  Structure.MitralAnterior,
  Structure.MitralPosterior,
  Structure.MitralAnnulus,
]);

describe('the left atrium sits broad on its annulus (decision 328)', () => {
  for (const { id } of CASE_INPUTS)
    for (const phase of [0, 0.35])
      it(`${id} @${phase}`, () => {
        const c = loadCaseById(id);
        const { heart, tables } = new SimulatorCore(c, baseInput()).models;
        const pose = computeHeartPose(heart, cycleStateAt(tables, phase));
        const mv = pose.valves.mitral;
        const A = anchorsCached(heart);
        const s = makeSample();
        const problems: string[] = [];
        let checked = 0;
        let stale = KNOWN_VEIN_AT_HINGE[`${id} @${phase}`] !== undefined;
        for (let k = 0; k < 24; k++) {
          const a = (k / 24) * 2 * Math.PI;
          const rad = mv.R + RING_OUTSIDE_CM;
          const v = rad * Math.cos(a),
            u = rad * Math.sin(a);
          // in front of the straight edge the curtain and the root stand, not the atrium
          if (v > mv.D + LA_CORNER_ANTERIOR_MARGIN_CM - RING_OUTSIDE_CM) continue;
          const x = mv.cx + mv.ux * v - mv.uy * u,
            y = mv.cy + mv.uy * v + mv.ux * u;
          const zh = mitralHingeZ(x, y, mv);
          // where the posterior wall plane on the descending aorta stands (decision 330) the groove is the atrium's
          // limit, and the base is not asked for
          if (x * A.laPostN.x + y * A.laPostN.y + zh * A.laPostN.z > A.laPostD - LA_WALL_CM)
            continue;
          let found = NaN,
            fatMm = 0;
          const others = new Set<number>();
          for (let dz = 0.02; dz <= 3.5; dz += 0.02) {
            const hit = classifyHeart(heart, pose, x, y, zh - dz, s);
            if (hit && s.structure === Structure.LaCavity) {
              found = dz;
              break;
            }
            if (hit && s.structure === Structure.EpicardialFat) fatMm += 0.2;
            else if (!hit || !WALLS.has(s.structure)) others.add(hit ? s.structure : -1);
          }
          // no atrial blood anywhere above this point: the atrium's own shape stops short of the ring here (the
          // groove lies under the hinge), and the base, bounded by that shape, is not asked for
          if (Number.isNaN(found)) continue;
          checked++;
          const deg = ((a * 180) / Math.PI).toFixed(0);
          if (!(found * 10 <= MAX_BELOW_MM))
            problems.push(
              `${deg}°: left atrial blood ${(found * 10).toFixed(1)} mm below the hinge`,
            );
          else if (
            KNOWN_VEIN_AT_HINGE[`${id} @${phase}`] === `${deg}°` &&
            others.size === 1 &&
            others.has(Structure.PulmonaryVein)
          )
            stale = false;
          else if (fatMm > MAX_FAT_MM + 1e-9 || others.size)
            problems.push(
              `${deg}°: ${fatMm.toFixed(1)} mm of fat${others.size ? `, ${[...others].map((st) => NAME[st] ?? st).join('/')}` : ''} between the hinge and the blood`,
            );
        }
        expect(checked).toBeGreaterThanOrEqual(12);
        if (stale) problems.push('declared vein at the hinge, and none crosses the column');
        expect(problems).toEqual([]);
      });
});
