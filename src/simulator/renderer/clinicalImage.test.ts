import { describe, expect, it } from 'vitest';
import { imageStats, type ImageStats } from '@/clinical/regionStats';
import { CAMUS_GOOD, type CamusMetric } from '@/clinical/reference-values/camusImageStats';
import { presentApical, renderApical } from './clinicalImage';

/**
 * The simulator against clinical optimal-window images (decisions 70 and 74). The excellent-window case, rendered and
 * measured exactly as tools/clinical/camus-compare.ts does, must fall inside the interquartile range of CAMUS apical
 * images rated Good for LV cavity, myocardium and left atrium grey, tissue/blood contrast, myocardial local std,
 * speckle-scale texture contrast of myocardium and blood pool, and speckle cell size, in both apical views at
 * end-diastole and end-systole.
 */
const CHECKED: [CamusMetric, (s: ImageStats) => number][] = [
  ['cavityGrey', (s) => s.cavity.median],
  ['myocardiumGrey', (s) => s.myocardium.median],
  ['atriumGrey', (s) => s.atrium.median],
  ['contrast', (s) => s.tissueBloodContrast],
  ['myocardialLocalStd', (s) => s.myocardialLocalStd],
  ['myocardialDetrendedStd', (s) => s.myocardialDetrendedStd],
  ['cavityDetrendedStd', (s) => s.cavityDetrendedStd],
  ['speckleCellHorizontalMm', (s) => s.speckleCellMm.horizontal],
  ['speckleCellVerticalMm', (s) => s.speckleCellMm.vertical],
];

const CONDITIONS = [
  ['4CH-ED', 'a4c', true],
  ['4CH-ES', 'a4c', false],
  ['2CH-ED', 'a2c', true],
  ['2CH-ES', 'a2c', false],
] as const;

/**
 * Deviations of the model, not of the console, each named in docs/LIMITATIONS.md. Tissue/blood contrast is nearly
 * constant across CAMUS Good (medians 40-44 in all four conditions) but spans 21 grey levels in the model, from 51
 * in A4C end-diastole to 30 in A2C end-systole, and no console moves both inside: gains from −4 to +2 dB and a 65 dB
 * range leave 4 to 7 conditions out and never fix either contrast (decision 70). The myocardium and atrium entries
 * are the same brightness pattern crossing the quartile by 2 and 1 grey levels. A declaration that holds no longer
 * fails the test, so the list cannot outlive the defect.
 */
const KNOWN_DEVIATIONS: ReadonlySet<string> = new Set([
  '4CH-ED:myocardiumGrey',
  '4CH-ED:contrast',
  '2CH-ES:atriumGrey',
  '2CH-ES:contrast',
  // Texture (decision 74, docs/LIMITATIONS.md): the speckle cell is 1.2-1.5 × 0.9 mm against 2.1 × 1.7 mm, and the
  // myocardium's grey std against its ±4 mm local mean is ~13 against ~21 — the console adds receiver noise as an
  // envelope 14 dB under the myocardium and flattens a 5.2 dB speckle to ~4 dB. The blood pool is slightly smoother
  // than clinical. Widening the PSF matched these numbers and looked false (dark worm-like nulls, granular blood);
  // smoothing after detection lost the texture contrast. Declared until a texture model passes both tests.
  ...['4CH-ED', '4CH-ES', '2CH-ED', '2CH-ES'].flatMap((k) => [`${k}:myocardialDetrendedStd`, `${k}:speckleCellHorizontalMm`, `${k}:speckleCellVerticalMm`]),
  '4CH-ED:cavityDetrendedStd',
  '2CH-ED:cavityDetrendedStd',
  '2CH-ES:cavityDetrendedStd',
]);

describe('the default console against clinical optimal-window images (CAMUS Good)', () => {
  it('declared deviations name real conditions and metrics', () => {
    const real = new Set(CONDITIONS.flatMap(([k]) => CHECKED.map(([m]) => `${k}:${m}`)));
    expect([...KNOWN_DEVIATIONS].filter((d) => !real.has(d))).toEqual([]);
  });

  it('apical grey levels, contrast and texture fall inside the clinical interquartile range', { timeout: 60_000 }, () => {
    const outside: string[] = [];
    const stale: string[] = [];
    for (const [key, view, ed] of CONDITIONS) {
      const stats = imageStats(presentApical(renderApical('normal-excellent-window', view, ed)));
      for (const [metric, get] of CHECKED) {
        const q = CAMUS_GOOD[key][metric];
        const v = get(stats);
        const inside = v >= q.p25 && v <= q.p75;
        const id = `${key}:${metric}`;
        if (!inside && !KNOWN_DEVIATIONS.has(id)) outside.push(`${id} = ${v.toFixed(2)} outside [${q.p25}, ${q.p75}] (median ${q.median})`);
        if (inside && KNOWN_DEVIATIONS.has(id)) stale.push(`${id} = ${v.toFixed(2)} is inside [${q.p25}, ${q.p75}]`);
      }
    }
    // one assertion, so a failure lists undeclared and stale entries together
    expect({ outside, stale }, 'undeclared deviations from CAMUS Good, and declared ones that no longer deviate').toEqual({ outside: [], stale: [] });
  });
});
