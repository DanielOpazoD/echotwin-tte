// @tier slow
import { describe, expect, it } from 'vitest';
import { CASE_INPUTS, loadCaseById } from '@/cases';
import { classifyHeart, computeHeartPose, createHeartModel, torsoToHeart } from './heartModel';
import { createThoraxModel, NOTCH_V_CM, skinZ } from './thoraxModel';
import { buildCaseModels } from './caseModels';
import { Tissue } from './tissue';
import { CT_MEDIASTINUM } from '@/clinical/reference-values/ctMediastinum';
import { buildBeatTables, cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { v3 } from '@/core/vec3';

/**
 * The heart lies behind the chest wall (decisions 65, 66 and 93). Over the anterior skin (x −2…11 cm, y −9…6 cm, every
 * 0.25 cm), heart tissue found at a depth below the skin smaller than the chest wall thickness is inside the wall; the
 * test reads the deepest such intrusion at end-diastole and at 60% of ejection. Decision 66 pushed the heart back by
 * the wall thickness minus 0.8 cm, which left the pericardium over the right ventricle 1.23 cm inside a 2.08 cm wall at
 * end-diastole in the normal case (0.72 cm of wall on the PLAX centre line), and every case still intruded: moving the
 * whole heart back further deepens the apex, which sat too far from the apical chest wall along the long axis (decision
 * 92). Decision 139 turned the long axis 9° forward about the apex tip and moved the heart 0.8 cm out along it, which
 * took 0.4 cm off the intrusion of every case (normal 1.23 → 0.83 cm, 1.35 cm of tissue on the PLAX centre line); the
 * tamponade keeps its 1.88 cm because its effusion fills the wall whatever the heart does. Since decision 220 the right
 * ventricular free wall moves inward by the case's systolic function, so the systolic intrusion changed where that is far
 * from the old uniform value (hypertrophic cardiomyopathy 0.98 → 0.88 cm, pulmonary hypertension 0.49 → 0.59). Declared
 * with baselines (cm); a change beyond the tolerance fails in either direction. Decision 292 restores the LV cavity
 * volume lost to septal flattening. Its larger radius also expands the adjacent RV envelope: PH intrusion grows by
 * 0.05/0.10 cm to 0.94/0.69 cm. This is an explicitly accepted placement debt, not a physical clearance or a widened
 * tolerance; solving it requires a thoracic/pericardial placement model that also preserves apical access.
 */
const KNOWN_INTRUSION_CM: Record<string, [number, number]> = {
  'normal-excellent-window': [0.83, 0.58],
  'normal-difficult-window': [0.11, 0.0],
  'hfref-severe-mr': [1.98, 1.73],
  'inferior-rwma': [1.13, 0.83],
  'aortic-stenosis-moderate': [0.45, 0.2],
  'aortic-stenosis-severe': [1.28, 0.83],
  'hocm-sam': [1.23, 0.78],
  'mvp-primary-mr': [0.98, 0.78],
  'pulmonary-hypertension-rv': [0.94, 0.69],
  'pericardial-effusion-tamponade': [1.88, 1.88],
  'af-diastolic': [0.55, 0.2],
  'artifact-challenge': [0.74, 0.54],
};
const TOLERANCE_CM = 0.1;

function deepestIntrusion(caseId: string, systole: boolean): number {
  const c = loadCaseById(caseId);
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
  const t = tables.timings;
  const phase = systole
    ? (t.ejectionStartS + 0.6 * (t.ejectionEndS - t.ejectionStartS)) / tables.rrS
    : 0;
  const pose = computeHeartPose(heart, cycleStateAt(tables, phase));
  const q = {
    tissue: 0,
    sdf: 0,
    nx: 0,
    ny: 0,
    nz: 1,
    mx: 0,
    my: 0,
    mz: 0,
    extraReflect: 0,
    structure: 0,
    transmural: -1,
    segment: 0,
  };
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

describe('the heart behind the chest wall', () => {
  it('every case declares its intrusion', () => {
    expect(CASE_INPUTS.map((c) => c.id).filter((id) => !(id in KNOWN_INTRUSION_CM))).toEqual([]);
  });
  for (const input of CASE_INPUTS) {
    it(`${input.id}: heart tissue inside the chest wall stays at its declared depth`, () => {
      const [ed, sys] = KNOWN_INTRUSION_CM[input.id]!;
      const measured = [deepestIntrusion(input.id, false), deepestIntrusion(input.id, true)];
      expect(
        measured.map((m, i) => Math.abs(m - [ed, sys][i]!) <= TOLERANCE_CM),
        `intrusion (cm) at end-diastole and systole: ${measured.map((m) => m.toFixed(2)).join(', ')} against ${ed}, ${sys}`,
      ).toEqual([true, true]);
    });
  }
});

/**
 * The heart's closest approach to the anterior skin against chest CT (decision 311). The CT (TotalSegmentator, n = 77) is
 * supine and at deep inspiration: over each 1 cm column of the heart, the depth of its most anterior voxel below the skin,
 * smallest over the columns, is 3.45 cm (P10–P90 2.04–4.98), 15.2 cm below the notch (11.4–18.5). The model is placed the
 * same way — supine, in inspiration — and its first myocardium is sought below the skin over the anterior chest. The
 * intrusion above is the left lateral decubitus, which brings the heart 1.3 cm forward of supine (thoraxModel; the
 * direction is published, the size is not); in the CT's posture the heart lies where the CT has it.
 *
 * Two cases differ by what the case is, not by the model: the difficult window's 4.76 cm of chest wall (the obese habitus)
 * pushes the heart deeper than nine in ten of the CT's subjects, and the dilated right ventricle of pulmonary hypertension
 * meets the sternum higher up.
 */
const CASE_DEPTH_DEVIATIONS: Record<string, string> = {
  'normal-difficult-window': 'obese habitus, 4.76 cm of chest wall',
};
/** Where the heart's closest approach lies higher than in nine in ten CT subjects, by what the case is. */
const CASE_HEIGHT_DEVIATIONS: Record<string, string> = {
  'pulmonary-hypertension-rv': 'the dilated right ventricle reaches the sternum higher up',
};

function heartMinDepth(caseId: string): { depth: number; belowNotch: number } {
  const { thorax, heart, tables } = buildCaseModels(loadCaseById(caseId), {
    position: 'supine',
    respiration: 'inspiration',
    headElevationDeg: 0,
  });
  const pose = computeHeartPose(heart, cycleStateAt(tables, 0));
  const q = {
    tissue: 0,
    sdf: 0,
    nx: 0,
    ny: 0,
    nz: 1,
    mx: 0,
    my: 0,
    mz: 0,
    extraReflect: 0,
    structure: 0,
    transmural: -1,
    segment: 0,
  };
  let depth = Infinity,
    atY = 0;
  for (let x = -3; x <= 9; x += 0.5)
    for (let y = -10; y <= 6; y += 0.5) {
      const zs = skinZ(thorax, x, y);
      for (let d = 0.1; d < Math.min(depth, 8); d += 0.05) {
        const h = torsoToHeart(heart.frame, v3(x, y, zs - d));
        if (classifyHeart(heart, pose, h.x, h.y, h.z, q) && q.tissue === Tissue.Myocardium) {
          depth = d;
          atY = y;
          break;
        }
      }
    }
  return { depth, belowNotch: NOTCH_V_CM - atY };
}

describe("the heart lies as deep as on chest CT in the CT's posture (decision 311)", () => {
  const depthCt = CT_MEDIASTINUM.heartMinDepth;
  const heightCt = CT_MEDIASTINUM.heartMinDepthBelowNotch;
  it('the declared deviations are cases', () => {
    const ids = CASE_INPUTS.map((c) => c.id);
    expect(
      [...Object.keys(CASE_DEPTH_DEVIATIONS), ...Object.keys(CASE_HEIGHT_DEVIATIONS)].filter(
        (id) => !ids.includes(id),
      ),
    ).toEqual([]);
  });
  for (const input of CASE_INPUTS) {
    it(`${input.id}: supine in inspiration, the first myocardium below the skin lies as deep and as high as on CT, or as its case declares`, () => {
      const m = heartMinDepth(input.id);
      const deep = `${m.depth.toFixed(2)} cm deep`;
      const at = `${m.belowNotch.toFixed(2)} cm below the notch`;
      // a declared deviation must still be one: once it falls within the CT's range, its entry is stale
      if (CASE_DEPTH_DEVIATIONS[input.id]) expect(m.depth, deep).toBeGreaterThan(depthCt.p90);
      else {
        expect(m.depth, deep).toBeGreaterThanOrEqual(depthCt.p10);
        expect(m.depth, deep).toBeLessThanOrEqual(depthCt.p90);
      }
      if (CASE_HEIGHT_DEVIATIONS[input.id]) expect(m.belowNotch, at).toBeLessThan(heightCt.p10);
      else {
        expect(m.belowNotch, at).toBeGreaterThanOrEqual(heightCt.p10);
        expect(m.belowNotch, at).toBeLessThanOrEqual(heightCt.p90);
      }
    });
  }
});
