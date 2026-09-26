import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { wrapGenerated, writeGenerated } from './generated';

/**
 * The declared-limitation sets of the tests (`KNOWN_*`), read from their sources — importing a test file would run
 * it — and listed in a table of `docs/LIMITATIONS.md` generated from them (decision 177). Three sets carried a naming
 * contract checked by `limitationsConsistency.test.ts`; the other eight (clinical image, sector, geometry, truth, chest
 * wall, segments, texture) held 110 entries the document named nowhere. The test compares the table with the sources,
 * so an entry added to a set, or one fixed and removed, changes the document in the same review; and every `KNOWN_*`
 * constant of a test is either listed here or excluded with its reason, so a new set cannot skip the document.
 *
 * Usage: npx tsx tools/docs/known-sets.ts [--check]
 */

export const KNOWN_SETS_TOOL = 'tools/docs/known-sets.ts';

/**
 * Every declared-limitation set: its test file and constant. `values`: the entries of an object literal are its keys
 * with the members of their arrays (the segments of a view), not the keys alone (whose values are baselines);
 * `byStatistic`: ids of the form `condition:statistic` are grouped by statistic, and otherwise by their first part.
 */
export const KNOWN_SETS: readonly {
  file: string;
  name: string;
  values?: true;
  byStatistic?: true;
}[] = [
  { file: 'src/simulator/anatomy/proportions.test.ts', name: 'KNOWN_MODEL_LIMITATIONS' },
  { file: 'src/simulator/windows/viewContent.test.ts', name: 'KNOWN_VIEW_LIMITATIONS' },
  { file: 'src/simulator/windows/viewLandmarks.test.ts', name: 'KNOWN_UNREACHABLE_LANDMARKS' },
  { file: 'src/simulator/anatomy/truthCoherence.test.ts', name: 'KNOWN_TRUTH_DEVIATIONS' },
  { file: 'src/simulator/anatomy/truthCoherence.test.ts', name: 'KNOWN_RATIOS' },
  { file: 'src/simulator/anatomy/chestWall.test.ts', name: 'KNOWN_INTRUSION_CM' },
  {
    file: 'src/simulator/view-recognition/segmentCoverage.test.ts',
    name: 'KNOWN_EXTRA_ASSESSABLE',
    values: true,
  },
  { file: 'src/simulator/core/mmodeStrip.test.ts', name: 'KNOWN_TEXTURE_LIMITATIONS' },
  {
    file: 'src/simulator/renderer/clinicalImage.test.ts',
    name: 'KNOWN_DEVIATIONS',
    byStatistic: true,
  },
  {
    file: 'src/simulator/renderer/clinicalImage.test.ts',
    name: 'KNOWN_GEOMETRY_DEVIATIONS',
    byStatistic: true,
  },
  {
    file: 'src/simulator/renderer/clinicalImage.test.ts',
    name: 'KNOWN_SECTOR_DEVIATIONS',
    byStatistic: true,
  },
];

/** `KNOWN_*` constants that declare no limitation of the model, with the reason. */
export const NOT_LIMITATION_SETS: Readonly<Record<string, string>> = {
  KNOWN_SHARED_CLASSIFIER_LITERALS: 'recuentos de literales de la paridad CPU/GPU del clasificador',
};

/** Every `KNOWN_*` constant declared in a test under `src/`. */
export function knownConstantsInTests(root = join(process.cwd(), 'src')): string[] {
  const out = new Set<string>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.test\.tsx?$/.test(name))
        for (const m of readFileSync(p, 'utf8').matchAll(/\bconst (KNOWN_[A-Z0-9_]+)\b/g))
          out.add(m[1]!);
    }
  };
  walk(root);
  return [...out].sort();
}

/** The literal a constant is initialised with (`new Set([...])`, `new Map([...])` or `{...}`), comments removed. */
function literalOf(source: string, name: string): { kind: 'set' | 'map' | 'record'; body: string } {
  const at = source.search(new RegExp(`\\bconst ${name}\\b`));
  if (at < 0) throw new Error(`${name} not found`);
  const eq = source.indexOf('=', at);
  const rest = source.slice(eq + 1);
  const m = rest.match(/^\s*(?:new (Set|Map)\b[^(]*\(\s*\[|(\{))/);
  if (!m) throw new Error(`${name}: not a Set, Map or object literal`);
  const kind = m[1] === 'Set' ? 'set' : m[1] === 'Map' ? 'map' : 'record';
  const open = eq + 1 + m[0].length;
  let depth = 1,
    i = open;
  for (; i < source.length && depth > 0; i++) {
    const c = source[i]!;
    if (c === '/' && source[i + 1] === '/') i = source.indexOf('\n', i);
    else if (c === "'") i = source.indexOf("'", i + 1);
    else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
  }
  return { kind, body: source.slice(open, i - 1).replace(/\/\/.*$/gm, '') };
}

/**
 * The entries a set declares: the string ids of a Set (or the member of an enum), the keys of a Map, the keys of an
 * object literal — `key:member` for each member of its arrays with `values`.
 */
export function declaredEntries(source: string, name: string, values = false): string[] {
  const { kind, body } = literalOf(source, name);
  if (kind === 'set')
    return [...body.matchAll(/'([^']+)'|\b[A-Z]\w*\.(\w+)/g)].map((x) => x[1] ?? x[2]!);
  if (kind === 'map') return [...body.matchAll(/\[\s*'([^']+)'\s*,/g)].map((x) => x[1]!);
  // object literal: top-level keys, whose values are numbers or arrays of numbers
  return [
    ...body.matchAll(/(?:^|,)\s*(?:'([^']+)'|([A-Za-z_$][\w$]*))\s*:\s*(\[[^\]]*\]|[^,]*)/g),
  ].flatMap((x) => {
    const key = x[1] ?? x[2]!;
    return values ? [...x[3]!.matchAll(/[\w.-]+/g)].map((v) => `${key}:${v[0]}`) : [key];
  });
}

/**
 * The entries of a set as the table prints them: ids of the form `a:b` are grouped by one part with the other listed
 * after it, in the order of the source; any other id is printed as it is.
 */
function formatEntries(ids: string[], byStatistic: boolean): string {
  if (!ids.length) return '—';
  if (!ids.every((id) => /^[^:\s]+:[^:\s]+$/.test(id)))
    return ids.map((id) => `\`${id}\``).join(', ');
  const by = new Map<string, string[]>();
  for (const id of ids) {
    const [a, b] = id.split(':') as [string, string];
    const [group, member] = byStatistic ? [b, a] : [a, b];
    by.set(group, [...(by.get(group) ?? []), member]);
  }
  return [...by].map(([group, members]) => `\`${group}\` (${members.join(', ')})`).join('; ');
}

export function renderKnownSetsTable(root = process.cwd()): string {
  const rows = KNOWN_SETS.map(({ file, name, values, byStatistic }) => {
    const ids = declaredEntries(readFileSync(join(root, file), 'utf8'), name, values);
    return `| \`${name}\` | \`${relative('src', file)}\` | ${ids.length} | ${formatEntries(ids, !!byStatistic)} |`;
  });
  return wrapGenerated(
    KNOWN_SETS_TOOL,
    ['| Conjunto | Prueba | Entradas | Qué declara |', '|---|---|---|---|', ...rows].join('\n'),
  );
}

if (process.argv[1]?.endsWith('known-sets.ts'))
  writeGenerated('docs/LIMITATIONS.md', KNOWN_SETS_TOOL, renderKnownSetsTable());
