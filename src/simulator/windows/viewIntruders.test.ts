// @tier slow
import { describe, expect, it } from 'vitest';
import { CASE_INPUTS, loadCaseById } from '@/cases';
import { buildCaseModels } from '@/simulator/anatomy/caseModels';
import { computeHeartPose } from '@/simulator/anatomy/heartModel';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { Structure } from '@/simulator/anatomy/tissue';
import { VIEW_TARGETS } from './viewTargets';
import { viewStructureFractions } from './viewContent';
import { CUT_MAP_LABELS } from '@/simulator/anatomy/structurePalette';
import { VIEW_ALLOWED, VIEW_BACKGROUND, VIEW_PRESENCE_THRESHOLD } from './viewWhitelist';

/**
 * Nothing appears in a view that has no reason to be there (decision 325). `viewContent.test.ts` requires what each view
 * must show and forbids a few structures by name, so a structure nobody thought to forbid could enter a plane unnoticed:
 * the superior vena cava drew a circle beyond the right atrium in the normal apical four-chamber view (1.2 % of the
 * sector) until decision 324, and the right atrial appendage of decision 323 first opened into the cava's junction.
 * Here every view lists the cardiac and vascular structures it may hold, reviewed against what a sonographer sees in it;
 * in every case at end-diastole and mid-systole any other one over 0.3 % of the sector fails. The chest wall, lung, liver,
 * pericardium, fat, effusion and descending aorta are background and not listed (`viewWhitelist.ts`).
 */
/** Structures a view shows that it should not, declared with the reason; a declared one that no longer shows is stale. */
const KNOWN_VIEW_INTRUDERS: Record<string, string> = {
  'psax-mv/Ivc':
    'the plane leans into the atria behind the base: the junction of the inferior vena cava with the right atrium, 8-10 cm deep at the left edge (decision 164)',
  'psax-mv/RaCavity': 'the same lean: the right atrium behind the base',
  'psax-mv/RaWall': 'the same lean: the right atrial wall',
  'psax-mv/LaCavity': 'the same lean: the left atrium behind the base',
  'psax-mv/LaWall': 'the same lean: the left atrial wall',
  'psax-mv/PulmonaryVein': 'the same lean: a right pulmonary vein beside the atria',
  'a2c/PulmonaryArtery':
    'the plane clips the pulmonary trunk beside the appendage, 12-14 cm deep (decisions 72 and 83)',
  'a2c/Ivc': 'the swinging heart of the tamponade brings the inferior vena cava into the plane',
  'a2c/AorticRoot': 'the swinging heart of the tamponade brings the aortic root into the plane',
  'a2c/RvWall':
    'the plane of the artifact case clips the right ventricular wall at the septal edge',
  'subcostal-4c/Ivc':
    'the swinging heart of the tamponade brings the inferior vena cava into the plane',
  // (the septum and the right atrial wall left the suprasternal arch's sector in decision 330, with the left atrium's
  // posterior wall on the column and the right atrium's own radial fraction)
  'suprasternal-arch/InteratrialSeptum':
    'the anterior rim of the septum, which rests on the sinuses of the root since decision 335, enters the sector of the difficult window at end-systole',
};

/** The structures named in KNOWN_VIEW_INTRUDERS. */
const BY_NAME: Record<string, Structure> = {
  AorticRoot: Structure.AorticRoot,
  InteratrialSeptum: Structure.InteratrialSeptum,
  Ivc: Structure.Ivc,
  LaCavity: Structure.LaCavity,
  LaWall: Structure.LaWall,
  PulmonaryArtery: Structure.PulmonaryArtery,
  PulmonaryVein: Structure.PulmonaryVein,
  RaCavity: Structure.RaCavity,
  RaWall: Structure.RaWall,
  RvWall: Structure.RvWall,
};
const NAME = CUT_MAP_LABELS as Partial<Record<number, string>>;

describe('nothing appears in a view without a reason (decision 325)', () => {
  const seen = new Map<string, string>();
  for (const { id } of CASE_INPUTS)
    it(id, () => {
      const { thorax, heart, tables } = buildCaseModels(loadCaseById(id), {
        position: 'left-lateral',
        respiration: 'expiration',
        headElevationDeg: 0,
      });
      const problems: string[] = [];
      for (const phase of [0, 0.3]) {
        const pose = computeHeartPose(heart, cycleStateAt(tables, phase));
        for (const view of VIEW_TARGETS) {
          const allowed = new Set(VIEW_ALLOWED[view.id] ?? []);
          for (const [st, f] of viewStructureFractions(view, heart, thorax, pose)) {
            if (f < VIEW_PRESENCE_THRESHOLD || VIEW_BACKGROUND.has(st) || allowed.has(st)) continue;
            const key = Object.keys(KNOWN_VIEW_INTRUDERS).find(
              (k) => k.startsWith(`${view.id}/`) && BY_NAME[k.slice(view.id.length + 1)] === st,
            );
            if (key) seen.set(key, id);
            else
              problems.push(
                `${view.id}/${NAME[st] ?? st} @${phase}: ${(100 * f).toFixed(2)} % of the sector`,
              );
          }
        }
      }
      expect(problems).toEqual([]);
    });
  it('every declared intruder still shows in some case', () => {
    const stale = Object.keys(KNOWN_VIEW_INTRUDERS).filter((k) => !seen.has(k));
    expect(stale).toEqual([]);
  });
});
