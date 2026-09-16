import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The declared-limitation sets of the model tests carry a contract in their comments: «each entry must be
 * named in docs/LIMITATIONS.md». Until now only the comment said so (engineering audit, B6). This test reads
 * the sets out of the test sources — importing a test file would re-run it — and requires every id to appear
 * in the document in backticks, so a limitation fixed in code and removed from the set (or one added to the
 * set) cannot leave the document behind.
 */
const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const LIMITATIONS = read('docs/LIMITATIONS.md');

/** Quoted string ids inside `const NAME: ReadonlySet<string> = new Set([ ... ]);` in a test source. */
function declaredIds(source: string, name: string): string[] {
  const m = source.match(new RegExp(`const ${name}[^=]*=\\s*new Set\\(\\[([\\s\\S]*?)\\]\\)`));
  if (!m) throw new Error(`${name} not found`);
  const body = m[1]!.replace(/\/\/.*$/gm, '');
  return [...body.matchAll(/'([^']+)'/g)].map((x) => x[1]!);
}

const SETS: [string, string][] = [
  ['src/simulator/anatomy/proportions.test.ts', 'KNOWN_MODEL_LIMITATIONS'],
  ['src/simulator/windows/viewContent.test.ts', 'KNOWN_VIEW_LIMITATIONS'],
];

describe('declared model limitations are named in docs/LIMITATIONS.md', () => {
  for (const [file, name] of SETS) {
    const ids = declaredIds(read(file), name);
    it(`${name} is not empty (the parser found it)`, () => {
      expect(ids.length).toBeGreaterThan(0);
    });
    it.each(ids)(`${name}: \`%s\` appears in the document`, (id) => {
      expect(LIMITATIONS).toContain(`\`${id}\``);
    });
  }
});
