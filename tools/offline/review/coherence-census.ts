/**
 * Coherence census of the heart model, printed for a human reviewer (decision 331).
 *
 *   npx tsx tools/offline/review/coherence-census.ts [caseIds,comma|all] [phases,comma] [stepCm]
 */
import { CASE_INPUTS } from '@/cases';
import { heartCensus, label } from '@/tests/coherence/heartCensus';

const [casesArg = 'normal-excellent-window', phasesArg = '0,0.35', stepArg = '0.2'] =
  process.argv.slice(2);
const ids = casesArg === 'all' ? CASE_INPUTS.map((c) => c.id) : casesArg.split(',');
for (const id of ids)
  for (const phase of phasesArg.split(',').map(Number)) {
    const t0 = Date.now();
    const r = heartCensus(id, phase, Number(stepArg));
    console.info(
      `\n== ${id} @${phase}: ${r.cells} heart cells at ${stepArg} cm (${((Date.now() - t0) / 1000).toFixed(0)} s), ${r.contacts.length} contact pairs, ${r.islands.length} islands`,
    );
    for (const k of r.contacts)
      console.info(
        `  ${label(k.a)} | ${label(k.b)}: ${k.cm2.toFixed(2)} cm² (${k.faces}) at ${k.at}`,
      );
    for (const isl of r.islands)
      console.info(
        `  ISLAND ${label(isl.structure)} inside ${label(isl.around)}: ${isl.cells} cells, ${isl.ml.toFixed(3)} mL at ${isl.at}`,
      );
  }
