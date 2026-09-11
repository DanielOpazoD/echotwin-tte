import { normalExcellentCase } from './normal-excellent';
import { normalDifficultWindowCase } from './normal-difficult-window';
import { aorticStenosisSevereCase } from './aortic-stenosis-severe';
import { hfrefSevereMrCase } from './hfref-severe-mr';
import { inferiorRwmaCase } from './inferior-rwma';
import { aorticStenosisModerateCase } from './aortic-stenosis-moderate';
import { hocmSamCase } from './hocm-sam';
import { mvpPrimaryMrCase } from './mvp-primary-mr';
import { pulmonaryHypertensionRvCase } from './pulmonary-hypertension-rv';
import { pericardialEffusionTamponadeCase } from './pericardial-effusion-tamponade';
import { afDiastolicCase } from './af-diastolic';
import { artifactChallengeCase } from './artifact-challenge';
import { validateCase, type CaseDefinition, type CaseDefinitionInput } from './schema';

/** The 12 mandatory initial cases (spec 56), in the order of the specification. */
export const CASE_INPUTS: CaseDefinitionInput[] = [
  normalExcellentCase,
  normalDifficultWindowCase,
  hfrefSevereMrCase,
  inferiorRwmaCase,
  aorticStenosisModerateCase,
  aorticStenosisSevereCase,
  hocmSamCase,
  mvpPrimaryMrCase,
  pulmonaryHypertensionRvCase,
  pericardialEffusionTamponadeCase,
  afDiastolicCase,
  artifactChallengeCase,
];

export function listCases(): { id: string; title: string; difficulty: number }[] {
  return CASE_INPUTS.map((c) => ({ id: c.id, title: c.title, difficulty: c.difficulty }));
}

export function loadCaseById(id: string): CaseDefinition {
  const input = CASE_INPUTS.find((c) => c.id === id) ?? normalExcellentCase;
  const res = validateCase(input);
  if (!res.ok || !res.case) throw new Error(`Case ${id} invalid: ${res.errors.join('; ')}`);
  return res.case;
}
