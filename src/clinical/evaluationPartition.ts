/** Patient-level separation for external evaluation. Frames/views of one subject are never separate units.
 * The current CAMUS reference used all 500 subjects; re-splitting them now cannot create a held-out cohort.
 */
export interface EvaluationSubject {
  dataset: string;
  patientId: string;
}
export interface EvaluationPartition {
  calibration: EvaluationSubject[];
  development: EvaluationSubject[];
  evaluation: EvaluationSubject[];
}
export interface PartitionAudit {
  eligible: boolean;
  counts: Record<keyof EvaluationPartition, number>;
  issues: string[];
}
function key(s: EvaluationSubject): string {
  const dataset = s.dataset.trim().normalize('NFC').toLowerCase();
  let patient = s.patientId.trim().normalize('NFC');
  if (!dataset || !patient) throw new Error('Every subject needs a dataset and patient ID');
  if (dataset === 'camus') {
    const match = /^patient(\d+)$/i.exec(patient);
    if (!match)
      throw new Error('CAMUS requires its patient identifier, not a frame or view filename');
    patient = 'patient' + Number(match[1]);
  }
  return JSON.stringify([dataset, patient]);
}
export function auditEvaluationPartition(p: EvaluationPartition): PartitionAudit {
  const issues: string[] = [],
    seen = new Map<string, keyof EvaluationPartition>();
  const counts = { calibration: 0, development: 0, evaluation: 0 };
  for (const split of ['calibration', 'development', 'evaluation'] as const) {
    for (const subject of p[split]) {
      const id = key(subject),
        prior = seen.get(id);
      if (prior)
        issues.push(
          prior === split ? `Duplicate subject in ${split}` : `Patient overlap: ${prior}/${split}`,
        );
      else {
        seen.set(id, split);
        counts[split]++;
      }
      const [dataset, patient] = JSON.parse(id) as [string, string];
      const ordinal = Number(patient.slice('patient'.length));
      if (split === 'evaluation' && dataset === 'camus' && ordinal >= 1 && ordinal <= 500)
        issues.push('CAMUS subject already used by the historical calibration');
    }
  }
  if (counts.evaluation === 0) issues.push('No independent evaluation patients supplied');
  return { eligible: issues.length === 0, counts, issues: [...new Set(issues)] };
}
