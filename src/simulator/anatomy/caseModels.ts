import type { CaseDefinition } from '@/cases/schema';
import { createHeartModel, heartLandmarks, type HeartModel } from './heartModel';
import { createThoraxModel, type PatientState, type ThoraxModel } from './thoraxModel';
import {
  buildBeatTables,
  cycleStateAt,
  type BeatTables,
} from '@/simulator/cardiac-cycle/cycleModel';
import { fitDiaphragmMap } from './diaphragm';

/**
 * The models of a case for a patient state: thorax → heart (placed by the thorax, with the IVC collapse the
 * patient's breathing dictates) → beat tables at the case's heart rate, with the heart's landmarks cached → the
 * diaphragm fitted under the right heart (decision 229).
 *
 * This is the only place that chains the three constructors (it lives in `anatomy` so the core, the renderer's
 * clinical comparison, the app and the workers can all import it without a cycle). The 2026-09-16 engineering audit (B2) found the
 * chain copied in the simulator core, the main-thread cache behind the 3D navigator and the presets, the mesh
 * worker and the backend-comparison hook — and the main-thread copy already omitted the IVC collapse, so the
 * navigator cut a different vena cava from the one the beam imaged.
 */
/** The patient every case starts with and the offline tools render: left lateral, in expiration, lying flat. */
export const REST_PATIENT: PatientState = {
  position: 'left-lateral',
  respiration: 'expiration',
  headElevationDeg: 0,
};

export interface CaseModels {
  caseDef: CaseDefinition;
  thorax: ThoraxModel;
  heart: HeartModel;
  tables: BeatTables;
}

export function buildCaseModels(caseDef: CaseDefinition, patient: PatientState): CaseModels {
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
  // the diaphragm meets the right heart it carries (decision 229)
  thorax.diaphragmMap = fitDiaphragmMap(heart, cycleStateAt(tables, 0));
  return { caseDef, thorax, heart, tables };
}
