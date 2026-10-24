/**
 * Census of the heart by pairs of neighbouring structures, printed for a human reviewer (decision 365): the Rodero volume
 * as the app binds it to a case, or the analytic heart rasterised in its frame (REVIEW_ANATOMY=rodero | analytic, as the
 * review sheets read it). The same figures the test `volumeCensus.test.ts` holds against the thresholds.
 *
 *   REVIEW_ANATOMY=rodero npx tsx tools/offline/review/volume-heart-census.ts [caseId] [phase] [stepMm]
 *
 * `stepMm` (default 1) is the analytic grid's step; the volume has its own voxel. `phase` (default 0, end-diastole) moves
 * the analytic heart; the volume is read at end-diastole, where its labels are.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadCaseById } from '@/cases';
import { buildCaseModels, REST_PATIENT } from '@/simulator/anatomy/caseModels';
import { computeHeartPose } from '@/simulator/anatomy/heartModel';
import { loadRoderoVolume } from '@/simulator/anatomy/roderoAsset';
import { volumeHeart } from '@/simulator/anatomy/volumeHeart';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import {
  analyticGrid,
  censusFindings,
  renderVolumeCensus,
  roderoGrid,
  volumeCensus,
  type LabelGrid,
} from '@/tests/coherence/volumeCensus';

const anatomy = process.env['REVIEW_ANATOMY'] ?? 'analytic';
if (anatomy !== 'rodero' && anatomy !== 'analytic')
  throw new Error(`REVIEW_ANATOMY: ${anatomy} (analytic, rodero)`);
const [caseId = 'normal-excellent-window', phaseArg = '0', stepArg = '1'] = process.argv.slice(2);

const { heart, tables } = buildCaseModels(loadCaseById(caseId), REST_PATIENT);
const endDiastole = computeHeartPose(heart, cycleStateAt(tables, 0));
let t0 = performance.now();
let grid: LabelGrid;
if (anatomy === 'rodero') {
  const vol = await loadRoderoVolume((path) => {
    const b = readFileSync(join(process.cwd(), 'public', path));
    return Promise.resolve(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  });
  grid = roderoGrid(volumeHeart(vol, heart, endDiastole).gpu());
} else
  grid = analyticGrid(
    heart,
    computeHeartPose(heart, cycleStateAt(tables, Number(phaseArg))),
    Number(stepArg),
  );
const built = (performance.now() - t0) / 1000;
t0 = performance.now();
const census = volumeCensus(grid);
const counted = (performance.now() - t0) / 1000;

const out: string[] = [
  `# Censo por pares: ${anatomy === 'rodero' ? 'corazón de Rodero' : 'corazón analítico'}, ${caseId}${anatomy === 'rodero' ? '' : ` @${phaseArg}`}`,
  '',
  `Rejilla ${grid.dims.join('×')} a ${grid.voxelMm} mm (${(grid.voxelMm * grid.cmPerMm * 10).toFixed(2)} mm del modelo; ${built.toFixed(1)} s), censo en ${counted.toFixed(1)} s.`,
  'La distancia entre cavidades cuenta medio vóxel dentro de cada una: el tejido entre ellas mide un vóxel menos.',
  '',
  ...renderVolumeCensus(census),
  '',
];
const findings = censusFindings(census);
out.push(
  findings.length
    ? `## Contra los umbrales (${findings.length})`
    : '## Contra los umbrales: nada fuera de rango',
  '',
  ...findings.map((f) => `- \`${f.key}\`: ${f.text}`),
);
process.stdout.write(out.join('\n') + '\n');
