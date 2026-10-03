import { useSimStore } from '@/app/store';
import { showsCaseIdentity, type ProductMode } from '@/app/modePolicy';
import { CASE_INPUTS } from '@/cases';

/** Every history ends with the same notice; the splash already says the patients are synthetic. */
const SYNTHETIC_NOTICE = /\s*Sin datos reales de paciente\.?\s*$/;

/**
 * What the card says about the case: the clinical history, which a real request carries and the exam keeps, and the
 * learning objectives, which name what the case is about («medir el gradiente aórtico») and so wait for the end of an
 * exam like the case's title (decision 234).
 */
export function caseBrief(
  caseId: string,
  mode: ProductMode,
  examFinished: boolean,
): { history: string; objectives: string[] } {
  const c = CASE_INPUTS.find((x) => x.id === caseId);
  return {
    history: (c?.history ?? '').replace(SYNTHETIC_NOTICE, ''),
    objectives: c && showsCaseIdentity(mode, examFinished) ? c.learningObjectives : [],
  };
}

/** The case card under the case selector: the history in one short paragraph, the objectives folded. */
export function CaseCard() {
  const caseId = useSimStore((s) => s.caseId);
  const mode = useSimStore((s) => s.mode);
  const examFinished = useSimStore((s) => s.examFinished);
  const { history, objectives } = caseBrief(caseId, mode, examFinished);
  if (!history && !objectives.length) return null;
  return (
    <div className="case-card" data-case-card>
      {history && <p className="small case-history">{history}</p>}
      {objectives.length > 0 && (
        <details className="adv">
          <summary>Objetivos</summary>
          <ul className="small case-objectives">
            {objectives.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
