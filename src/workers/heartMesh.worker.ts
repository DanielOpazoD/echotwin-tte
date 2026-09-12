import { loadCaseById } from '@/cases';
import { computeHeartPose, createHeartModel, heartLandmarks } from '@/simulator/anatomy/heartModel';
import { createThoraxModel } from '@/simulator/anatomy/thoraxModel';
import { buildBeatTables, cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { buildHeartMeshes, type MeshGroup } from '@/simulator/anatomy/heartMesh';
import type { PatientState } from '@/simulator/anatomy/thoraxModel';

/**
 * Builds the navigator's heart surfaces off the UI thread (decision 57). Extraction samples the implicit
 * model a few hundred thousand times, which freezes the interface for seconds if done inline; here the
 * navigator keeps its ghost until the meshes arrive, then swaps them in.
 */
export interface MeshRequest {
  caseId: string;
  patient: PatientState;
  stepCm: number;
  phase: number;
}
export interface MeshReply {
  caseId: string;
  groups: MeshGroup[];
  ms: number;
}

self.onmessage = (ev: MessageEvent<MeshRequest>) => {
  const { caseId, patient, stepCm, phase } = ev.data;
  const t0 = performance.now();
  const caseDef = loadCaseById(caseId);
  const thorax = createThoraxModel(caseDef.bodyHabitus, caseDef.acousticWindow, patient);
  const heart = createHeartModel(caseDef.anatomy, caseDef.physiology, thorax.heartOffset, caseDef.seed);
  heartLandmarks(heart);
  const tables = buildBeatTables(60 / caseDef.rhythm.heartRateBpm, caseDef.physiology, caseDef.rhythm, caseDef.hemodynamics);
  const pose = computeHeartPose(heart, cycleStateAt(tables, phase));
  const groups = buildHeartMeshes(heart, pose, { stepCm });
  const reply: MeshReply = { caseId, groups, ms: performance.now() - t0 };
  const transfer: Transferable[] = [];
  for (const g of groups) transfer.push(g.positions.buffer, g.normals.buffer, g.indices.buffer);
  (self as unknown as Worker).postMessage(reply, transfer);
};
