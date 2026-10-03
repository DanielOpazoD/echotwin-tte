import { loadCaseById } from '@/cases';
import { expectedFindings, scoreImpression } from '@/education/impression';
import { buildExamSummary, type ExamSummary, type ViewProgress } from '@/education/scoring/scoring';
import type { StructuredEchoTruth } from '@/simulator/hemodynamics/groundTruth';
import type { Measurement } from '@/simulator/measurements/types';
import { modePolicy, type ProductMode } from './modePolicy';

export interface ExamInputs {
  caseId: string;
  mode: ProductMode;
  truth: StructuredEchoTruth | null;
  viewProgress: ViewProgress;
  measurements: Measurement[];
  impressionSelection: string[];
  impressionChecked: boolean;
}

/**
 * Whether the impression has been corrected (decision 257): in practice when the learner pressed «Corregir», in the exam
 * when it was finished. Until then nothing says which findings are right — no colours, no score, no model impression —
 * and the sheet stays open; afterwards it is closed until «Rehacer».
 */
export function impressionCorrected(s: {
  mode: ProductMode;
  examFinished: boolean;
  impressionChecked: boolean;
}): boolean {
  return s.mode === 'exam' ? s.examFinished : s.impressionChecked;
}

/**
 * The impression score the curriculum sees: none until the impression is corrected, so that a task cannot complete
 * while the learner toggles findings until it does — that would tell which ones are right (decision 257).
 */
export function correctedImpressionScore(
  s: Pick<ExamInputs, 'truth' | 'impressionSelection' | 'mode' | 'impressionChecked'> & {
    examFinished: boolean;
  },
): number | null {
  if (!s.truth || !s.impressionSelection.length || !impressionCorrected(s)) return null;
  return scoreImpression(s.impressionSelection, expectedFindings(s.truth)).score;
}

/**
 * The exam summary of the learner's session, the one the report shows and the one `finishExam` records (decision 236).
 * Each computed its own: the report left the impression out when none was marked (acquisition and measurements 50/50)
 * and the record scored the empty impression as 0 (40/40/20), so the teacher's record read 48 where the learner saw 60.
 */
export function examSummaryOf(s: ExamInputs): ExamSummary | null {
  if (!s.truth) return null;
  // the exam scores the sheet it is finished with; practice only once the learner asked for the correction (decision 257)
  const impression =
    s.impressionSelection.length && (s.mode === 'exam' || s.impressionChecked)
      ? scoreImpression(s.impressionSelection, expectedFindings(s.truth)).score
      : null;
  return buildExamSummary(
    loadCaseById(s.caseId),
    s.truth,
    s.viewProgress,
    s.measurements,
    impression,
    { freeMeasurements: modePolicy(s.mode).freeMeasurementsScored },
  );
}
