/**
 * Scores the answer sheets of a Turing sitting (decision 343) against its key:
 *   npx tsx tools/offline/realism/turing-grade.ts <respuestas-*.json …> [--key <folder>/key.json]
 * The key defaults to key.json beside the first sheet. Prints, per reader, the accuracy with its binomial tail, the AUC
 * of the six-step rating, the share of simulated clips detected and of real ones accepted, accuracy by view and format,
 * and the giveaways most cited on the simulated clips the reader caught.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { gradeTuring, type AnswerSheet, type Trial } from '@/clinical/realism/turing';

const args = process.argv.slice(2);
const ki = args.indexOf('--key');
const keyArg = ki >= 0 ? args[ki + 1] : undefined;
const sheets = args.filter((a, i) => a !== '--key' && i !== ki + 1);
if (!sheets.length) {
  process.stderr.write('uso: turing-grade.ts <respuestas.json …> [--key key.json]\n');
  process.exit(2);
}
const keyPath = keyArg ?? join(dirname(resolve(sheets[0]!)), 'key.json');
const key = (JSON.parse(readFileSync(keyPath, 'utf8')) as { key: Trial['key'] }).key;
const pct = (v: number): string => (Number.isFinite(v) ? `${(100 * v).toFixed(0)} %` : '—');
for (const f of sheets) {
  const sheet = JSON.parse(readFileSync(f, 'utf8')) as AnswerSheet;
  const g = gradeTuring(key, sheet);
  process.stdout.write(
    `${sheet.reader || f}${sheet.echoReader ? ' (lee ecos)' : ''}: ${g.correct} de ${g.answered} (${pct(g.accuracy)}), ` +
      `p(azar) = ${g.pChance.toFixed(3)}, AUC ${g.auc.toFixed(2)}, simulados detectados ${pct(g.simDetected)}, ` +
      `reales aceptados ${pct(g.realAccepted)}, seguridad media ${g.meanConfidence.toFixed(1)}\n` +
      Object.entries(g.byView)
        .map(([v, s]) => `  ${v}: ${s.correct}/${s.answered}\n`)
        .join('') +
      (g.giveaways.length
        ? `  delatores: ${g.giveaways.map((x) => `${x.giveaway} ${x.count}`).join(', ')}\n`
        : ''),
  );
}
