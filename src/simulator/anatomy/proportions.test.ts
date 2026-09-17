// @tier slow
import { describe, expect, it } from 'vitest';
import { measureModel } from './measureModel';
import { CASE_INPUTS, loadCaseById } from '@/cases';

/**
 * Chamber proportions (spec 2.1, 6.2): every case must keep its measured geometry inside adult
 * reference ranges except where the case declares a deviation on purpose (`expectedDeviations`).
 * A declared deviation that is not actually out of range is flagged as stale.
 */
/**
 * Measures the current geometric primitives cannot satisfy for any case yet. Each entry must name the
 * limitation in docs/LIMITATIONS.md; remove it when the anatomy pass fixes the primitive.
 */
const KNOWN_MODEL_LIMITATIONS: ReadonlySet<string> = new Set([
  // The tricuspid centre sits 4.3–5.6 cm from the aortic one against 3.0–4.5 in ten of the twelve cases: the
  // tricuspid ring is not yet part of one fibrous skeleton with the aortic and mitral rings (docs/LIMITATIONS.md).
  // The plane through the aortic, pulmonary and tricuspid centres, declared here too while it sat 64° from the
  // aortic axis (decision 59), measures 14–16° in every case: nothing flagged that exemption as stale until
  // decision 86 added the check below.
  'av-tv-distance',
  // The right atrial long axis sits above its approximate range: 5.2-5.6 cm until decision 133, 5.6-6.8 since the
  // atrium lengthens over the base the ventricle vacates in systole under a fixed roof (the measure takes the longest
  // frame). It does not tell a normal atrium from a dilated one (docs/LIMITATIONS.md).
  'ra-long',
]);

/** Out-of-range measures per case, filled by the per-case tests and read by the staleness check. */
const outOfRange = new Map<string, Set<string>>();
const measureCase = (id: string): Set<string> => {
  let out = outOfRange.get(id);
  if (!out) {
    const m = measureModel(loadCaseById(id), undefined, 90000);
    out = new Set(m.rows.filter((r) => r.verdict !== 'ok').map((r) => r.id));
    outOfRange.set(id, out);
  }
  return out;
};

describe('model proportions against reference ranges', () => {
  for (const input of CASE_INPUTS) {
    it(
      `${input.id}: only declared deviations leave the reference ranges`,
      { timeout: 120_000 },
      () => {
        const c = loadCaseById(input.id);
        const m = measureModel(c, undefined, 90000);
        outOfRange.set(
          input.id,
          new Set(m.rows.filter((r) => r.verdict !== 'ok').map((r) => r.id)),
        );
        const declared = new Set(c.expectedDeviations ?? []);
        const undeclared = m.rows
          .filter(
            (r) => r.verdict !== 'ok' && !declared.has(r.id) && !KNOWN_MODEL_LIMITATIONS.has(r.id),
          )
          .map((r) => `${r.id}=${r.value.toFixed(2)} (${r.verdict}, ${r.lo}–${r.hi})`);
        expect(undeclared, 'undeclared out-of-range measures').toEqual([]);
        const stale = [...declared].filter(
          (id) => m.rows.find((r) => r.id === id)?.verdict === 'ok',
        );
        expect(stale, 'declared deviations that are inside the range').toEqual([]);
      },
    );
  }
  it('every model limitation still leaves its range in some case', { timeout: 600_000 }, () => {
    const stale = [...KNOWN_MODEL_LIMITATIONS].filter((id) =>
      CASE_INPUTS.every((input) => !measureCase(input.id).has(id)),
    );
    expect(stale, 'model limitations that no case needs any more').toEqual([]);
  });
});
