import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { computeHeartPose, createHeartModel, heartLandmarks } from '@/simulator/anatomy/heartModel';
import { createThoraxModel, type PatientState } from '@/simulator/anatomy/thoraxModel';
import { buildBeatTables, cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { Structure } from '@/simulator/anatomy/tissue';
import { VIEW_TARGETS } from './viewTargets';
import { fractionOfAny, LV_MYOCARDIUM, MITRAL_LEAFLETS, RIGHT_OUTFLOW, viewStructureFractions } from './viewContent';

/**
 * Every standard view must CONTAIN what a sonographer expects to see in it, and must NOT contain structures
 * that cannot be in that plane. The rest of the suite could not catch either: the goldens compare pixels of
 * a few views, and the model measurer checks sizes and spatial relations, not what ends up in the image.
 * That blind spot let the parasternal short axis of the great vessels carry zero pixels of pulmonary artery,
 * pulmonary valve and right outflow tract through twenty iterations (decisions 59 and 62).
 *
 * Thresholds sit well below the measured values, so the test fires when a structure disappears rather than
 * when it merely changes size. Fractions are of the sampled rectangle, as in tools/offline/render/slice-map.
 */
type Requirement = { label: string; group: readonly Structure[]; minPercent: number };
type Forbidden = { label: string; group: readonly Structure[]; maxPercent: number };

const need = (label: string, group: readonly Structure[] | Structure, minPercent: number): Requirement => ({ label, group: Array.isArray(group) ? group : [group as Structure], minPercent });
const never = (label: string, group: readonly Structure[] | Structure, maxPercent = 0.05): Forbidden => ({ label, group: Array.isArray(group) ? group : [group as Structure], maxPercent });

const EXPECTED: Record<string, { needs: Requirement[]; forbids?: Forbidden[] }> = {
  plax: {
    needs: [
      need('LV cavity', Structure.LvCavity, 3),
      need('LV myocardium', LV_MYOCARDIUM, 2),
      need('left atrium', Structure.LaCavity, 2),
      need('aortic root', Structure.AorticRoot, 2),
      need('right ventricle', Structure.RvCavity, 1),
      need('aortic valve', Structure.AorticValve, 0.05),
      need('mitral leaflets', MITRAL_LEAFLETS, 0.1),
    ],
    forbids: [never('inferior vena cava', Structure.Ivc), never('hepatic vein', Structure.HepaticVein)],
  },
  'psax-av': {
    needs: [
      need('aortic root', Structure.AorticRoot, 1),
      need('aortic valve', Structure.AorticValve, 0.1),
      need('right atrium', Structure.RaCavity, 1),
      need('left atrium', Structure.LaCavity, 1),
      need('right outflow tract, pulmonary valve or trunk', RIGHT_OUTFLOW, 0.5),
      need('pulmonary valve', Structure.PulmonaryValve, 0.02),
      need('tricuspid valve', Structure.TricuspidValve, 0.05),
    ],
  },
  'psax-mv': {
    needs: [need('LV cavity', Structure.LvCavity, 3), need('LV myocardium', LV_MYOCARDIUM, 2), need('mitral leaflets', MITRAL_LEAFLETS, 0.2), need('right ventricle', Structure.RvCavity, 1)],
    forbids: [never('inferior vena cava', Structure.Ivc), never('hepatic vein', Structure.HepaticVein)],
  },
  'psax-pm': {
    needs: [need('LV cavity', Structure.LvCavity, 3), need('LV myocardium', LV_MYOCARDIUM, 2), need('papillary muscles', Structure.PapillaryMuscle, 0.1), need('right ventricle', Structure.RvCavity, 1)],
    forbids: [never('inferior vena cava', Structure.Ivc), never('aortic root', Structure.AorticRoot)],
  },
  'psax-apex': { needs: [need('LV cavity', Structure.LvCavity, 2), need('LV myocardium', LV_MYOCARDIUM, 2)], forbids: [never('left atrium', Structure.LaCavity), never('aortic root', Structure.AorticRoot)] },
  a4c: {
    needs: [
      need('LV cavity', Structure.LvCavity, 3),
      need('right ventricle', Structure.RvCavity, 1),
      need('left atrium', Structure.LaCavity, 1),
      need('right atrium', Structure.RaCavity, 1),
      need('interatrial septum', Structure.InteratrialSeptum, 0.1),
      need('tricuspid valve', Structure.TricuspidValve, 0.05),
      need('mitral leaflets', MITRAL_LEAFLETS, 0.05),
      need('LV myocardium', LV_MYOCARDIUM, 2),
    ],
    forbids: [never('aortic root', Structure.AorticRoot)],
  },
  a5c: {
    needs: [need('LV cavity', Structure.LvCavity, 3), need('right ventricle', Structure.RvCavity, 1), need('right atrium', Structure.RaCavity, 1), need('left atrium', Structure.LaCavity, 1), need('outflow tract or aortic valve', [Structure.Lvot, Structure.AorticValve, Structure.AorticRoot], 0.3)],
  },
  a2c: {
    needs: [need('LV cavity', Structure.LvCavity, 3), need('left atrium', Structure.LaCavity, 2), need('LV myocardium', LV_MYOCARDIUM, 2), need('mitral leaflets', MITRAL_LEAFLETS, 0.1)],
    forbids: [never('pulmonary artery', Structure.PulmonaryArtery), never('inferior vena cava', Structure.Ivc)],
  },
  a3c: { needs: [need('LV cavity', Structure.LvCavity, 3), need('left atrium', Structure.LaCavity, 2), need('aortic root', Structure.AorticRoot, 1), need('mitral leaflets', MITRAL_LEAFLETS, 0.1)] },
  'subcostal-4c': {
    needs: [need('LV cavity', Structure.LvCavity, 2), need('right ventricle', Structure.RvCavity, 0.5), need('left atrium', Structure.LaCavity, 0.5), need('right atrium', Structure.RaCavity, 0.5), need('interatrial septum', Structure.InteratrialSeptum, 0.1)],
  },
  'subcostal-ivc': { needs: [need('inferior vena cava', Structure.Ivc, 1), need('right atrium', Structure.RaCavity, 0.5)] },
  'rv-focused': { needs: [need('right ventricle', Structure.RvCavity, 2), need('RV free wall', Structure.RvWall, 0.5), need('right atrium', Structure.RaCavity, 1), need('tricuspid valve', Structure.TricuspidValve, 0.05)] },
};

/**
 * View/structure pairs the geometry cannot satisfy yet. Each must be named in docs/LIMITATIONS.md and
 * removed once fixed — the same contract as KNOWN_MODEL_LIMITATIONS in proportions.test.ts.
 */
const KNOWN_VIEW_LIMITATIONS: ReadonlySet<string> = new Set([
  // The great-vessel short axis reaches the trunk but not the cusps: the plane drawn passes 0.54 cm from the
  // pulmonary annulus, close enough to be in the sector and far enough to miss a leaflet (decision 62).
  'psax-av/pulmonary valve',
  // The mitral short axis cuts the inferior vena cava and a hepatic vein, which cannot be in that plane;
  // the parasternal window solver puts the beam 24.3° away from the requested short axis (decision 59).
  'psax-mv/inferior vena cava',
  'psax-mv/hepatic vein',
]);

describe('standard views contain the structures they are meant to show', () => {
  const patient: PatientState = { position: 'left-lateral', respiration: 'expiration', headElevationDeg: 0 };
  const c = loadCaseById('normal-excellent-window');
  const thorax = createThoraxModel(c.bodyHabitus, c.acousticWindow, patient);
  const heart = createHeartModel(c.anatomy, c.physiology, thorax.heartOffset, c.seed);
  heartLandmarks(heart);
  const tables = buildBeatTables(60 / c.rhythm.heartRateBpm, c.physiology, c.rhythm, c.hemodynamics);

  for (const view of VIEW_TARGETS) {
    const spec = EXPECTED[view.id];
    if (!spec) continue;
    it(`${view.id}: shows its structures and nothing impossible`, { timeout: 60_000 }, () => {
      // diastole and mid-systole: a structure may only be visible in one of them (a closed valve, a small
      // systolic cavity), so each requirement is satisfied if it holds in either phase
      const frames = [0, 0.3].map((phase) => viewStructureFractions(view, heart, thorax, computeHeartPose(heart, cycleStateAt(tables, phase))));
      const missing = spec.needs
        .filter((r) => !KNOWN_VIEW_LIMITATIONS.has(`${view.id}/${r.label}`))
        .filter((r) => !frames.some((f) => 100 * fractionOfAny(f, r.group) >= r.minPercent))
        .map((r) => `${r.label} ${(100 * Math.max(...frames.map((f) => fractionOfAny(f, r.group)))).toFixed(2)}% < ${r.minPercent}%`);
      expect(missing, `${view.id}: structures the view should show`).toEqual([]);
      const impossible = (spec.forbids ?? [])
        .filter((r) => !KNOWN_VIEW_LIMITATIONS.has(`${view.id}/${r.label}`))
        .filter((r) => frames.some((f) => 100 * fractionOfAny(f, r.group) > r.maxPercent))
        .map((r) => `${r.label} ${(100 * Math.max(...frames.map((f) => fractionOfAny(f, r.group)))).toFixed(2)}% > ${r.maxPercent}%`);
      expect(impossible, `${view.id}: structures that cannot be in this plane`).toEqual([]);
      // a declared limitation that no longer fails is stale and hides a requirement that now holds: the
      // 'a5c/left atrium' entry was exactly that, written from a single-phase listing (decision 63)
      const stale = [...spec.needs.map((r) => ({ label: r.label, ok: frames.some((f) => 100 * fractionOfAny(f, r.group) >= r.minPercent) })), ...(spec.forbids ?? []).map((r) => ({ label: r.label, ok: !frames.some((f) => 100 * fractionOfAny(f, r.group) > r.maxPercent) }))]
        .filter((r) => r.ok && KNOWN_VIEW_LIMITATIONS.has(`${view.id}/${r.label}`))
        .map((r) => `${view.id}/${r.label}`);
      expect(stale, `${view.id}: declared limitations that no longer apply`).toEqual([]);
    });
  }
});
