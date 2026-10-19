/**
 * The verdict of the realism bench on a change: each gap of a run against the same gap in a frozen baseline (an earlier
 * run, or another engine), on the bench's common scale (`tools/offline/realism/report.ts`: 1 = the tolerance the
 * simulator has been calibrated to). A gap whose score falls by at least `tolerance` improves, one that rises by as
 * much worsens; the change brings the simulator closer to the clinical image only when some gap improves and none
 * worsens. Gaps are matched by a stable id, so a metric renamed in the report still compares.
 */

export interface GapScore {
  id: string;
  metric: string;
  sim: number;
  ref: number;
  score: number;
  /** Why the gap's instrument is not validated (the report keeps it out of its ranking): it stays out of the verdict too. */
  caveat?: string;
}

export interface Baseline {
  /** Engine and commit the baseline was measured on, and when. */
  engine: string;
  commit: string;
  generatedAt: string;
  gaps: GapScore[];
}

/**
 * `sin validar`: the run marks the gap's instrument as not validated (decision 348), so what it reads does not count.
 * `referencia distinta`: the reference itself changed (a clinical distribution read over fewer patients, a reference
 * model with other parameters), so the scores do not compare and the gap is left out of the verdict.
 */
export type GapVerdict =
  'mejora' | 'empeora' | 'igual' | 'nueva' | 'sin medir' | 'referencia distinta' | 'sin validar';

export interface GapComparison {
  id: string;
  metric: string;
  before: number | null;
  after: number | null;
  scoreBefore: number | null;
  scoreAfter: number | null;
  verdict: GapVerdict;
}

export type OverallVerdict = 'acerca' | 'aleja' | 'mixto' | 'igual';

export interface Comparison {
  rows: GapComparison[];
  improved: number;
  worsened: number;
  unchanged: number;
  verdict: OverallVerdict;
}

/** Default tolerance on the common scale: a tenth of the calibration tolerance. */
export const VERDICT_TOLERANCE = 0.1;

/** Whether two references are the same number, to the precision a JSON round trip keeps. */
function sameReference(x: number, y: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return Object.is(x, y);
  return Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x), Math.abs(y));
}

/** Compares the gaps of a run with a baseline's, worst change first. */
export function compareGaps(
  baseline: readonly GapScore[],
  current: readonly GapScore[],
  tolerance = VERDICT_TOLERANCE,
): Comparison {
  const before = new Map(baseline.map((g) => [g.id, g]));
  const after = new Map(current.map((g) => [g.id, g]));
  const ids = [...new Set([...before.keys(), ...after.keys()])];
  const rows: GapComparison[] = ids.map((id) => {
    const b = before.get(id),
      a = after.get(id);
    const sb = b && Number.isFinite(b.score) ? b.score : null,
      sa = a && Number.isFinite(a.score) ? a.score : null;
    let verdict: GapVerdict;
    if (sa === null) verdict = 'sin medir';
    else if (a!.caveat) verdict = 'sin validar';
    else if (sb === null) verdict = 'nueva';
    else if (!sameReference(b!.ref, a!.ref)) verdict = 'referencia distinta';
    else if (sa <= sb - tolerance) verdict = 'mejora';
    else if (sa >= sb + tolerance) verdict = 'empeora';
    else verdict = 'igual';
    return {
      id,
      metric: (a ?? b)!.metric,
      before: b ? b.sim : null,
      after: a ? a.sim : null,
      scoreBefore: sb,
      scoreAfter: sa,
      verdict,
    };
  });
  const change = (r: GapComparison): number =>
    r.verdict === 'mejora' || r.verdict === 'empeora' || r.verdict === 'igual'
      ? r.scoreAfter! - r.scoreBefore!
      : 0;
  rows.sort((x, y) => change(y) - change(x) || x.id.localeCompare(y.id));
  const improved = rows.filter((r) => r.verdict === 'mejora').length;
  const worsened = rows.filter((r) => r.verdict === 'empeora').length;
  const unchanged = rows.filter((r) => r.verdict === 'igual').length;
  const verdict: OverallVerdict =
    worsened && improved ? 'mixto' : worsened ? 'aleja' : improved ? 'acerca' : 'igual';
  return { rows, improved, worsened, unchanged, verdict };
}

/** Keeps only what a baseline needs from a run's gaps (no paths, no per-image data). */
export function toBaseline(
  engine: string,
  commit: string,
  generatedAt: string,
  gaps: readonly GapScore[],
): Baseline {
  return {
    engine,
    commit,
    generatedAt,
    gaps: gaps.map(({ id, metric, sim, ref, score }) => ({ id, metric, sim, ref, score })),
  };
}
