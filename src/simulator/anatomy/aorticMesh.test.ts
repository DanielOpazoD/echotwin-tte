// @tier slow
import { expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { buildCaseModels, REST_PATIENT } from './caseModels';
import { computeHeartPose } from './heartModel';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { buildHeartMeshes } from './heartMesh';
import { torsoToHeart } from './heartFrame';
import { diaphragmY, DESC_AORTA_X, DESC_AORTA_Z } from './thoraxModel';

it('navigator includes the arch, all branch ends and descending aorta beyond the chamber crop', () => {
  const { heart, thorax, tables } = buildCaseModels(
    loadCaseById('normal-excellent-window'),
    REST_PATIENT,
  );
  const pose = computeHeartPose(heart, cycleStateAt(tables, 0));
  const mesh = buildHeartMeshes(heart, pose, { stepCm: 0.45, thorax }).find(
    (g) => g.id === 'thoracic-aorta',
  )!;
  expect(mesh.indices.length).toBeGreaterThan(0);
  const z = DESC_AORTA_Z + thorax.columnShiftCm;
  const targets = [
    pose.aorta.geometry.arch[32]!,
    ...pose.aorta.geometry.branches.map((b) => b.at(-1)!),
    {
      p: torsoToHeart(heart.frame, {
        x: DESC_AORTA_X,
        y: diaphragmY(thorax, DESC_AORTA_X, z) + 1,
        z,
      }),
      radiusCm: 1,
    },
  ];
  // A coarse surface must surround each independently selected anatomical landmark.
  // The allowance is one mesh cell in addition to the known lumen radius and wall.
  for (const { p, radiusCm } of targets) {
    let nearest = Infinity;
    for (let i = 0; i < mesh.positions.length; i += 3)
      nearest = Math.min(
        nearest,
        Math.hypot(
          mesh.positions[i]! - p.x,
          mesh.positions[i + 1]! - p.y,
          mesh.positions[i + 2]! - p.z,
        ),
      );
    expect(nearest).toBeLessThan(radiusCm + 0.2 + 0.45);
  }
});
