import { normalExcellentCase } from './normal-excellent';
import { normalDifficultWindowCase } from './normal-difficult-window';
import { aorticStenosisSevereCase } from './aortic-stenosis-severe';
import { validateCase, type CaseDefinition, type CaseDefinitionInput } from './schema';

export const CASE_INPUTS: CaseDefinitionInput[] = [normalExcellentCase, normalDifficultWindowCase, aorticStenosisSevereCase];

export function listCases(): { id: string; title: string; difficulty: number }[] {
  return CASE_INPUTS.map((c) => ({ id: c.id, title: c.title, difficulty: c.difficulty }));
}

export function loadCaseById(id: string): CaseDefinition {
  const input = CASE_INPUTS.find((c) => c.id === id) ?? normalExcellentCase;
  const res = validateCase(input);
  if (!res.ok || !res.case) throw new Error(`Case ${id} invalid: ${res.errors.join('; ')}`);
  return res.case;
}
