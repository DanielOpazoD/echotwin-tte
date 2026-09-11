import { loadCaseById } from '@/cases';
import type { CaseDefinition } from '@/cases/schema';
import { createHeartModel, heartLandmarks, type HeartModel } from '@/simulator/anatomy/heartModel';
import { createThoraxModel, type PatientState, type ThoraxModel } from '@/simulator/anatomy/thoraxModel';
import { buildBeatTables, cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { computeHeartPose } from '@/simulator/anatomy/heartModel';

/**
 * Main-thread copies of the case models (the worker has its own). Used by the 3D torso, the preset
 * views and the guided mode; memoised per (case, patient). Cheap to build (no rendering).
 */
export interface CaseModels {
  caseDef: CaseDefinition;
  thorax: ThoraxModel;
  heart: HeartModel;
}

const cache = new Map<string, CaseModels>();

export function getCaseModels(caseId: string, patient: PatientState): CaseModels {
  const key = `${caseId}|${JSON.stringify(patient)}`;
  let m = cache.get(key);
  if (m) return m;
  const caseDef = loadCaseById(caseId);
  const thorax = createThoraxModel(caseDef.bodyHabitus, caseDef.acousticWindow, patient);
  const heart = createHeartModel(caseDef.anatomy, caseDef.physiology, thorax.heartOffset, caseDef.seed);
  heartLandmarks(heart);
  const tables = buildBeatTables(60 / caseDef.rhythm.heartRateBpm, caseDef.physiology, caseDef.rhythm, caseDef.hemodynamics);
  computeHeartPose(heart, cycleStateAt(tables, 0)); // initialises anchors
  m = { caseDef, thorax, heart };
  cache.set(key, m);
  return m;
}
