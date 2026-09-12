import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { computeHeartPose, createHeartModel } from './heartModel';
import { createThoraxModel } from './thoraxModel';
import { buildBeatTables, cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { buildHeartMeshes, MESH_GROUPS } from './heartMesh';

/**
 * The 3D navigator reads the same implicit model the beam samples (decision 57), so these meshes must be
 * non-empty, deterministic and inside the requested bounds; otherwise the navigator would show an anatomy
 * the image does not have.
 */
describe('heart surface meshes', () => {
  const c = loadCaseById('normal-excellent-window');
  const thorax = createThoraxModel(c.bodyHabitus, c.acousticWindow, { position: 'left-lateral', respiration: 'expiration', headElevationDeg: 0 });
  const heart = createHeartModel(c.anatomy, c.physiology, thorax.heartOffset, c.seed);
  const tables = buildBeatTables(60 / c.rhythm.heartRateBpm, c.physiology, c.rhythm, c.hemodynamics);
  const pose = computeHeartPose(heart, cycleStateAt(tables, 0));
  const bounds = { min: [-8, -7, -7] as [number, number, number], max: [7, 8, 12] as [number, number, number] };
  const groups = buildHeartMeshes(heart, pose, { stepCm: 0.8, bounds });

  it('builds a surface for every navigator layer, inside the requested bounds', { timeout: 60_000 }, () => {
    expect(groups).toHaveLength(MESH_GROUPS.length);
    for (const g of groups) {
      expect(g.positions.length, `${g.id} has vertices`).toBeGreaterThan(0);
      expect(g.indices.length % 3, `${g.id} is triangulated`).toBe(0);
      for (let i = 0; i < g.positions.length; i += 3)
        for (let axis = 0; axis < 3; axis++) {
          const v = g.positions[i + axis] ?? 0;
          expect(v).toBeGreaterThanOrEqual(bounds.min[axis]! - 0.9);
          expect(v).toBeLessThanOrEqual(bounds.max[axis]! + 0.9);
        }
    }
    // the ventricular myocardium is the bulk of the model; the valves are thin sheets
    const byId = new Map(groups.map((g) => [g.id, g]));
    expect(byId.get('lv-myocardium')!.indices.length).toBeGreaterThan(byId.get('valves')!.indices.length);
  });

  it('is deterministic for the same heart and phase', { timeout: 60_000 }, () => {
    const again = buildHeartMeshes(heart, pose, { stepCm: 0.8, bounds });
    for (let i = 0; i < groups.length; i++) {
      expect(again[i]!.positions.length).toBe(groups[i]!.positions.length);
      expect(again[i]!.indices.length).toBe(groups[i]!.indices.length);
      expect(Array.from(again[i]!.positions.slice(0, 60))).toEqual(Array.from(groups[i]!.positions.slice(0, 60)));
    }
  });
});
