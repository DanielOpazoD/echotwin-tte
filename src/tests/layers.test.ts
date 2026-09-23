import { describe, expect, it } from 'vitest';
import { layerEdges } from '../../tools/docs/layer-graph';

/**
 * Architecture test: the import graph between layers is a DAG. `docs/ARCHITECTURE.md` shows each layer and what it
 * imports (a table generated from this same graph, `tools/docs/layer-graph.ts`); ESLint fixes a few boundaries per
 * directory; this test states the whole property — no cycle between layers — over the real imports of `src/`
 * (excluding tests), so a new edge that closes a cycle fails here whatever directories it involves. The 2026-09-16
 * engineering audit (B1) found five layer cycles; the one between `app` and `ui` (the React shell renders the UI, the
 * UI reads the store) is inherent to the application layer and is allowed explicitly.
 */

/** Tarjan's strongly connected components over the layer graph. */
function cycles(edges: Map<string, Map<string, string>>): string[][] {
  let index = 0;
  const stack: string[] = [];
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const out: string[][] = [];
  const nodes = new Set<string>();
  for (const [a, bs] of edges) {
    nodes.add(a);
    for (const b of bs.keys()) nodes.add(b);
  }
  const visit = (v: string) => {
    idx.set(v, index);
    low.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);
    for (const w of edges.get(v)?.keys() ?? []) {
      if (!idx.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, idx.get(w)!));
    }
    if (low.get(v) === idx.get(v)) {
      const comp: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      if (comp.length > 1) out.push(comp.sort());
    }
  };
  for (const v of nodes) if (!idx.has(v)) visit(v);
  return out;
}

/** Cycles the architecture accepts on purpose; shrink, never grow. */
const ALLOWED_CYCLES = [['app', 'ui']];

describe('layer graph', () => {
  const edges = layerEdges();

  it('sees the layers', () => {
    expect(edges.size).toBeGreaterThan(8);
  });

  it('has no cycles between layers beyond the allowed application shell ↔ UI pair', () => {
    const found = cycles(edges).filter(
      (c) => !ALLOWED_CYCLES.some((a) => a.length === c.length && a.every((x, i) => x === c[i])),
    );
    const explain = found.map((c) => {
      const lines = [`cycle: ${c.join(' → ')}`];
      for (const a of c)
        for (const b of c) {
          const ex = edges.get(a)?.get(b);
          if (ex) lines.push(`  ${a} → ${b}: ${ex}`);
        }
      return lines.join('\n');
    });
    expect(found, explain.join('\n\n')).toEqual([]);
  });

  it('the core imports nothing and the clinical layer imports no engine', () => {
    expect([...(edges.get('core')?.keys() ?? [])]).toEqual([]);
    const clinical = [...(edges.get('clinical')?.keys() ?? [])];
    expect(clinical.filter((l) => l.startsWith('simulator') || l === 'education')).toEqual([]);
  });
});
