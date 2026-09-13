import { describe, expect, it } from 'vitest';
import { CASE_INPUTS, loadCaseById } from '@/cases';
import { classifyHeart, computeHeartPose, createHeartModel, heartLandmarks, heartToTorso, torsoToHeart, type HeartModel, type HeartPose } from '@/simulator/anatomy/heartModel';
import { createThoraxModel, isAnteriorLung, snapToIntercostal, type PatientState, type ThoraxModel } from '@/simulator/anatomy/thoraxModel';
import { buildBeatTables, cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { makeSample, Structure } from '@/simulator/anatomy/tissue';
import { canonicalControl, canonicalPlane, getViewTarget, VIEW_TARGETS } from './viewTargets';
import { beamFrameFromPose, controlAimingAt, poseFromControl, type ProbeControl } from '@/simulator/probe/pose';
import { add, scale, v3 } from '@/core/vec3';
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
  // The two-chamber plane clips the pulmonary trunk beside the left atrial appendage, 12-14 cm deep at the anterior edge
  // of the sector. The lung hid it until the A2C preset stopped sliding under the lingula (decisions 72 and 83).
  'a2c/pulmonary artery',
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

describe('apical presets keep the ventricle clear of lung where the window allows (decision 83)', () => {
  const LV_WALL: ReadonlySet<Structure> = new Set(LV_MYOCARDIUM);
  /** Share of the LV wall in the drawn sector at end diastole with lung between it and the probe. */
  const hiddenWall = (heart: HeartModel, thorax: ThoraxModel, control: ProbeControl, pose: HeartPose): number => {
    const beam = beamFrameFromPose(poseFromControl(thorax, control), 1);
    const s = makeSample();
    let wall = 0,
      hidden = 0;
    for (let i = 0; i <= 60; i++) {
      const a = ((i / 60 - 0.5) * 80 * Math.PI) / 180;
      const dir = add(scale(beam.forward, Math.cos(a)), scale(beam.lateral, Math.sin(a)));
      let behind = false;
      for (let r = 0.1; r < 16; r += 0.1) {
        const p = add(beam.origin, scale(dir, r));
        behind ||= isAnteriorLung(thorax, p.x, p.y, p.z);
        const h = torsoToHeart(heart.frame, p);
        if (classifyHeart(heart, pose, h.x, h.y, h.z, s) && LV_WALL.has(s.structure)) {
          wall++;
          if (behind) hidden++;
        }
      }
    }
    return hidden / Math.max(1, wall);
  };
  it('the A2C preset leaves at most a fifth of the LV wall behind lung, or little more than the apex position itself', { timeout: 120_000 }, () => {
    // sliding the full 2 cm toward the two-chamber plane hid 23-50% of the wall, 38% in the normal case
    const problems: string[] = [];
    for (const input of CASE_INPUTS) {
      const c = loadCaseById(input.id);
      // the difficult windows put lung over the cardiac notch on purpose
      if (c.acousticWindow.lungOverlapCm > 0.5) continue;
      const thorax = createThoraxModel(c.bodyHabitus, c.acousticWindow, { position: 'left-lateral', respiration: 'expiration', headElevationDeg: 0 }, c.anatomy.ivc.collapsePct);
      const heart = createHeartModel(c.anatomy, c.physiology, thorax.heartOffset, c.seed, thorax.ivcCollapse);
      const tables = buildBeatTables(60 / c.rhythm.heartRateBpm, c.physiology, c.rhythm, c.hemodynamics);
      const pose = computeHeartPose(heart, cycleStateAt(tables, 0));
      const view = getViewTarget('a2c');
      const plane = canonicalPlane(view, heart);
      const preset = canonicalControl(view, heart, thorax);
      const apex = heartToTorso(heart.frame, v3(0, 0, heart.lv.lengthCm));
      const atApex = snapToIntercostal(thorax, apex.x, preset.v);
      const fromApex = hiddenWall(heart, thorax, controlAimingAt(thorax, atApex.u, atApex.v, plane.target, plane.right, 0.6), pose);
      const h = hiddenWall(heart, thorax, preset, pose);
      if (h > Math.max(0.2, fromApex + 0.1)) problems.push(`${input.id}: ${(100 * h).toFixed(0)}% of the wall behind lung (${(100 * fromApex).toFixed(0)}% from the apex)`);
    }
    expect(problems).toEqual([]);
  });
});
