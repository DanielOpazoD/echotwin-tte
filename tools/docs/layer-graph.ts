import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { wrapGenerated, writeGenerated } from './generated';

/**
 * The import graph between the layers of `src/` (decision 177), shared by `src/tests/layers.test.ts` (no cycles) and
 * by the table of `docs/ARCHITECTURE.md` it generates: each layer and the layers it imports, from the real imports of
 * the source (tests excluded). The hand-written «imports from» column had drifted from the code (the Doppler engine
 * imports the anatomy, and the document said it did not); `src/tests/architectureDoc.test.ts` fails when the table is
 * stale, so a new edge between layers shows up in review.
 *
 * Usage: npx tsx tools/docs/layer-graph.ts [--check]
 */

/** A file's layer: the first directory under src/, with `simulator/<engine>` split one level deeper. */
export function layerOf(rel: string): string {
  const parts = rel.split('/');
  if (parts[0] === 'simulator' && parts.length > 2) return `simulator/${parts[1]}`;
  return parts[0]!;
}

function sourceFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
    }
  };
  walk(root);
  return out;
}

/** Resolve an import specifier to a src-relative path (without extension), or null for packages. */
function resolveImport(fromRel: string, spec: string): string | null {
  if (spec.startsWith('@/')) return spec.slice(2);
  if (spec.startsWith('.')) {
    const dir = fromRel.split('/').slice(0, -1);
    for (const seg of spec.split('/')) {
      if (seg === '.') continue;
      if (seg === '..') dir.pop();
      else dir.push(seg);
    }
    return dir.join('/');
  }
  return null;
}

/** Edges between layers, with one example import per edge. */
export function layerEdges(root = join(process.cwd(), 'src')): Map<string, Map<string, string>> {
  const edges = new Map<string, Map<string, string>>();
  for (const file of sourceFiles(root)) {
    const rel = relative(root, file).replace(/\\/g, '/');
    const from = layerOf(rel);
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/from\s+'([^']+)'|import\s*\(\s*'([^']+)'\s*\)/g)) {
      const target = resolveImport(rel, m[1] ?? m[2]!);
      if (!target) continue;
      const to = layerOf(target);
      if (to === from) continue;
      let bucket = edges.get(from);
      if (!bucket) edges.set(from, (bucket = new Map<string, string>()));
      if (!bucket.has(to)) bucket.set(to, `${rel} → ${target}`);
    }
  }
  return edges;
}

export const LAYER_GRAPH_TOOL = 'tools/docs/layer-graph.ts';

/** The generated table: every layer of `src/`, sorted, with the layers it imports. */
export function renderLayerTable(edges: Map<string, Map<string, string>>): string {
  const layers = new Set<string>(edges.keys());
  for (const bs of edges.values()) for (const b of bs.keys()) layers.add(b);
  const rows = [...layers].sort().map((l) => {
    const to = [...(edges.get(l)?.keys() ?? [])].sort();
    return `| \`${l}\` | ${to.length ? to.map((t) => `\`${t}\``).join(', ') : '—'} |`;
  });
  return wrapGenerated(
    LAYER_GRAPH_TOOL,
    ['| Capa | Importa de |', '|---|---|', ...rows].join('\n'),
  );
}

if (process.argv[1]?.endsWith('layer-graph.ts'))
  writeGenerated('docs/ARCHITECTURE.md', LAYER_GRAPH_TOOL, renderLayerTable(layerEdges()));
