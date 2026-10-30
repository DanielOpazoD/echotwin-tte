// @tier slow
import { describe, expect, it } from 'vitest';
import { CASE_INPUTS } from '@/cases';
import { Structure, Tissue } from '@/simulator/anatomy/tissue';
import { code, heartCensus, label } from './heartCensus';
import { planeCensus } from './planeCensus';
import { STRUCTURE_NAME } from './structureNames';
import { ALLOWED_BLOOD, bloodPairKey as pairKey } from './allowedBlood';

/**
 * The coherence census (decision 331): clean eyes over the whole model. It asks nothing in particular; it lists every
 * pair of structures that touch, every island, the grey of every structure and the straightness of every cavity border,
 * and holds each against what anatomy and physics allow. What is wrong today is declared with its figure, and a
 * declaration that stops being needed fails the test.
 */
const GRID_CM = 0.15;
const PHASES = [0, 0.35];
const VIEWS = ['a4c', 'a2c', 'plax', 'psax-mv'];

const name = (st: number): string => STRUCTURE_NAME[st] ?? `#${st}`;

/**
 * Blood against blood where a wall belongs, with the largest area (cm²) any case shows at either phase: each entry is a
 * defect the census found and no decision has corrected yet. The right ventricle's inflow runs into the inferior vena
 * cava; in the dilated heart the right atrium touches a right pulmonary vein (decision 330: `KNOWN_RA_IN_VEIN`); the left atrium
 * reaches the root's lumen and the outflow tract at the curtain (decision 328: the orifice column against the LVOT). The
 * right atrium against the outflow tract in front of the root left with the supraventricular crest (decision 334).
 */
const KNOWN_BLOOD_CONTACTS: Record<string, number> = {
  // the inferior vena cava runs into the right ventricular inflow under the tricuspid ring at end-diastole (eleven cases, 0.04-1.1 cm²)
  'Ivc|RvCavity': 1.13,
  // a right pulmonary vein opens beside the fossa in the HFrEF, whose body sits forward (decision 330, KNOWN_RA_IN_VEIN)
  'PulmonaryVein|RaCavity': 0.65,
  // the orifice column against the outflow tract 1-3 mm basal of the anterior hinge, where the curtain is the tube wall (decision 328)
  'LaCavity|Lvot': 0.22,
  // the coronary sinus and the inferior vena cava meet lumen to lumen beside the Eustachian region instead of through the atrium
  'CoronarySinus|Ivc': 0.16,
  // not a contact: tissue thinner than the 1.5 mm grid falls between its points (decision 369). The fossa's membrane
  // (1.2 mm), bowed toward the right atrium at end-systole, and the 1.4 mm partition beside the root in moderate aortic
  // stenosis at end-diastole stand between the bloods, read every 0.1 mm; the grid caught them on the fixed plane before
  'LaCavity|RaCavity': 0.29,
  // the left atrium reaches the root lumen through its wall at the curtain (one face, mid-systole)
  'AorticRoot|LaCavity': 0.02,
};
/** Thin sheets break into pieces on the grid: not islands. */
const SHEETS = new Set<number>([Tissue.Valve, Tissue.Chordae]);
const ANNULI = new Set<number>([Structure.MitralAnnulus, Structure.TricuspidAnnulus]);

describe('coherence census: the bloods touch only through the orifices, and nothing floats (decision 331)', () => {
  const seenContacts = new Set<string>();
  for (const { id } of CASE_INPUTS)
    it(id, () => {
      const problems: string[] = [];
      for (const phase of PHASES) {
        const r = heartCensus(id, phase, GRID_CM);
        for (const k of r.contacts) {
          const ta = Math.floor(k.a / 64),
            tb = Math.floor(k.b / 64);
          if (ta !== Tissue.Blood || tb !== Tissue.Blood) continue;
          const key = pairKey(k.a % 64, k.b % 64);
          if (ALLOWED_BLOOD.has(key)) continue;
          const known = KNOWN_BLOOD_CONTACTS[key];
          if (known === undefined)
            problems.push(`@${phase}: ${key} ${k.cm2.toFixed(2)} cm² at ${k.at}`);
          else {
            seenContacts.add(key);
            if (k.cm2 > known * 1.25 + 0.05)
              problems.push(
                `@${phase}: ${key} ${k.cm2.toFixed(2)} cm² at ${k.at}, declared ${known}`,
              );
          }
        }
        for (const isl of r.islands) {
          const st = isl.structure % 64,
            ti = Math.floor(isl.structure / 64);
          if (SHEETS.has(ti) || ANNULI.has(st) || isl.ml < 0.05) continue;
          // no island is declared: a piece of one structure wholly inside another, ≥ 0.05 mL, fails outright
          problems.push(
            `@${phase}: island ${label(isl.structure)} inside ${label(isl.around)}, ${isl.ml.toFixed(2)} mL at ${isl.at}`,
          );
        }
      }
      expect(problems).toEqual([]);
    });
  it('every declared contact still shows in some case', () => {
    expect(Object.keys(KNOWN_BLOOD_CONTACTS).filter((k) => !seenContacts.has(k))).toEqual([]);
  });
});

/**
 * On the drawn planes the greys keep the physical order: a chamber's blood darker than its own walls, and no myocardium
 * brighter than the pericardium. Declared inversions, `case view @phase` → the pairs, with the largest figures: the left
 * atrial wall over the pericardium in the apical views at end-diastole in eleven cases (the atrial wall scatters without
 * anisotropy and sits in the far field under the time-gain), and the artifact case's anterior wall darker than its blood
 * (its window, by design). Since decision 333 the pericardium's interface echo is that of collagen against fat, and the
 * bright line beyond it is the pleura, 1.5 mm out, which the census counts as lung: in the two-chamber view of four more
 * planes a wall reads over the pericardium.
 */
const KNOWN_GREY_INVERSIONS: Record<string, string[]> = {
  'normal-excellent-window a4c @0': ['LaWall>Pericardium'],
  'normal-excellent-window a2c @0': ['LaWall>Pericardium'],
  // decision 366: the lateral wall of the left atrium runs along the beam from the shelf over the groove, and in these
  // planes it reads over the pericardium as the roof does in the others
  'normal-excellent-window a4c @0.35': ['LaWall>Pericardium'],
  'normal-difficult-window plax @0.35': ['LaWall>Pericardium'],
  'pulmonary-hypertension-rv a4c @0': ['LaWall>Pericardium'],
  'normal-difficult-window psax-mv @0': ['LvWallLateral>Pericardium'],
  // decision 368: at the leaflet tips the plane no longer cuts the atrial wall; the lateral and anterior walls read 86.2
  // and 80.2 against the pericardium's 78.7 at end-systole (the sac over the right atrium's lateral wall since 367)
  'normal-difficult-window psax-mv @0.35': [
    'LvWallLateral>Pericardium',
    'LvWallAnterior>Pericardium',
  ],
  // decision 378: the dilated atrium's sac follows its clipped wall, and the roof and lateral wall, now against the
  // pericardium where fat stood, read over it as the other atria do
  'hfref-severe-mr a4c @0': ['LaWall>Pericardium'],
  'hfref-severe-mr a2c @0': ['LaWall>Pericardium'],
  'hfref-severe-mr a2c @0.35': ['LaWall>Pericardium'],
  'inferior-rwma a4c @0': ['LaWall>Pericardium'],
  'inferior-rwma a4c @0.35': ['LaWall>Pericardium'],
  'inferior-rwma a2c @0': ['LaWall>Pericardium'],
  'inferior-rwma a2c @0.35': ['LaWall>Pericardium'],
  'aortic-stenosis-moderate a4c @0': ['LaWall>Pericardium'],
  'aortic-stenosis-moderate a2c @0': ['LaWall>Pericardium'],
  'aortic-stenosis-severe a4c @0': ['LaWall>Pericardium'],
  'aortic-stenosis-severe a2c @0': ['LaWall>Pericardium'],
  'aortic-stenosis-severe a2c @0.35': ['LaWall>Pericardium'],
  'hocm-sam a4c @0': ['LaWall>Pericardium'],
  'hocm-sam a2c @0': ['LaWall>Pericardium', 'LvApex>Pericardium'],
  'mvp-primary-mr a4c @0': ['LaWall>Pericardium'],
  'mvp-primary-mr a4c @0.35': ['LaWall>Pericardium'],
  'mvp-primary-mr a2c @0': ['LaWall>Pericardium'],
  'pulmonary-hypertension-rv a2c @0': ['LaWall>Pericardium'],
  'af-diastolic a2c @0': ['LaWall>Pericardium'],
  'af-diastolic a2c @0.35': ['LaWall>Pericardium'],
  // decision 380: without the ventricle's cap above the hinge the left atrium's lateral wall meets the pericardium where
  // the groove's fat stood, as it does over the roof (and in the PLAX of the AF case at end-systole the fat it read
  // against is gone, and with it the inversion)
  'aortic-stenosis-moderate a4c @0.35': ['LaWall>Pericardium'],
  'artifact-challenge a2c @0': [
    'LaWall>Pericardium',
    'LvCavity>=LvWallAnterior',
    'LvApex>Pericardium',
    'LvWallSeptal>Pericardium',
  ],
  'artifact-challenge a2c @0.35': [
    'LvCavity>=LvWallAnterior',
    'LvApex>Pericardium',
    'LvWallSeptal>Pericardium',
  ],
  // decision 368: at the leaflet tips the cavity no longer reads over its walls (73.6 against 83.9-97.5); the lateral
  // wall, 97.5, reads over the pericardium's 94.4 at end-systole
  'artifact-challenge psax-mv @0.35': ['LvWallLateral>Pericardium'],
};
/**
 * The longest straight run (cm) of each cavity's border, per view, over the cases and phases: a border that lies within
 * 0.3 mm of a straight line over 8 mm windows. The model draws some planes on purpose (the septal face, the posterior
 * plane on the aorta of decision 330) and some by construction that anatomy curves (the atrial roof clip, the right
 * ventricular free wall of the short axis: docs/LIMITATIONS.md). A longer run than declared is a new plane.
 */
const KNOWN_STRAIGHT_BORDERS: Record<string, number> = {
  'a2c LaCavity': 1.8,
  'a2c LvCavity': 3.1,
  // the septal face of the difficult window's left atrium, 3.2-3.3 cm straight at end-systole until the septum bowed
  // (decision 369)
  'a4c LaCavity': 2.3,
  'a4c LvCavity': 2.4,
  'a4c RaCavity': 1.1,
  'a4c RvCavity': 5.2,
  'plax LaCavity': 1.3,
  'plax LvCavity': 5.3,
  'plax RvCavity': 4.1,
  'psax-mv LvCavity': 0.8,
  'psax-mv RvCavity': 6.5,
};

const WALLS: Record<number, number[]> = {
  [Structure.LvCavity]: [
    Structure.LvWallSeptal,
    Structure.LvWallLateral,
    Structure.LvWallAnterior,
    Structure.LvWallInferior,
    Structure.LvApex,
  ],
  [Structure.LaCavity]: [Structure.LaWall],
  [Structure.RvCavity]: [Structure.RvWall],
  [Structure.RaCavity]: [Structure.RaWall],
};

describe('coherence census: greys in physical order and no new flat border (decision 331)', () => {
  const seenInversions = new Set<string>();
  const longest = new Map<string, number>();
  for (const { id } of CASE_INPUTS)
    it(id, () => {
      const problems: string[] = [];
      for (const viewId of VIEWS)
        for (const phase of PHASES) {
          const r = planeCensus(id, viewId, phase);
          const grey = new Map<number, number>();
          for (const g of r.greys) grey.set(code(g.structure, g.tissue), g.mean);
          const inversions: string[] = [];
          for (const [cav, walls] of Object.entries(WALLS)) {
            const b = grey.get(code(Number(cav), Tissue.Blood));
            if (b === undefined) continue;
            for (const w of walls) {
              const m = grey.get(code(w, Tissue.Myocardium));
              if (m !== undefined && b >= m) inversions.push(`${name(Number(cav))}>=${name(w)}`);
            }
          }
          const peri = grey.get(code(Structure.Pericardium, Tissue.Pericardium));
          if (peri !== undefined)
            for (const [k, v] of grey)
              if (Math.floor(k / 64) === Tissue.Myocardium && v > peri)
                inversions.push(`${name(k % 64)}>Pericardium`);
          const key = `${id} ${viewId} @${phase}`;
          const declared = KNOWN_GREY_INVERSIONS[key] ?? [];
          for (const inv of inversions)
            if (!declared.includes(inv)) problems.push(`${viewId} @${phase}: ${inv}`);
          for (const d of declared)
            if (inversions.includes(d)) seenInversions.add(`${key} ${d}`);
            else problems.push(`${viewId} @${phase}: declared ${d} no longer inverts`);
          for (const b of r.borders) {
            const bk = `${viewId} ${name(b.cavity)}`;
            const run = b.longest?.lengthCm ?? 0;
            longest.set(bk, Math.max(longest.get(bk) ?? 0, run));
            const max = KNOWN_STRAIGHT_BORDERS[bk];
            if (max === undefined) {
              if (run > 0.8)
                problems.push(
                  `${bk} @${phase}: straight run ${run.toFixed(1)} cm at ${b.longest!.at}`,
                );
            } else if (run > max + 0.2)
              problems.push(
                `${bk} @${phase}: straight run ${run.toFixed(1)} cm at ${b.longest!.at}, declared ${max}`,
              );
          }
        }
      expect(problems).toEqual([]);
    });
  it('every declared inversion still inverts, and no declared straight border has shortened by half a centimetre', () => {
    const stale = Object.entries(KNOWN_GREY_INVERSIONS).flatMap(([k, pairs]) =>
      pairs.filter((p) => !seenInversions.has(`${k} ${p}`)).map((p) => `${k} ${p}`),
    );
    expect(stale).toEqual([]);
    const shortened = Object.entries(KNOWN_STRAIGHT_BORDERS)
      .filter(([k, max]) => (longest.get(k) ?? 0) < max - 0.5)
      .map(([k, max]) => `${k}: ${max} declared, ${(longest.get(k) ?? 0).toFixed(1)} now`);
    expect(shortened).toEqual([]);
  });
});
