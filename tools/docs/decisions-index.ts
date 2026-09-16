import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Generates docs/DECISIONS_INDEX.md from docs/DECISIONS.md: one line per numbered decision with its date
 * (from the `## YYYY-MM-DD …` section it sits under), its title (the bold lead of the entry) and its state.
 *
 * The state is `vigente` unless the entry's text carries a `[Estado: …]` tag, e.g. `[Estado: superada por 62]`
 * or `[Estado: revertida en 66]`. The log itself stays as it is — a narrative with the measurements that
 * motivated each decision — but a reader can now find a decision by number or title and know whether a later
 * one replaced it (engineering audit, C4). `src/tests/docsConsistency.test.ts` fails when the index is stale.
 *
 * Usage: npx tsx tools/docs/decisions-index.ts [--check]
 */
export interface DecisionEntry {
  n: number;
  date: string;
  title: string;
  state: string;
  line: number;
}

export function parseDecisions(md: string): DecisionEntry[] {
  const out: DecisionEntry[] = [];
  let date = '';
  const lines = md.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    const h = l.match(/^## (\d{4}-\d{2}-\d{2})/);
    if (h) date = h[1]!;
    const e = l.match(/^(\d+)\. \*\*(.+?)\*\*/);
    if (!e) continue;
    // entries since 118 start their bold lead with the date: keep it out of the title
    const title = e[2]!.replace(/^\d{4}-\d{2}-\d{2} — /, '').replace(/:$/, '');
    const tag = l.match(/\[Estado: ([^\]]+)\]/);
    out.push({ n: Number(e[1]), date, title, state: tag ? tag[1]! : 'vigente', line: i + 1 });
  }
  return out;
}

export function renderIndex(entries: DecisionEntry[]): string {
  const rows = entries.map(
    (d) =>
      `| [${d.n}](DECISIONS.md#L${d.line}) | ${d.date} | ${d.title.replace(/\|/g, '\\|')} | ${d.state} |`,
  );
  return [
    '# Índice de decisiones',
    '',
    'Generado por `npx tsx tools/docs/decisions-index.ts` a partir de `DECISIONS.md`; no editar a mano.',
    'Una decisión marcada en su texto con `[Estado: superada por N]` o `[Estado: revertida en N]` lo muestra aquí;',
    'las demás están vigentes. `src/tests/docsConsistency.test.ts` falla si este índice no coincide con el registro.',
    '',
    `Decisiones: ${entries.length} (última: ${entries.at(-1)?.n ?? '—'}).`,
    '',
    '| N | Fecha | Decisión | Estado |',
    '|---|---|---|---|',
    ...rows,
    '',
  ].join('\n');
}

const DECISIONS = join(process.cwd(), 'docs/DECISIONS.md');
const INDEX = join(process.cwd(), 'docs/DECISIONS_INDEX.md');

if (process.argv[1] && /decisions-index\.ts$/.test(process.argv[1])) {
  const rendered = renderIndex(parseDecisions(readFileSync(DECISIONS, 'utf8')));
  if (process.argv.includes('--check')) {
    let current = '';
    try {
      current = readFileSync(INDEX, 'utf8');
    } catch {
      /* missing: stale */
    }
    if (current !== rendered) {
      console.error('docs/DECISIONS_INDEX.md is stale: run npx tsx tools/docs/decisions-index.ts');
      process.exit(1);
    }
  } else {
    writeFileSync(INDEX, rendered);
    console.info(`wrote ${INDEX}`);
  }
}
