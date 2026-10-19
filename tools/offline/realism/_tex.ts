// scratch experiment (never committed): the clinical-image statistics of the excellent-window case against CAMUS Good
import { CAMUS_GOOD, type CamusMetric } from '@/clinical/reference-values/camusImageStats';
import type { ImageStats } from '@/clinical/regionStats';
import { apicalStats, meanStat, renderApical } from '@/simulator/renderer/clinicalImage';
import { loadCaseById } from '@/cases';
const CHECKED: [CamusMetric, (s: ImageStats) => number][] = [
  ['cavityGrey', (s) => s.cavity.median], ['myocardiumGrey', (s) => s.myocardium.median], ['atriumGrey', (s) => s.atrium.median],
  ['contrast', (s) => s.tissueBloodContrast], ['myocardialLocalStd', (s) => s.myocardialLocalStd], ['myocardialDetrendedStd', (s) => s.myocardialDetrendedStd],
  ['cavityDetrendedStd', (s) => s.cavityDetrendedStd], ['speckleCellHorizontalMm', (s) => s.speckleCellMm.horizontal], ['speckleCellVerticalMm', (s) => s.speckleCellMm.vertical],
  ['myocardialResidualSkew', (s) => s.myocardialResidualSkew], ['levelStdSlope', (s) => s.levelStdSlope], ['brightGreyP99', (s) => s.brightGreyP99],
];
const R = Number(process.env.R ?? 4);
const seed = loadCaseById('normal-excellent-window').seed;
const rows: string[] = [];
let total = 0;
for (const [key, view, ed] of [['4CH-ED', 'a4c', true], ['4CH-ES', 'a4c', false], ['2CH-ED', 'a2c', true], ['2CH-ES', 'a2c', false]] as const) {
  const stats = Array.from({ length: R }, (_, k) => apicalStats(renderApical('normal-excellent-window', view, ed, seed + k), (process.env.PERS ? { persistence: Number(process.env.PERS) } : {}) as never, 2)).flat();
  const ref = (CAMUS_GOOD as Record<string, Record<string, { p25: number; p75: number; median: number }>>)[key]!;
  const parts: string[] = [];
  for (const [m, get] of CHECKED) {
    const v = meanStat(stats, get), q = ref[m]!, w = q.p75 - q.p25;
    const d = v < q.p25 ? (v - q.p25) / w : v > q.p75 ? (v - q.p75) / w : 0;
    total += Math.abs(d);
    parts.push(`${m}=${v.toFixed(2)}${d ? `(${d > 0 ? '+' : ''}${d.toFixed(2)})` : ''}`);
  }
  rows.push(`${key}: ${parts.join(' ')}`);
}
console.log(rows.join('\n'));
console.log('TOTAL fuera de cuartiles', total.toFixed(2));
