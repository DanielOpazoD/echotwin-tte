import type { WallMotionId } from './catalog';

/**
 * Regional wall-motion scoring (decision 152). Clinical base (ASE/EACVI chamber quantification 2015, §3.2): each of the
 * 16 segments of the wall-motion model is scored 1 normal or hyperkinetic, 2 hypokinetic, 3 akinetic, 4 dyskinetic,
 * from its thickening and motion seen in several views; the apex cap (AHA 17) is not scored; the wall-motion score index
 * is the sum of the scores over the number of segments scored.
 *
 * Implementation choices of this project (the segmentation guide's contract, not clinical rules): an observation carries
 * its model, view, phase, the coverage states and its source; a segment seen in several views is one segment, scored once;
 * disagreeing observations are recorded as a discrepancy and never averaged; a segment that was not assessable has no
 * score (never 0 or 1); the index is null when nothing was scored; ground truth, a learner's answer and an algorithm's
 * estimate are never mixed. A score is not the simulation's regional amplitude and not a strain value: nothing here
 * converts one into another.
 */
export type WallMotionScore = 1 | 2 | 3 | 4;
export type ObservationSource = 'synthetic_ground_truth' | 'learner' | 'algorithm';

export const WALL_MOTION_SCORE_LABELS: Readonly<
  Record<WallMotionScore, { es: string; en: string }>
> = {
  1: { es: 'Normal o hipercinético', en: 'Normal or hyperkinetic' },
  2: { es: 'Hipocinético', en: 'Hypokinetic' },
  3: { es: 'Acinético', en: 'Akinetic' },
  4: { es: 'Discinético', en: 'Dyskinetic' },
};

export interface SegmentObservation {
  model: 'LV_16';
  segmentId: WallMotionId;
  viewId: string;
  /** Cycle phase of the observed frame (0 = end-diastole at the R wave, 0–1). */
  phase: number;
  inPlane: boolean;
  insonified: boolean;
  assessable: boolean;
  /** Why the segment was not assessable (`segmentCoverage` reasons), null when it was. */
  reason: string | null;
  wallMotionScore: WallMotionScore | null;
  source: ObservationSource;
  referenceIds: string[];
}

export interface SegmentAssessment {
  model: 'LV_16';
  segmentId: WallMotionId;
  source: ObservationSource;
  /** Consolidated score; null when no view could assess the segment or its views disagree under 'require-agreement'. */
  score: WallMotionScore | null;
  /** Views with an assessable, scored observation of the segment (each once). */
  views: string[];
  /** Distinct scores those observations gave, ascending: more than one is a discrepancy, kept for review. */
  scores: WallMotionScore[];
  discrepant: boolean;
}

/** How to consolidate disagreeing views: leave the segment unscored, or keep the most abnormal score (flagged). */
export type ConsolidationPolicy = 'require-agreement' | 'most-abnormal';

/** Violations of the observation contract (empty when valid). */
export function observationErrors(o: SegmentObservation): string[] {
  const e: string[] = [];
  if (o.model !== 'LV_16') e.push(`model ${String(o.model)}: wall motion is scored on LV_16`);
  if (!Number.isInteger(o.segmentId) || o.segmentId < 1 || o.segmentId > 16)
    e.push(`segment ${o.segmentId}: LV_16 ids are 1–16 (the apex cap is not scored)`);
  if (o.assessable && !(o.inPlane && o.insonified))
    e.push('assessable requires the segment in the plane and insonified');
  if (!o.assessable && o.wallMotionScore !== null)
    e.push('a segment that is not assessable has no score');
  if (o.assessable && o.reason !== null) e.push('an assessable segment has no reason');
  if (!o.assessable && o.reason === null) e.push('a segment that is not assessable needs a reason');
  if (o.wallMotionScore !== null && ![1, 2, 3, 4].includes(o.wallMotionScore))
    e.push(`score ${String(o.wallMotionScore)}: 1–4`);
  if (!(o.phase >= 0 && o.phase <= 1)) e.push(`phase ${o.phase}: 0–1`);
  return e;
}

/**
 * One assessment per segment of LV_16 (ids 1–16, in order) from the observations of one source. A segment observed in
 * several views stays one segment. Throws on an invalid observation or on observations from more than one source.
 */
export function consolidateWallMotion(
  observations: readonly SegmentObservation[],
  policy: ConsolidationPolicy = 'require-agreement',
): SegmentAssessment[] {
  const sources = new Set(observations.map((o) => o.source));
  if (sources.size > 1)
    throw new Error(
      `consolidateWallMotion: observations from ${[...sources].join(', ')}: consolidate each source apart`,
    );
  for (const o of observations) {
    const errors = observationErrors(o);
    if (errors.length)
      throw new Error(`consolidateWallMotion: ${o.viewId} ${o.segmentId}: ${errors.join('; ')}`);
  }
  const source = observations[0]?.source ?? 'synthetic_ground_truth';
  const out: SegmentAssessment[] = [];
  for (let id = 1; id <= 16; id++) {
    const scored = observations.filter(
      (o) => o.segmentId === id && o.assessable && o.wallMotionScore !== null,
    );
    const scores = [...new Set(scored.map((o) => o.wallMotionScore!))].sort((a, b) => a - b);
    const views = [...new Set(scored.map((o) => o.viewId))];
    const discrepant = scores.length > 1;
    const score: WallMotionScore | null =
      scores.length === 0
        ? null
        : !discrepant
          ? scores[0]!
          : policy === 'most-abnormal'
            ? scores[scores.length - 1]!
            : null;
    out.push({
      model: 'LV_16',
      segmentId: id as WallMotionId,
      source,
      score,
      views,
      scores,
      discrepant,
    });
  }
  return out;
}

export interface WmsiResult {
  /** Sum of the scores over the segments scored; null when none was. */
  value: number | null;
  /** Segments with a score (each segment once, whatever the number of views). */
  assessed: number;
  total: 16;
  /** Segments left without a score: not assessable in any view or discrepant under 'require-agreement'. */
  unscored: WallMotionId[];
}

/** Wall-motion score index of consolidated assessments (one per segment; duplicates are an error). */
export function computeWmsi(assessments: readonly SegmentAssessment[]): WmsiResult {
  const sources = new Set(assessments.map((a) => a.source));
  if (sources.size > 1)
    throw new Error(
      `computeWmsi: assessments from ${[...sources].join(', ')}: one source per index`,
    );
  const seen = new Set<number>();
  let sum = 0,
    n = 0;
  for (const a of assessments) {
    if (a.model !== 'LV_16' || a.segmentId < 1 || a.segmentId > 16)
      throw new Error(`computeWmsi: ${a.model}:${a.segmentId} is not an LV_16 segment`);
    if (seen.has(a.segmentId))
      throw new Error(`computeWmsi: segment ${a.segmentId} twice: consolidate the views first`);
    seen.add(a.segmentId);
    if (a.score === null) continue;
    sum += a.score;
    n++;
  }
  const unscored: WallMotionId[] = [];
  for (let id = 1; id <= 16; id++) {
    const a = assessments.find((x) => x.segmentId === id);
    if (!a || a.score === null) unscored.push(id as WallMotionId);
  }
  return { value: n ? sum / n : null, assessed: n, total: 16, unscored };
}
