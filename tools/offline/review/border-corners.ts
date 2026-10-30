/**
 * Corners of the anatomy's borders in the drawn planes, printed for a human reviewer (decision 382): for each case, view
 * and phase, the count per border (the sac and the blood of the four chambers) and where each corner lies.
 *
 *   npx tsx tools/offline/review/border-corners.ts [caseIds,comma|all] [viewIds,comma] [phases,comma] [--where]
 */
import { CASE_INPUTS } from '@/cases';
import { BORDERS, borderCorners } from '@/tests/coherence/borderCorners';

const args = process.argv.slice(2).filter((a) => a !== '--where');
const where = process.argv.includes('--where');
const [
  casesArg = 'normal-excellent-window',
  viewsArg = 'a4c,a2c,plax,psax-mv,subcostal-4c',
  phasesArg = '0',
] = args;
const ids = casesArg === 'all' ? CASE_INPUTS.map((c) => c.id) : casesArg.split(',');
for (const id of ids)
  for (const viewId of viewsArg.split(','))
    for (const phase of phasesArg.split(',').map(Number)) {
      const corners = borderCorners(id, viewId, phase);
      const counts = BORDERS.map((b) => `${b} ${corners.filter((c) => c.border === b).length}`);
      console.info(`${id} ${viewId} @${phase}: ${counts.join(', ')}`);
      if (where)
        for (const c of corners)
          console.info(
            `    ${c.border} ${c.turnDeg.toFixed(0)}° at ${c.depthCm.toFixed(1)} cm deep, ${c.lateralCm.toFixed(1)} cm lateral`,
          );
    }
