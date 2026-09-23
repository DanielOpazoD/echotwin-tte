import { MEASUREMENT_SPECS } from '@/simulator/measurements/protocol';
import { wrapGenerated, writeGenerated } from './generated';

/**
 * The protocol measurements of `docs/MEASUREMENTS.md` (decision 180), generated from `MEASUREMENT_SPECS`: the document
 * described the tools as they were before the protocol of decision 30 and listed Simpson and the LA volume as pending
 * long after they existed. `docsConsistency.test.ts` compares the table with the code.
 *
 * Usage: npx tsx tools/docs/measurements-table.ts [--check]
 */
export const MEASUREMENTS_TABLE_TOOL = 'tools/docs/measurements-table.ts';

const PHASE: Record<string, string> = {
  ed: 'telediástole',
  es: 'telesístole',
  'mid-systole': 'mesosístole',
  'early-diastole': 'protodiástole',
  'late-diastole': 'telediástole (A)',
  systole: 'sístole',
  any: 'cualquiera',
};

export function renderMeasurementsTable(): string {
  const rows = MEASUREMENT_SPECS.map(
    (s) =>
      `| \`${s.id}\` | ${s.label} | \`${s.tool}\` | ${s.modalities.join(', ')} | ${s.views.join(', ')} | ${PHASE[s.phase] ?? s.phase} | ${s.maxAngleDeg !== undefined ? `≤ ${s.maxAngleDeg}°` : '—'} | ${s.tolerancePct} % |`,
  );
  return wrapGenerated(
    MEASUREMENTS_TABLE_TOOL,
    [
      '| Id | Medida | Herramienta | Modalidad | Vistas | Fase | Ángulo | Tolerancia |',
      '|---|---|---|---|---|---|---|---|',
      ...rows,
    ].join('\n'),
  );
}

if (process.argv[1]?.endsWith('measurements-table.ts'))
  writeGenerated('docs/MEASUREMENTS.md', MEASUREMENTS_TABLE_TOOL, renderMeasurementsTable());
