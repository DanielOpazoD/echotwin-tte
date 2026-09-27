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
}

/**
 * The exam summary of the learner's session, the one the report shows and the one `finishExam` records (decision 236).
 * Each computed its own: the report left the impression out when none was marked (acquisition and measurements 50/50)
 * and the record scored the empty impression as 0 (40/40/20), so the teacher's record read 48 where the learner saw 60.
 */
export function examSummaryOf(s: ExamInputs): ExamSummary | null {
  if (!s.truth) return null;
  const impression = s.impressionSelection.length
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
