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
 * in A4C end-diastole to 28 in A2C end-systole, and no console moves both inside: gains from −4 to +2 dB and a 65 dB
 * range leave 4 to 7 conditions out and never fix either contrast (decision 70). The myocardium and atrium entries
 * are the same brightness pattern crossing the quartile by 1 or 2 grey levels; A2C end-systole myocardium joined them
 * when the basal inferior wall began to reach the mitral annulus (decisions 76-77: 4 % more myocardium, deeper, grey
 * median 92 → 90 against a quartile of 91). A declaration that holds no longer fails the test, so the list cannot
 * outlive the defect. A2C end-systole atrium grey left the list when the A2C preset stopped sliding under the lung and
 * the anterior wall came into the image (decision 83: atrium 81 → 79 against a quartile of 79).
 */
const KNOWN_DEVIATIONS: ReadonlyMap<string, number> = new Map([
  // Each entry holds its baseline: the signed distance outside the clinical quartiles, in quartile widths (negative
  // below the 25th percentile, positive above the 75th), measured on a75af1a. A declared deviation used to be checked
  // only for being declared and not stale, so it could grow without limit (external audit F11, decision 88).
  ['4CH-ED:myocardiumGrey', 0.04],
  ['4CH-ED:contrast', 0.21],
  ['2CH-ES:myocardiumGrey', -0.1],
  ['2CH-ES:contrast', -0.92],
  // Texture (decision 74, docs/LIMITATIONS.md): the speckle cell is 1.2-1.5 × 0.9 mm against 2.1 × 1.7 mm, and the
  // myocardium's grey std against its ±4 mm local mean is ~13 against ~21 — the console adds receiver noise as an
  // envelope 14 dB under the myocardium and flattens a 5.2 dB speckle to ~4 dB. The blood pool is slightly smoother
  // than clinical. Widening the PSF matched these numbers and looked false (dark worm-like nulls, granular blood);
  // smoothing after detection lost the texture contrast. Declared until a texture model passes both tests.
  ['4CH-ED:myocardialDetrendedStd', -1.41],
  ['4CH-ED:speckleCellHorizontalMm', -2.39],
  ['4CH-ED:speckleCellVerticalMm', -2.34],
  ['4CH-ES:myocardialDetrendedStd', -1.46],
  ['4CH-ES:speckleCellHorizontalMm', -2.82],
  ['4CH-ES:speckleCellVerticalMm', -2.56],
  ['2CH-ED:myocardialDetrendedStd', -1.33],
  ['2CH-ED:speckleCellHorizontalMm', -2.54],
  ['2CH-ED:speckleCellVerticalMm', -2.2],
  ['2CH-ES:myocardialDetrendedStd', -1.14],
  ['2CH-ES:speckleCellHorizontalMm', -3.44],
  ['2CH-ES:speckleCellVerticalMm', -2.31],
  // A4C end-diastole blood texture reached the quartile (11.92 → 11.96 against 11.94) with decisions 76-77
  ['2CH-ED:cavityDetrendedStd', -0.32],
  ['2CH-ES:cavityDetrendedStd', -0.32],
]);

/**
 * How far a declared deviation may move from its baseline, in quartile widths, before the test asks for attention: a
 * regression beyond it fails, and so does an improvement beyond it, until the baseline is lowered — so the bound always
 * sits near the best the model has reached.
 */
const BASELINE_TOLERANCE = 0.15;

/** Signed distance outside the quartiles in quartile widths: negative below p25, positive above p75, 0 inside. */
const outsideQuartiles = (v: number, q: { p25: number; p75: number }): number => (v < q.p25 ? (v - q.p25) / (q.p75 - q.p25) : v > q.p75 ? (v - q.p75) / (q.p75 - q.p25) : 0);

describe('the default console against clinical optimal-window images (CAMUS Good)', () => {
  it('declared deviations name real conditions and metrics', () => {
    const real = new Set(CONDITIONS.flatMap(([k]) => CHECKED.map(([m]) => `${k}:${m}`)));
    expect([...KNOWN_DEVIATIONS.keys()].filter((d) => !real.has(d))).toEqual([]);
    // a baseline states which side of the quartiles the deviation is on
    expect([...KNOWN_DEVIATIONS.entries()].filter(([, b]) => b === 0)).toEqual([]);
  });

  it('apical grey levels, contrast and texture fall inside the clinical interquartile range', { timeout: 60_000 }, () => {
    const outside: string[] = [];
    const stale: string[] = [];
    const moved: string[] = [];
    for (const [key, view, ed] of CONDITIONS) {
      const stats = imageStats(presentApical(renderApical('normal-excellent-window', view, ed)));
      for (const [metric, get] of CHECKED) {
        const q = CAMUS_GOOD[key][metric];
        const v = get(stats);
        const d = outsideQuartiles(v, q);
        const id = `${key}:${metric}`;
        const baseline = KNOWN_DEVIATIONS.get(id);
        if (d !== 0 && baseline === undefined) outside.push(`${id} = ${v.toFixed(2)} outside [${q.p25}, ${q.p75}] (median ${q.median})`);
        if (d === 0 && baseline !== undefined) stale.push(`${id} = ${v.toFixed(2)} is inside [${q.p25}, ${q.p75}]`);
        if (d !== 0 && baseline !== undefined && Math.abs(d - baseline) > BASELINE_TOLERANCE)
          moved.push(`${id} = ${v.toFixed(2)}: ${d.toFixed(2)} quartile widths outside against a baseline of ${baseline} (${Math.abs(d) > Math.abs(baseline) ? 'regression' : 'improvement: lower the baseline'})`);
      }
    }
    // one assertion, so a failure lists undeclared, stale and moved entries together
    expect({ outside, stale, moved }, 'undeclared deviations from CAMUS Good, declared ones that no longer deviate, and declared ones that moved from their baseline').toEqual({ outside: [], stale: [], moved: [] });
  });
});
