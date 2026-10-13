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
  // The great vessels against 77 chest CT volumes (decisions 307 and 308): the root sits 8.0 cm below the arch apex and
  // 9.7 cm below the notch against 9.3-13.6 and 11.4-15.8 on CT, which is taken at deep inspiration, when the heart has
  // descended from the sternum. In that short room the ascending aorta of the cases with the widest roots reaches the
  // arch at the edge of the CT's tilts: 29° to the right in the HFrEF case (CT 11-28.5°) and 1.8° backward in severe
  // aortic stenosis (CT from 0.4° backward). The gap from the sternum, the ascending depth, the arch width and the apex
  // behind the notch, declared here until the course was placed by the CT (decision 308), now hold in every case.
  'ascending-forward-tilt',
  'ascending-right-tilt',
  'root-arch-apex-height',
  'root-notch-height',
  // 'av-tv-distance' was declared here while it read the distance between the aortic and tricuspid centres, 4.3-5.6 cm
  // against an approximate 3.0-4.5 with no source. What the anatomy fixes is the gap between the two hinge lines, which
  // the membranous septum spans: 0.26-1.14 cm in every case against its 9.0-11.4 mm (decision 306).
  // 'ra-long' was declared here while the right atrial long axis sat at or above the top of its range (4.5-5.9 cm, 5.62
  // in the normal case): the roof had no wall over the tricuspid orifice and the cavity ran 0.22 cm into it. With the
  // roof back (decision 219) it measures 4.50-5.46 in every case but atrial fibrillation, which declares it.
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
    it(`${input.id}: only declared deviations leave the reference ranges`, () => {
      const c = loadCaseById(input.id);
      const m = measureModel(c, undefined, 90000);
      outOfRange.set(input.id, new Set(m.rows.filter((r) => r.verdict !== 'ok').map((r) => r.id)));
      const declared = new Set(c.expectedDeviations ?? []);
      const undeclared = m.rows
        .filter(
          (r) => r.verdict !== 'ok' && !declared.has(r.id) && !KNOWN_MODEL_LIMITATIONS.has(r.id),
        )
        .map((r) => `${r.id}=${r.value.toFixed(2)} (${r.verdict}, ${r.lo}–${r.hi})`);
      expect(undeclared, 'undeclared out-of-range measures').toEqual([]);
      const stale = [...declared].filter((id) => m.rows.find((r) => r.id === id)?.verdict === 'ok');
      expect(stale, 'declared deviations that are inside the range').toEqual([]);
    });
  }
  it('every model limitation still leaves its range in some case', () => {
    const stale = [...KNOWN_MODEL_LIMITATIONS].filter((id) =>
      CASE_INPUTS.every((input) => !measureCase(input.id).has(id)),
    );
    expect(stale, 'model limitations that no case needs any more').toEqual([]);
  });
});
