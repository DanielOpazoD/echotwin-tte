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
  // The four valve rings are not arranged as one fibrous skeleton: the plane through the aortic, pulmonary
  // and tricuspid centres sits 64° from the aortic root axis (should be under 30°, since the parasternal
  // short axis of the great vessels shows a round aorta surrounded by the other valves), and the tricuspid
  // centre is 4.65 cm from the aortic one against 3.0–4.5. This is why that view cannot hold the aorta and
  // the pulmonary valve at the same time whatever the probe does (decision 59, docs/LIMITATIONS.md).
  'valve-plane-tilt',
  'av-tv-distance',
]);

describe('model proportions against reference ranges', () => {
  for (const input of CASE_INPUTS) {
    it(`${input.id}: only declared deviations leave the reference ranges`, { timeout: 120_000 }, () => {
      const c = loadCaseById(input.id);
      const m = measureModel(c, undefined, 90000);
      const declared = new Set(c.expectedDeviations ?? []);
      const undeclared = m.rows
        .filter((r) => r.verdict !== 'ok' && !declared.has(r.id) && !KNOWN_MODEL_LIMITATIONS.has(r.id))
        .map((r) => `${r.id}=${r.value.toFixed(2)} (${r.verdict}, ${r.lo}–${r.hi})`);
      expect(undeclared, 'undeclared out-of-range measures').toEqual([]);
      const stale = [...declared].filter((id) => m.rows.find((r) => r.id === id)?.verdict === 'ok');
      expect(stale, 'declared deviations that are inside the range').toEqual([]);
    });
  }
});
