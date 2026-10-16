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

/**
 * Nothing appears in a view that has no reason to be there (decision 325). `viewContent.test.ts` requires what each view
 * must show and forbids a few structures by name, so a structure nobody thought to forbid could enter a plane unnoticed:
 * the superior vena cava drew a circle beyond the right atrium in the normal apical four-chamber view (1.2 % of the
 * sector) until decision 324, and the right atrial appendage of decision 323 first opened into the cava's junction.
 * Here every view lists the cardiac and vascular structures it may hold, reviewed against what a sonographer sees in it;
 * in every case at end-diastole and mid-systole any other one over 0.3 % of the sector fails. The chest wall, lung, liver,
 * pericardium, fat, effusion and descending aorta are background and not listed.
 */
const THRESHOLD = 0.003;
const BACKGROUND = new Set<Structure>([
  Structure.ChestWall,
  Structure.Rib,
  Structure.Sternum,
  Structure.Lung,
  Structure.Liver,
  Structure.Spine,
  Structure.Diaphragm,
  Structure.Stomach,
  Structure.EpicardialFat,
  Structure.Pericardium,
  Structure.PericardialEffusion,
  Structure.DescendingAorta,
  Structure.None,
]);

const ALLOWED: Record<string, readonly Structure[]> = {
  plax: [
    Structure.AorticRoot,
    Structure.AscendingAorta,
    Structure.LaCavity,
    Structure.LaWall,
    Structure.LvApex,
    Structure.LvCavity,
    Structure.LvWallInferior,
    Structure.LvWallLateral,
    Structure.LvWallSeptal,
    Structure.Lvot,
    Structure.RvCavity,
    Structure.RvWall,
    Structure.Rvot,
    Structure.Svc,
  ],
  'psax-av': [
    Structure.AorticRoot,
    Structure.AorticValve,
    Structure.InteratrialSeptum,
    Structure.LaAppendage,
    Structure.LaCavity,
    Structure.LaWall,
    Structure.LvWallSeptal,
    Structure.PulmonaryArtery,
    Structure.PulmonaryVein,
    Structure.RaCavity,
    Structure.RaWall,
    Structure.RvCavity,
    Structure.RvWall,
    Structure.Rvot,
    Structure.TricuspidValve,
  ],
  'psax-mv': [
    Structure.CoronarySinus,
    Structure.LvCavity,
    Structure.LvWallAnterior,
    Structure.LvWallInferior,
    Structure.LvWallLateral,
    Structure.LvWallSeptal,
    Structure.MitralPosterior,
    Structure.RvCavity,
    Structure.RvWall,
    Structure.TricuspidValve,
  ],
  'psax-pm': [
    Structure.LvCavity,
    Structure.LvWallAnterior,
    Structure.LvWallInferior,
    Structure.LvWallLateral,
    Structure.LvWallSeptal,
    Structure.ModeratorBand,
    Structure.PapillaryMuscle,
    Structure.RvCavity,
    Structure.RvWall,
  ],
  'psax-apex': [
    Structure.LvCavity,
    Structure.LvWallAnterior,
    Structure.LvWallInferior,
    Structure.LvWallLateral,
    Structure.LvWallSeptal,
    Structure.RvCavity,
    Structure.RvWall,
  ],
  a4c: [
    Structure.InteratrialSeptum,
    Structure.LaCavity,
    Structure.LaWall,
    Structure.LvApex,
    Structure.LvCavity,
    Structure.LvWallAnterior,
    Structure.LvWallLateral,
    Structure.LvWallSeptal,
    Structure.PapillaryMuscle,
    Structure.PulmonaryVein,
    Structure.RaCavity,
    Structure.RaWall,
    Structure.RvCavity,
    Structure.RvWall,
    Structure.Svc,
  ],
  a5c: [
    Structure.AorticRoot,
    Structure.AscendingAorta,
    Structure.LaCavity,
    Structure.LaWall,
    Structure.LvApex,
    Structure.LvCavity,
    Structure.LvWallInferior,
    Structure.LvWallLateral,
    Structure.LvWallSeptal,
    Structure.Lvot,
    Structure.PapillaryMuscle,
    Structure.PulmonaryVein,
    Structure.RaAppendage,
    Structure.RaWall,
    Structure.RvCavity,
    Structure.RvPapillary,
    Structure.RvWall,
    Structure.Rvot,
    Structure.Svc,
  ],
  a2c: [
    Structure.AorticArch,
    Structure.LaAppendage,
    Structure.LaCavity,
    Structure.LaWall,
    Structure.LvApex,
    Structure.LvCavity,
    Structure.LvWallAnterior,
    Structure.LvWallInferior,
    Structure.LvWallSeptal,
    Structure.PapillaryMuscle,
  ],
  a3c: [
    Structure.AorticRoot,
    Structure.AscendingAorta,
    Structure.LaCavity,
    Structure.LaWall,
    Structure.LvApex,
    Structure.LvCavity,
    Structure.LvWallInferior,
    Structure.LvWallLateral,
    Structure.LvWallSeptal,
    Structure.Lvot,
    Structure.RvCavity,
    Structure.RvWall,
    Structure.Rvot,
    Structure.Svc,
  ],
  'subcostal-4c': [
    Structure.InteratrialSeptum,
    Structure.LaAppendage,
    Structure.LaCavity,
    Structure.LaWall,
    Structure.LvApex,
    Structure.LvCavity,
    Structure.LvWallAnterior,
    Structure.LvWallInferior,
    Structure.LvWallLateral,
    Structure.LvWallSeptal,
    Structure.PapillaryMuscle,
    Structure.PulmonaryVein,
    Structure.RaCavity,
    Structure.RaWall,
    Structure.RvCavity,
    Structure.RvWall,
    Structure.Svc,
  ],
  'subcostal-ivc': [
    Structure.AscendingAorta,
    Structure.HepaticVein,
    Structure.InteratrialSeptum,
    Structure.Ivc,
    Structure.LaCavity,
    Structure.LaWall,
    Structure.LvWallSeptal,
    Structure.PulmonaryVein,
    Structure.RaCavity,
    Structure.RaWall,
    Structure.RvCavity,
    Structure.RvWall,
    Structure.Rvot,
    Structure.Svc,
  ],
  'suprasternal-arch': [
    Structure.AorticArch,
    Structure.AorticRoot,
    Structure.AorticValve,
    Structure.AscendingAorta,
    Structure.BrachiocephalicArtery,
    Structure.LaCavity,
    Structure.LaWall,
    Structure.LeftCommonCarotid,
    Structure.LvWallSeptal,
    Structure.Lvot,
    Structure.PulmonaryArtery,
    Structure.PulmonaryVein,
    Structure.RaCavity,
    Structure.RvCavity,
    Structure.RvWall,
    Structure.Rvot,
  ],
  'rv-focused': [
    Structure.InteratrialSeptum,
    Structure.LaCavity,
    Structure.LaWall,
    Structure.LvApex,
    Structure.LvCavity,
    Structure.LvWallInferior,
    Structure.LvWallLateral,
    Structure.LvWallSeptal,
    Structure.PapillaryMuscle,
    Structure.PulmonaryVein,
    Structure.RaCavity,
    Structure.RaWall,
    Structure.RvCavity,
    Structure.RvWall,
    Structure.Svc,
    Structure.TricuspidValve,
  ],
};

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
  'a2c/RvWall': "the artifact case's plane clips the right ventricular wall at the septal edge",
  'subcostal-4c/Ivc':
    'the swinging heart of the tamponade brings the inferior vena cava into the plane',
  'suprasternal-arch/InteratrialSeptum':
    'the atrial roof reaches the bottom of the sector in the difficult window: the septum, 0.31 % at mid-systole, since the atria meet it flat (decision 327)',
  'suprasternal-arch/RaWall':
    'the dilated right atrium of the HFrEF reaches the edge of the sector (10.5-13.5 cm deep): its wall, 0.30 % at mid-systole, since the atria meet the septum flat (decision 327)',
  'plax/PulmonaryVein':
    'a pulmonary vein behind the left atrium of the tamponade, 0.32 %, since the atrium meets the septum flat and its volume normalisation rescaled it (decision 327)',
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
          const allowed = new Set(ALLOWED[view.id] ?? []);
          for (const [st, f] of viewStructureFractions(view, heart, thorax, pose)) {
            if (f < THRESHOLD || BACKGROUND.has(st) || allowed.has(st)) continue;
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
