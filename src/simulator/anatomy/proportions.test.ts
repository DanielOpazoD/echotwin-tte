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
const KNOWN_MODEL_LIMITATIONS: ReadonlySet<string> = new Set([]);

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
