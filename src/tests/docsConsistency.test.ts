import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CASE_INPUTS } from '@/cases';
import { VIEW_TARGETS } from '@/simulator/windows/viewTargets';

/**
 * Documentation drift guard: CLINICAL_SCOPE.md is the human-readable inventory of cases and views;
 * this test makes it as load-bearing as KNOWN_MODEL_LIMITATIONS is for proportions — a case or view
 * added to the code without reaching the doc fails here.
 */
const SCOPE = readFileSync(join(process.cwd(), 'docs/CLINICAL_SCOPE.md'), 'utf8');

describe('CLINICAL_SCOPE.md stays in sync with the code', () => {
  it('states the real number of cases', () => {
    expect(SCOPE).toContain(`${CASE_INPUTS.length} casos`);
  });

  it.each(CASE_INPUTS.map((c) => c.id))('documents the case %s', (id) => {
    expect(SCOPE).toContain(`\`${id}\``);
  });

  it.each(VIEW_TARGETS.map((v) => v.id))('documents the view %s', (id) => {
    expect(SCOPE).toContain(`\`${id}\``);
  });

  it('drops the "no case uses it" note once a feature is exercised', () => {
    const anyBicuspid = CASE_INPUTS.some((c) => c.anatomy?.aorticValve?.bicuspid === true);
    expect(SCOPE.includes('ningún caso lo usa')).toBe(!anyBicuspid);
  });
});
