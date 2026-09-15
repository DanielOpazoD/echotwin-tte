import { describe, expect, it } from 'vitest';
import { CASE_INPUTS, loadCaseById } from '@/cases';
import { classifyHeart, computeHeartPose, createHeartModel, torsoToHeart } from './heartModel';
import { createThoraxModel, skinZ } from './thoraxModel';
import { buildBeatTables, cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import type { TissueSample } from './tissue';
import { v3 } from '@/core/vec3';

/**
 * The heart lies behind the chest wall (decisions 65, 66 and 93). Over the anterior skin (x −2…11 cm, y −9…6 cm, every
 * 0.25 cm), heart tissue found at a depth below the skin smaller than the chest wall thickness is inside the wall; the
 * test reads the deepest such intrusion at end-diastole and at 60% of ejection. Decision 66 pushed the heart back by
 * the wall thickness minus 0.8 cm, which left the pericardium over the right ventricle 1.23 cm inside a 2.08 cm wall at
 * end-diastole in the normal case (0.72 cm of wall on the PLAX centre line), and every case still intrudes: moving the
 * whole heart back further deepens the apex, which already sits too far from the apical chest wall along the long axis
 * (decision 92). Declared with baselines (cm); a change beyond the tolerance fails in either direction.
 */
const KNOWN_INTRUSION_CM: Record<string, [number, number]> = {
  'normal-excellent-window': [1.23, 0.78],
  'normal-difficult-window': [0.51, 0.16],
  'hfref-severe-mr': [2.38, 1.98],
  'inferior-rwma': [1.48, 1.13],
  'aortic-stenosis-moderate': [0.85, 0.45],
  'aortic-stenosis-severe': [1.68, 1.23],
  'hocm-sam': [1.78, 1.38],
  'mvp-primary-mr': [1.23, 0.88],
  'pulmonary-hypertension-rv': [1.49, 0.79],
  'pericardial-effusion-tamponade': [1.88, 1.88],
  'af-diastolic': [1.0, 0.4],
  'artifact-challenge': [1.19, 0.84],
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
  } as unknown as TissueSample;
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
    it(
      `${input.id}: heart tissue inside the chest wall stays at its declared depth`,
      { timeout: 120_000 },
      () => {
        const [ed, sys] = KNOWN_INTRUSION_CM[input.id]!;
        const measured = [deepestIntrusion(input.id, false), deepestIntrusion(input.id, true)];
        expect(
          measured.map((m, i) => Math.abs(m - [ed, sys][i]!) <= TOLERANCE_CM),
          `intrusion (cm) at end-diastole and systole: ${measured.map((m) => m.toFixed(2)).join(', ')} against ${ed}, ${sys}`,
        ).toEqual([true, true]);
      },
    );
  }
});
