/** Machine-readable observations keep an actual value, criterion and provenance together. */
export interface EvidenceObservation {
  id: string;
  value: number;
  unit: string;
  criterion: { min?: number; max?: number };
  reference: string;
  limitation?: { id: string; reason: string };
}
export type EvidenceStatus = 'pass' | 'fail' | 'known-limitation' | 'resolved-limitation';
export function assessEvidence(o: EvidenceObservation): EvidenceStatus {
  if (
    !o.id ||
    !o.unit ||
    !o.reference ||
    (o.criterion.min === undefined && o.criterion.max === undefined)
  )
    throw new Error('Evidence requires identity, units, reference and a bounded criterion');
  const { min, max } = o.criterion;
  if (
    (min !== undefined && !Number.isFinite(min)) ||
    (max !== undefined && !Number.isFinite(max)) ||
    (min !== undefined && max !== undefined && min > max)
  )
    throw new Error('Evidence bounds must be finite and ordered');
  if (o.limitation && (!o.limitation.id || !o.limitation.reason))
    throw new Error('A limitation needs an explicit reason');
  // Missing or non-finite evidence cannot be excused by a known limitation.
  if (!Number.isFinite(o.value)) return 'fail';
  const passed =
    (o.criterion.min === undefined || o.value >= o.criterion.min) &&
    (o.criterion.max === undefined || o.value <= o.criterion.max);
  return o.limitation
    ? passed
      ? 'resolved-limitation'
      : 'known-limitation'
    : passed
      ? 'pass'
      : 'fail';
}
export function summarizeEvidence(observations: readonly EvidenceObservation[]) {
  const ids = new Set<string>();
  const counts: Record<EvidenceStatus, number> = {
    pass: 0,
    fail: 0,
    'known-limitation': 0,
    'resolved-limitation': 0,
  };
  const results = observations.map((o) => {
    if (ids.has(o.id)) throw new Error('Duplicate evidence ID: ' + o.id);
    ids.add(o.id);
    const status = assessEvidence(o);
    counts[status]++;
    return { ...o, status };
  });
  return {
    passed: results.length > 0 && counts.fail === 0 && counts['resolved-limitation'] === 0,
    counts,
    results,
  };
}
