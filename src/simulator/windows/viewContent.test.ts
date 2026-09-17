// @tier slow
import { describe, expect, it } from 'vitest';
import { CASE_INPUTS, loadCaseById } from '@/cases';
import {
  classifyHeart,
  computeHeartPose,
  createHeartModel,
  heartLandmarks,
  heartToTorso,
  torsoToHeart,
  type HeartModel,
  type HeartPose,
} from '@/simulator/anatomy/heartModel';
import {
  createThoraxModel,
  isAnteriorLung,
  snapToIntercostal,
  type PatientState,
  type ThoraxModel,
} from '@/simulator/anatomy/thoraxModel';
import { buildBeatTables, cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { makeSample, Structure } from '@/simulator/anatomy/tissue';
import { canonicalControl, canonicalPlane, getViewTarget, VIEW_TARGETS } from './viewTargets';
import {
  beamFrameFromPose,
  controlAimingAt,
  poseFromControl,
  type ProbeControl,
} from '@/simulator/probe/pose';
import { add, scale, v3 } from '@/core/vec3';
import {
  fractionOfAny,
  LV_MYOCARDIUM,
  MITRAL_LEAFLETS,
  RIGHT_OUTFLOW,
  viewStructureFractions,
} from './viewContent';

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

const need = (
  label: string,
  group: readonly Structure[] | Structure,
  minPercent: number,
): Requirement => ({
  label,
  group: Array.isArray(group) ? group : [group as Structure],
  minPercent,
});
const never = (
  label: string,
  group: readonly Structure[] | Structure,
  maxPercent = 0.05,
): Forbidden => ({ label, group: Array.isArray(group) ? group : [group as Structure], maxPercent });

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
    forbids: [
      never('inferior vena cava', Structure.Ivc),
      never('hepatic vein', Structure.HepaticVein),
    ],
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
    needs: [
      need('LV cavity', Structure.LvCavity, 3),
      need('LV myocardium', LV_MYOCARDIUM, 2),
      need('mitral leaflets', MITRAL_LEAFLETS, 0.2),
      need('right ventricle', Structure.RvCavity, 1),
    ],
    forbids: [
      never('inferior vena cava', Structure.Ivc),
      never('hepatic vein', Structure.HepaticVein),
    ],
  },
  'psax-pm': {
    needs: [
      need('LV cavity', Structure.LvCavity, 3),
      need('LV myocardium', LV_MYOCARDIUM, 2),
      need('papillary muscles', Structure.PapillaryMuscle, 0.1),
      need('right ventricle', Structure.RvCavity, 1),
    ],
    forbids: [
      never('inferior vena cava', Structure.Ivc),
      never('aortic root', Structure.AorticRoot),
    ],
  },
  'psax-apex': {
    needs: [need('LV cavity', Structure.LvCavity, 2), need('LV myocardium', LV_MYOCARDIUM, 2)],
    forbids: [never('left atrium', Structure.LaCavity), never('aortic root', Structure.AorticRoot)],
  },
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
    needs: [
      need('LV cavity', Structure.LvCavity, 3),
      need('right ventricle', Structure.RvCavity, 1),
      need('right atrium', Structure.RaCavity, 1),
      need('left atrium', Structure.LaCavity, 1),
      need(
        'outflow tract or aortic valve',
        [Structure.Lvot, Structure.AorticValve, Structure.AorticRoot],
        0.3,
      ),
    ],
  },
  a2c: {
    needs: [
      need('LV cavity', Structure.LvCavity, 3),
      need('left atrium', Structure.LaCavity, 2),
      need('LV myocardium', LV_MYOCARDIUM, 2),
      need('mitral leaflets', MITRAL_LEAFLETS, 0.1),
    ],
    forbids: [
      never('pulmonary artery', Structure.PulmonaryArtery),
      never('inferior vena cava', Structure.Ivc),
    ],
  },
  a3c: {
    needs: [
      need('LV cavity', Structure.LvCavity, 3),
      need('left atrium', Structure.LaCavity, 2),
      need('aortic root', Structure.AorticRoot, 1),
      need('mitral leaflets', MITRAL_LEAFLETS, 0.1),
    ],
  },
  'subcostal-4c': {
    needs: [
      need('LV cavity', Structure.LvCavity, 2),
      need('right ventricle', Structure.RvCavity, 0.5),
      need('left atrium', Structure.LaCavity, 0.5),
      need('right atrium', Structure.RaCavity, 0.5),
      need('interatrial septum', Structure.InteratrialSeptum, 0.1),
    ],
  },
  'subcostal-ivc': {
    needs: [
      need('inferior vena cava', Structure.Ivc, 1),
      need('right atrium', Structure.RaCavity, 0.5),
      // the vein joining the cava is how the junction is found and where the calibre is measured; until decision 131
      // it ran posterior and to the right, out of this plane, and no case showed it
      need('hepatic vein', Structure.HepaticVein, 0.3),
    ],
  },
  'rv-focused': {
    needs: [
      need('right ventricle', Structure.RvCavity, 2),
      need('RV free wall', Structure.RvWall, 0.5),
      need('right atrium', Structure.RaCavity, 1),
      need('tricuspid valve', Structure.TricuspidValve, 0.05),
    ],
  },
};

/**
 * View/structure pairs the geometry cannot satisfy yet. Each must be named in docs/LIMITATIONS.md and
 * removed once fixed — the same contract as KNOWN_MODEL_LIMITATIONS in proportions.test.ts.
 */
const KNOWN_VIEW_LIMITATIONS: ReadonlySet<string> = new Set([
  // The mitral short axis cuts the inferior vena cava, which cannot be in that plane; the parasternal window
  // solver puts the beam 24.3° away from the requested short axis (decision 59). The hepatic vein left this
  // plane when it took its real course, in front of the cava (decision 131).
  'psax-mv/inferior vena cava',
  // The section perpendicular to the aortic root at its coaptation (decision 133) passes 1.3-1.5 cm on the atrial side
  // of the tricuspid annulus in every case, so the leaflets never enter it. Neither lever tried in decision 138 settles
  // it: tilting the annulus (anterior side basal) by 8 mm shows the valve at end-diastole in one case of three, and
  // tilting the plane toward the tricuspid inflow shows it in all twelve from 8-10° but moves the preset between two
  // intercostal spaces, drops the cut below the coaptation at end-diastole or loses the pulmonary valve. What has to
  // change is where the tricuspid annulus sits relative to the root (the declared 'av-tv-distance' of the proportions).
  'psax-av/tricuspid valve',
  // The two-chamber plane clips the pulmonary trunk beside the left atrial appendage, 12-14 cm deep at the anterior edge
  // of the sector. The lung hid it until the A2C preset stopped sliding under the lingula (decisions 72 and 83).
  'a2c/pulmonary artery',
]);

describe('standard views contain the structures they are meant to show', () => {
  const patient: PatientState = {
    position: 'left-lateral',
    respiration: 'expiration',
    headElevationDeg: 0,
  };
  const c = loadCaseById('normal-excellent-window');
  const thorax = createThoraxModel(c.bodyHabitus, c.acousticWindow, patient);
  const heart = createHeartModel(c.anatomy, c.physiology, thorax.heartOffset, c.seed);
  heartLandmarks(heart);
  const tables = buildBeatTables(
    60 / c.rhythm.heartRateBpm,
    c.physiology,
    c.rhythm,
    c.hemodynamics,
  );

  for (const view of VIEW_TARGETS) {
    const spec = EXPECTED[view.id];
    if (!spec) continue;
    it(`${view.id}: shows its structures and nothing impossible`, { timeout: 60_000 }, () => {
      // diastole and mid-systole: a structure may only be visible in one of them (a closed valve, a small
      // systolic cavity), so each requirement is satisfied if it holds in either phase
      const frames = [0, 0.3].map((phase) =>
        viewStructureFractions(
          view,
          heart,
          thorax,
          computeHeartPose(heart, cycleStateAt(tables, phase)),
        ),
      );
      const missing = spec.needs
        .filter((r) => !KNOWN_VIEW_LIMITATIONS.has(`${view.id}/${r.label}`))
        .filter((r) => !frames.some((f) => 100 * fractionOfAny(f, r.group) >= r.minPercent))
        .map(
          (r) =>
            `${r.label} ${(100 * Math.max(...frames.map((f) => fractionOfAny(f, r.group)))).toFixed(2)}% < ${r.minPercent}%`,
        );
      expect(missing, `${view.id}: structures the view should show`).toEqual([]);
      const impossible = (spec.forbids ?? [])
        .filter((r) => !KNOWN_VIEW_LIMITATIONS.has(`${view.id}/${r.label}`))
        .filter((r) => frames.some((f) => 100 * fractionOfAny(f, r.group) > r.maxPercent))
        .map(
          (r) =>
            `${r.label} ${(100 * Math.max(...frames.map((f) => fractionOfAny(f, r.group)))).toFixed(2)}% > ${r.maxPercent}%`,
        );
      expect(impossible, `${view.id}: structures that cannot be in this plane`).toEqual([]);
      // a declared limitation that no longer fails is stale and hides a requirement that now holds: the
      // 'a5c/left atrium' entry was exactly that, written from a single-phase listing (decision 63)
      const stale = [
        ...spec.needs.map((r) => ({
          label: r.label,
          ok: frames.some((f) => 100 * fractionOfAny(f, r.group) >= r.minPercent),
        })),
        ...(spec.forbids ?? []).map((r) => ({
          label: r.label,
          ok: !frames.some((f) => 100 * fractionOfAny(f, r.group) > r.maxPercent),
        })),
      ]
        .filter((r) => r.ok && KNOWN_VIEW_LIMITATIONS.has(`${view.id}/${r.label}`))
        .map((r) => `${view.id}/${r.label}`);
      expect(stale, `${view.id}: declared limitations that no longer apply`).toEqual([]);
    });
  }
});

describe('apical presets keep the ventricle clear of lung where the window allows (decision 83)', () => {
  const LV_WALL: ReadonlySet<Structure> = new Set(LV_MYOCARDIUM);
  /** Share of the LV wall in the drawn sector at end diastole with lung between it and the probe. */
  const hiddenWall = (
    heart: HeartModel,
    thorax: ThoraxModel,
    control: ProbeControl,
    pose: HeartPose,
  ): number => {
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
  it(
    'the A2C preset leaves at most a fifth of the LV wall behind lung, or little more than the apex position itself',
    { timeout: 120_000 },
    () => {
      // sliding the full 2 cm toward the two-chamber plane hid 23-50% of the wall, 38% in the normal case
      const problems: string[] = [];
      for (const input of CASE_INPUTS) {
        const c = loadCaseById(input.id);
        // the difficult windows put lung over the cardiac notch on purpose
        if (c.acousticWindow.lungOverlapCm > 0.5) continue;
        const thorax = createThoraxModel(
          c.bodyHabitus,
          c.acousticWindow,
          { position: 'left-lateral', respiration: 'expiration', headElevationDeg: 0 },
          c.anatomy.ivc.collapsePct,
        );
        const heart = createHeartModel(
          c.anatomy,
          c.physiology,
          thorax.heartOffset,
          c.seed,
          thorax.ivcCollapse,
        );
        const tables = buildBeatTables(
          60 / c.rhythm.heartRateBpm,
          c.physiology,
          c.rhythm,
          c.hemodynamics,
        );
        const pose = computeHeartPose(heart, cycleStateAt(tables, 0));
        const view = getViewTarget('a2c');
        const plane = canonicalPlane(view, heart);
        const preset = canonicalControl(view, heart, thorax);
        const apex = heartToTorso(heart.frame, v3(0, 0, heart.lv.lengthCm));
        const atApex = snapToIntercostal(thorax, apex.x, preset.v);
        const fromApex = hiddenWall(
          heart,
          thorax,
          controlAimingAt(thorax, atApex.u, atApex.v, plane.target, plane.right, 0.6),
          pose,
        );
        const h = hiddenWall(heart, thorax, preset, pose);
        if (h > Math.max(0.2, fromApex + 0.1))
          problems.push(
            `${input.id}: ${(100 * h).toFixed(0)}% of the wall behind lung (${(100 * fromApex).toFixed(0)}% from the apex)`,
          );
      }
      expect(problems).toEqual([]);
    },
  );
});

describe('apical five-chamber view (decision 85)', () => {
  it(
    'puts the aortic valve against the septum, between both atria, not under the middle of the ventricle',
    { timeout: 180_000 },
    () => {
      // The plane was rotated 19° toward the anterior wall and grazed the back of the root: the valve showed 1.3-2.1 cm from
      // the septum and 0.6 cm from the middle of the basal cavity, where the mitral valve belongs. Positions are read along
      // the heart's septal–lateral axis in the drawn plane, not across the image: the image coordinate depends on where the
      // probe looks from, and the same anatomical cut seen from a probe on the long axis failed a comparison made across the
      // image in two cases. Along that axis the root lies 0.81-1.04 cm from the basal cavity centre from either probe, and
      // the removed plane put it 0.06-0.26 cm from it with no left atrium in eight cases.
      const problems: string[] = [];
      for (const input of CASE_INPUTS) {
        const c = loadCaseById(input.id);
        const thorax = createThoraxModel(
          c.bodyHabitus,
          c.acousticWindow,
          { position: 'left-lateral', respiration: 'expiration', headElevationDeg: 0 },
          c.anatomy.ivc.collapsePct,
        );
        const heart = createHeartModel(
          c.anatomy,
          c.physiology,
          thorax.heartOffset,
          c.seed,
          thorax.ivcCollapse,
        );
        const tables = buildBeatTables(
          60 / c.rhythm.heartRateBpm,
          c.physiology,
          c.rhythm,
          c.hemodynamics,
        );
        const beam = beamFrameFromPose(
          poseFromControl(thorax, canonicalControl(getViewTarget('a5c'), heart, thorax)),
          1,
        );
        const pose = computeHeartPose(heart, cycleStateAt(tables, 0.25));
        const s = makeSample();
        const mean = { root: [0, 0], septum: [0, 0], cavity: [0, 0], valve: 0, ra: 0, la: 0 };
        for (let dep = 0.2; dep < 17; dep += 0.1)
          for (let lat = -8; lat < 8; lat += 0.1) {
            const p = torsoToHeart(
              heart.frame,
              add(beam.origin, add(scale(beam.forward, dep), scale(beam.lateral, lat))),
            );
            if (!classifyHeart(heart, pose, p.x, p.y, p.z, s)) continue;
            const acc = (k: 'root' | 'septum' | 'cavity') => {
              mean[k][0]! += p.x;
              mean[k][1]! += 1;
            };
            if (s.structure === Structure.AorticRoot || s.structure === Structure.AorticValve)
              acc('root');
            if (s.structure === Structure.AorticValve) mean.valve++;
            // the basal septum and basal cavity, from the annulus to 2-3 cm into the ventricle
            if (s.structure === Structure.LvWallSeptal && p.z > 0 && p.z < 2) acc('septum');
            if (s.structure === Structure.LvCavity && p.z > 1 && p.z < 3) acc('cavity');
            if (s.structure === Structure.RaCavity) mean.ra++;
            if (s.structure === Structure.LaCavity) mean.la++;
          }
        const at = (k: 'root' | 'septum' | 'cavity') => mean[k][0]! / Math.max(1, mean[k][1]!);
        const toCavity = Math.abs(at('cavity') - at('root'));
        // on the septal side of the basal cavity centre, and not at it
        const septalSide = (at('root') - at('septum')) * (at('cavity') - at('root')) > 0;
        if (!(mean.valve > 0 && mean.ra > 50 && mean.la > 50 && septalSide && toCavity >= 0.6))
          problems.push(
            `${input.id}: valve samples ${mean.valve}, RA ${mean.ra}, LA ${mean.la}; root ${septalSide ? 'on the septal side' : 'NOT between septum and cavity centre'}, ${toCavity.toFixed(2)} cm from the basal cavity centre along the septal–lateral axis`,
          );
      }
      expect(problems).toEqual([]);
    },
  );
});
