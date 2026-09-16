import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CASE_INPUTS } from '@/cases';
import { VIEW_TARGETS } from '@/simulator/windows/viewTargets';
import { parseDecisions, renderIndex } from '../../tools/docs/decisions-index';

/**
 * Documentation drift guard: CLINICAL_SCOPE.md is the human-readable inventory of cases and views;
 * this test makes it as load-bearing as KNOWN_MODEL_LIMITATIONS is for proportions — a case or view
 * added to the code without reaching the doc fails here. ARCHITECTURE.md gets the same treatment
 * for the facts it states about the code (case count, files it names): the 2026-09-16 engineering
 * audit found it saying «tres casos» and naming a function that no longer existed.
 */
const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const SCOPE = read('docs/CLINICAL_SCOPE.md');
const ARCHITECTURE = read('docs/ARCHITECTURE.md');

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

/** Every `*.ts`/`*.tsx` basename under src/, e2e/ and tools/ (the docs name files, not paths). */
function sourceBasenames(): Set<string> {
  const out = new Set<string>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(name)) out.add(name);
    }
  };
  for (const top of ['src', 'e2e', 'tools']) walk(join(ROOT, top));
  return out;
}

describe('DECISIONS_INDEX.md is generated from DECISIONS.md', () => {
  it('matches the log (run npm run docs:index after adding or tagging a decision)', () => {
    const entries = parseDecisions(read('docs/DECISIONS.md'));
    expect(entries.length).toBeGreaterThan(120);
    expect(read('docs/DECISIONS_INDEX.md')).toBe(renderIndex(entries));
  });

  it('numbers the decisions 1..N without gaps or duplicates (60 sits before 59 in the log, on purpose)', () => {
    const ns = parseDecisions(read('docs/DECISIONS.md'))
      .map((d) => d.n)
      .sort((a, b) => a - b);
    expect(ns).toEqual(ns.map((_, i) => i + 1));
  });
});

describe('ARCHITECTURE.md stays in sync with the code', () => {
  it('states the real number of cases', () => {
    expect(ARCHITECTURE).toContain(`${CASE_INPUTS.length} casos`);
  });

  it('only names source files that exist', () => {
    const named = new Set(
      [...ARCHITECTURE.matchAll(/`([^`\s]*?([A-Za-z0-9_.-]+\.tsx?))`/g)].map((m) => m[2] ?? ''),
    );
    const existing = sourceBasenames();
    const missing = [...named].filter((f) => !existing.has(f));
    expect(missing, `ARCHITECTURE.md names files that do not exist: ${missing.join(', ')}`).toEqual(
      [],
    );
  });

  it('only names docs that exist', () => {
    const named = [...ARCHITECTURE.matchAll(/`(docs\/[A-Za-z0-9_./-]+\.md)`/g)].map((m) => m[1]!);
    const missing = named.filter((rel) => !existsSync(join(ROOT, rel)));
    expect(missing).toEqual([]);
  });
});
