import { loadCaseById } from '@/cases';
import type { PatientState } from '@/simulator/anatomy/thoraxModel';
import { computeHeartPose } from '@/simulator/anatomy/heartModel';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { buildCaseModels, type CaseModels } from '@/simulator/anatomy/caseModels';

export type { CaseModels } from '@/simulator/anatomy/caseModels';

/**
 * Main-thread copies of the case models (the worker has its own), built by the same `buildCaseModels` the
 * core uses. Used by the 3D torso, the preset views and the guided mode; memoised per (case, patient).
 */
const cache = new Map<string, CaseModels>();

export function getCaseModels(caseId: string, patient: PatientState): CaseModels {
  const key = `${caseId}|${JSON.stringify(patient)}`;
  let m = cache.get(key);
  if (m) return m;
  m = buildCaseModels(loadCaseById(caseId), patient);
  computeHeartPose(m.heart, cycleStateAt(m.tables, 0)); // initialises anchors
  cache.set(key, m);
  return m;
}
