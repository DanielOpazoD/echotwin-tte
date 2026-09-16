import { loadCaseById } from '@/cases';
import { computeHeartPose, createHeartModel, heartLandmarks } from '@/simulator/anatomy/heartModel';
import { createThoraxModel } from '@/simulator/anatomy/thoraxModel';
import { buildBeatTables, cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { buildHeartMeshes, type MeshGroup } from '@/simulator/anatomy/heartMesh';
import type { PatientState } from '@/simulator/anatomy/thoraxModel';

/**
 * Builds the navigator's heart surfaces off the UI thread (decision 57). Extraction samples the implicit
 * model a few hundred thousand times, which freezes the interface for seconds if done inline.
 *
 * One mesh per cardiac phase, emitted as each one is ready (decision 68): the navigator shows the first
 * phase immediately and starts beating once enough of them have arrived, instead of waiting for the whole
 * set. A 3D heart standing still next to a beating image is the first thing that gives the model away.
 */
export interface MeshRequest {
  caseId: string;
  patient: PatientState;
  stepCm: number;
  /** Cycle phases to extract, in [0,1). The first one is rendered as soon as it arrives. */
  phases: number[];
}
/** The worker could not build the surfaces: the navigator keeps its ghost and says why. */
export interface MeshError {
  caseId: string;
  error: string;
}

export interface MeshReply {
  caseId: string;
  /** Index into the requested phases, and how many were asked for. */
  index: number;
  total: number;
  phase: number;
  groups: MeshGroup[];
  ms: number;
}

self.onmessage = (ev: MessageEvent<MeshRequest>) => {
  const { caseId, patient, stepCm, phases } = ev.data;
  try {
    buildAllPhases(caseId, patient, stepCm, phases);
  } catch (e) {
    const reply: MeshError = {
      caseId,
      error: e instanceof Error ? (e.stack ?? e.message) : String(e),
    };
    (self as unknown as Worker).postMessage(reply);
  }
};

function buildAllPhases(
  caseId: string,
  patient: PatientState,
  stepCm: number,
  phases: number[],
): void {
  const caseDef = loadCaseById(caseId);
  const thorax = createThoraxModel(
    caseDef.bodyHabitus,
    caseDef.acousticWindow,
    patient,
    caseDef.anatomy.ivc.collapsePct,
  );
  const heart = createHeartModel(
    caseDef.anatomy,
    caseDef.physiology,
    thorax.heartOffset,
    caseDef.seed,
    thorax.ivcCollapse,
  );
  heartLandmarks(heart);
  const tables = buildBeatTables(
    60 / caseDef.rhythm.heartRateBpm,
    caseDef.physiology,
    caseDef.rhythm,
    caseDef.hemodynamics,
  );
  for (let i = 0; i < phases.length; i++) {
    const phase = phases[i]!;
    const t0 = performance.now();
    const pose = computeHeartPose(heart, cycleStateAt(tables, phase));
    const groups = buildHeartMeshes(heart, pose, { stepCm });
    const reply: MeshReply = {
      caseId,
      index: i,
      total: phases.length,
      phase,
      groups,
      ms: performance.now() - t0,
    };
    const transfer: Transferable[] = [];
    for (const g of groups) transfer.push(g.positions.buffer, g.normals.buffer, g.indices.buffer);
    (self as unknown as Worker).postMessage(reply, transfer);
  }
}
