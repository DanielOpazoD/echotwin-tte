import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generatedBlock } from '../../tools/docs/generated';
import {
  declaredEntries,
  KNOWN_SETS,
  KNOWN_SETS_TOOL,
  knownConstantsInTests,
  NOT_LIMITATION_SETS,
  renderKnownSetsTable,
} from '../../tools/docs/known-sets';

/**
 * The declared-limitation sets of the model tests carry a contract in their comments: «each entry must be
 * named in docs/LIMITATIONS.md». Until the engineering audit (B6) only the comment said so. The sets are read out of
 * the test sources — importing a test file would re-run it — by `tools/docs/known-sets.ts`, which also writes the
 * table of every set at the end of the document (decision 177): the three sets of string ids must name each id in
 * backticks in the prose, every set must appear in the generated table as its source declares it, and every
 * `KNOWN_*` constant of a test must be one of those sets or excluded with its reason. A limitation fixed in code and
 * removed from its set (or one added) cannot leave the document behind.
 */
const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const LIMITATIONS = read('docs/LIMITATIONS.md');

/** The sets whose ids the prose names one by one. */
const NAMED_IN_PROSE = new Set([
  'KNOWN_MODEL_LIMITATIONS',
  'KNOWN_VIEW_LIMITATIONS',
  'KNOWN_UNREACHABLE_LANDMARKS',
]);

describe('declared model limitations are named in docs/LIMITATIONS.md', () => {
  for (const { file, name, values } of KNOWN_SETS) {
    const ids = declaredEntries(read(file), name, values);
    it(`${name} is not empty (the parser found it)`, () => {
      expect(ids.length).toBeGreaterThan(0);
    });
    if (NAMED_IN_PROSE.has(name))
      it.each(ids)(`${name}: \`%s\` appears in the document`, (id) => {
        expect(LIMITATIONS).toContain(`\`${id}\``);
      });
  }

  it('lists every set as its test declares it (run npx tsx tools/docs/known-sets.ts)', () => {
    expect(generatedBlock(LIMITATIONS, KNOWN_SETS_TOOL)).toBe(renderKnownSetsTable());
  });

  it('knows every KNOWN_* constant of the tests', () => {
    const covered = new Set([
      ...KNOWN_SETS.map((s) => s.name),
      ...Object.keys(NOT_LIMITATION_SETS),
    ]);
    expect(knownConstantsInTests().filter((n) => !covered.has(n))).toEqual([]);
    expect([...covered].filter((n) => !knownConstantsInTests().includes(n))).toEqual([]);
  });
});
