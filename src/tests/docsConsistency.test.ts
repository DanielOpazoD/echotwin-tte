import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CASE_INPUTS } from '@/cases';
import { VIEW_TARGETS } from '@/simulator/windows/viewTargets';
import { parseDecisions, renderIndex } from '../../tools/docs/decisions-index';
import { generatedBlock } from '../../tools/docs/generated';
import { LAYER_GRAPH_TOOL, layerEdges, renderLayerTable } from '../../tools/docs/layer-graph';
import {
  MEASUREMENTS_TABLE_TOOL,
  renderMeasurementsTable,
} from '../../tools/docs/measurements-table';

/**
 * Documentation drift guard: CLINICAL_SCOPE.md is the human-readable inventory of cases and views;
 * this test makes it as load-bearing as KNOWN_MODEL_LIMITATIONS is for proportions — a case or view
 * added to the code without reaching the doc fails here. ARCHITECTURE.md gets the same treatment
 * for the facts it states about the code (case count, files it names, the layers and what each imports): the
 * 2026-09-16 engineering audit found it saying «tres casos» and naming a function that no longer existed, and its
 * hand-written «imports from» column had drifted from the imports (decision 177). The README and CONTRIBUTING state
 * the Node version of `.nvmrc`: the README asked for Node 20 while `engines` required 22.
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

  it('shows what each layer imports as the real graph does (run npx tsx tools/docs/layer-graph.ts)', () => {
    expect(generatedBlock(ARCHITECTURE, LAYER_GRAPH_TOOL)).toBe(renderLayerTable(layerEdges()));
  });

  it('gives every layer of the graph a folder in the responsibility table, and names no folder that is gone', () => {
    const section = ARCHITECTURE.slice(0, ARCHITECTURE.indexOf('<!-- generado'));
    const folders = [...section.matchAll(/`src\/([A-Za-z0-9_./-]+)`/g)].map((m) => m[1]!);
    const layers = new Set<string>();
    for (const [a, bs] of layerEdges()) {
      layers.add(a);
      for (const b of bs.keys()) layers.add(b);
    }
    expect([...layers].filter((l) => !folders.includes(l))).toEqual([]);
    expect(folders.filter((f) => !existsSync(join(ROOT, 'src', f)))).toEqual([]);
  });
});

describe('MEASUREMENTS.md describes the measurements as they are (decision 180)', () => {
  const doc = read('docs/MEASUREMENTS.md');

  it('lists the protocol as the code declares it (run npm run docs:gen)', () => {
    expect(generatedBlock(doc, MEASUREMENTS_TABLE_TOOL)).toBe(renderMeasurementsTable());
  });

  it('names every tool of the measurement panel', () => {
    const panel = read('src/ui/ConsolePanel.tsx');
    const list = panel.slice(
      panel.indexOf('const tools:'),
      panel.indexOf('];', panel.indexOf('const tools:')),
    );
    const tools = [...list.matchAll(/id: '([a-z-]+)'/g)]
      .map((m) => m[1]!)
      .filter((t) => t !== 'none');
    expect(tools.length).toBeGreaterThan(5);
    expect(tools.filter((t) => !doc.includes(`(\`${t}\`)`))).toEqual([]);
  });

  it('names every derived calculation of the report', () => {
    const src = read('src/education/report.ts');
    const body = src.slice(src.indexOf('export function deriveCalculations'));
    const ids = [...body.matchAll(/(?:id: |\[)'([a-z-]+)'/g)].map((m) => m[1]!);
    expect(ids.length).toBeGreaterThan(10);
    expect(ids.filter((id) => !doc.includes(`\`${id}\``))).toEqual([]);
  });
});

describe('README and CONTRIBUTING describe the repository as it is', () => {
  const scripts = Object.keys(
    (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts,
  );

  it('name only npm scripts that exist', () => {
    for (const doc of ['README.md', 'CONTRIBUTING.md']) {
      const named = [...read(doc).matchAll(/npm run ([\w:-]+)/g)].map((m) => m[1]!);
      expect(named.length, doc).toBeGreaterThan(0);
      expect(
        named.filter((n) => !scripts.includes(n)),
        doc,
      ).toEqual([]);
    }
  });

  it('CONTRIBUTING counts the rules of the fidelity method', () => {
    const rules =
      read('.claude/skills/fidelity-method/SKILL.md').match(/^\d+\. \*\*/gm)?.length ?? 0;
    expect(rules).toBeGreaterThan(0);
    expect(read('CONTRIBUTING.md')).toContain(`${rules} reglas de método`);
  });
});

describe('the Node version is stated once', () => {
  const major = read('.nvmrc').trim();

  it('package.json, the CI workflow, the README and CONTRIBUTING follow .nvmrc', () => {
    const pkg = JSON.parse(read('package.json')) as { engines: { node: string } };
    expect(pkg.engines.node).toBe(`>=${major}`);
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain('node-version-file: .nvmrc');
    expect(ci).not.toMatch(/node-version:/);
    for (const doc of ['README.md', 'CONTRIBUTING.md']) {
      const stated = [...read(doc).matchAll(/\bNode (\d+)/g)].map((m) => m[1]);
      expect(stated.length, `${doc} states no Node version`).toBeGreaterThan(0);
      expect(
        stated.filter((v) => v !== major),
        doc,
      ).toEqual([]);
    }
  });
});
