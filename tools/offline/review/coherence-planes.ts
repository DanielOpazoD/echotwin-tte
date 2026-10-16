/**
 * Coherence census on the drawn planes, printed for a human reviewer (decision 331): greys by structure and tissue, and
 * the straightness of the cavity borders.
 *
 *   npx tsx tools/offline/review/coherence-planes.ts [caseIds,comma|all] [viewIds,comma] [phases,comma]
 */
import { CASE_INPUTS } from '@/cases';
import { planeCensus, TISSUE_NAME } from '@/tests/coherence/planeCensus';
import { STRUCTURE_NAME } from '@/tests/coherence/structureNames';

const [casesArg = 'normal-excellent-window', viewsArg = 'a4c,plax', phasesArg = '0'] =
  process.argv.slice(2);
const ids = casesArg === 'all' ? CASE_INPUTS.map((c) => c.id) : casesArg.split(',');
for (const id of ids)
  for (const viewId of viewsArg.split(','))
    for (const phase of phasesArg.split(',').map(Number)) {
      const r = planeCensus(id, viewId, phase);
      console.info(`\n== ${id} ${viewId} @${phase}`);
      console.info('  grey by structure/tissue (samples ≥ 200):');
      for (const g of r.greys)
        console.info(
          `    ${(STRUCTURE_NAME[g.structure] ?? `#${g.structure}`).padEnd(20)} ${(TISSUE_NAME[g.tissue] ?? `t${g.tissue}`).padEnd(12)} ${g.mean.toFixed(1).padStart(6)}  (${g.samples})`,
        );
      for (const b of r.borders)
        console.info(
          `  border ${STRUCTURE_NAME[b.cavity]}: ${b.lengthCm.toFixed(1)} cm, straight ${b.straightCm.toFixed(1)} cm` +
            (b.longest
              ? `, longest run ${b.longest.lengthCm.toFixed(1)} cm at ${b.longest.at}`
              : ''),
        );
    }
