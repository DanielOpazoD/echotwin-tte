import { describe, expect, it } from 'vitest';
import type { ImageStats } from '@/clinical/regionStats';
import { CAMUS_GOOD, type CamusMetric } from '@/clinical/reference-values/camusImageStats';
import { apicalStats, meanStat, renderApical } from './clinicalImage';

/**
 * The simulator against clinical optimal-window images (decisions 70 and 74). The excellent-window case, rendered and
 * measured exactly as tools/clinical/camus-compare.ts does, must fall inside the interquartile range of CAMUS apical
 * images rated Good for LV cavity, myocardium and left atrium grey, tissue/blood contrast, myocardial local std,
 * speckle-scale texture contrast of myocardium and blood pool, speckle cell size, and the shape of the grey scale —
 * skewness of the myocardial texture, growth of the local std with grey level and the white end (decision 90) — in
 * both apical views at end-diastole and end-systole.
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
  ['myocardialResidualSkew', (s) => s.myocardialResidualSkew],
  ['levelStdSlope', (s) => s.levelStdSlope],
  ['brightGreyP99', (s) => s.brightGreyP99],
];

const CONDITIONS = [
  ['4CH-ED', 'a4c', true],
  ['4CH-ES', 'a4c', false],
  ['2CH-ED', 'a2c', true],
  ['2CH-ES', 'a2c', false],
] as const;

/**
 * Deviations of the model, not of the console, each named in docs/LIMITATIONS.md. Tissue/blood contrast is nearly
 * constant across CAMUS Good (medians 40-44 in all four conditions) but spans 27 grey levels in the model, from 48
 * in A4C end-diastole to 21 in A2C end-systole, and no console moves both inside: gains from −4 to +2 dB and a 65 dB
 * range leave 4 to 7 conditions out and never fix either contrast (decision 70). The A2C walls run along the beam and
 * are the dimmest myocardium; the clinical grey map, which compresses the dim end, took A2C end-diastole contrast out
 * (36 → 31 against a quartile of 36) and deepened A2C end-systole (myocardium 88 → 79 and contrast 26 → 21) while it
 * brought A4C end-diastole myocardium and contrast inside (decision 91). A declaration that holds no longer fails the test, so the
 * list cannot outlive the defect.
 */
const KNOWN_DEVIATIONS: ReadonlyMap<string, number> = new Map([
  // Each entry holds its baseline: the signed distance outside the clinical quartiles, in quartile widths (negative
  // below the 25th percentile, positive above the 75th). A declared deviation used to be checked only for being
  // declared and not stale, so it could grow without limit (external audit F11, decision 88). Baselines measured with
  // the complex receiver noise and the clinical grey map, averaged over the noise realizations (decision 91).
  ['2CH-ED:contrast', -0.29],
  ['2CH-ES:myocardiumGrey', -0.42],
  ['2CH-ES:contrast', -1.31],
  // Texture (decisions 74 and 91, docs/LIMITATIONS.md): the speckle cell is 1.4-1.5 × 1.0 mm against 2.1 × 1.7 mm, so a
  // 5×5 window holds more of the texture variance than in a clinical image: local std 11.1-11.9 against upper quartiles of 10.1-11.3 while
  // the std against the ±4 mm mean is 16.1-17.2 against ~21 (ratio 0.69-0.70 against 0.45-0.51). The residuals keep a
  // log-Rayleigh tail of dark nulls (skewness −0.27 to −0.38 against +0.08 to +0.28). Receiver noise added as an
  // envelope hid part of this until decision 91: it filled the nulls (local std 9.3-9.7, texture contrast ~13) and its
  // per-sample grain shrank the cell to 1.2-1.35 × 0.9-1.0 mm. Widening the PSF matched these numbers and looked false
  // (dark worm-like nulls, granular blood); smoothing after detection lost the texture contrast (decision 74).
  ['4CH-ED:myocardialLocalStd', 0.69],
  ['4CH-ES:myocardialLocalStd', 0.22],
  ['2CH-ED:myocardialLocalStd', 0.95],
  ['2CH-ES:myocardialLocalStd', 0.23],
  ['4CH-ED:myocardialDetrendedStd', -0.49],
  ['4CH-ES:myocardialDetrendedStd', -0.55],
  ['2CH-ED:myocardialDetrendedStd', -0.46],
  ['2CH-ES:myocardialDetrendedStd', -0.48],
  ['4CH-ED:speckleCellHorizontalMm', -1.79],
  ['4CH-ES:speckleCellHorizontalMm', -2.23],
  ['2CH-ED:speckleCellHorizontalMm', -1.79],
  ['2CH-ES:speckleCellHorizontalMm', -2.46],
  ['4CH-ED:speckleCellVerticalMm', -2.18],
  ['4CH-ES:speckleCellVerticalMm', -2.26],
  ['2CH-ED:speckleCellVerticalMm', -1.96],
  ['2CH-ES:speckleCellVerticalMm', -1.93],
  // Shape of the grey scale (decisions 90-91). The slope of local std against grey level and the white end came inside
  // with the clinical grey map; the skewness of the myocardial residuals rose from −0.35..−0.51 but is still negative.
  ['4CH-ED:myocardialResidualSkew', -0.88],
  ['4CH-ES:myocardialResidualSkew', -0.84],
  ['2CH-ED:myocardialResidualSkew', -0.73],
  ['2CH-ES:myocardialResidualSkew', -0.35],
]);

/**
 * How far a declared deviation may move from its baseline, in quartile widths, before the test asks for attention: a
 * regression beyond it fails, and so does an improvement beyond it, until the baseline is lowered — so the bound always
 * sits near the best the model has reached.
 */
const BASELINE_TOLERANCE = 0.15;

/**
 * A value this close outside a quartile, in quartile widths, counts as on its edge: neither an undeclared deviation nor
 * a declared one (decision 91). The statistics are means over NOISE_REALIZATIONS receiver-noise realizations, whose
 * standard error reaches 0.07 quartile widths (single-frame sd up to 0.14 for the local std over six realizations), so a
 * value 0.004 outside (A2C end-systole slope 7.21 against 7.2) cannot say which side it is on.
 */
const QUARTILE_EDGE = 0.1;

/** Signed distance outside the quartiles in quartile widths: negative below p25, positive above p75, 0 inside. */
const outsideQuartiles = (v: number, q: { p25: number; p75: number }): number => (v < q.p25 ? (v - q.p25) / (q.p75 - q.p25) : v > q.p75 ? (v - q.p75) / (q.p75 - q.p25) : 0);

describe('the default console against clinical optimal-window images (CAMUS Good)', () => {
  it('declared deviations name real conditions and metrics', () => {
    const real = new Set(CONDITIONS.flatMap(([k]) => CHECKED.map(([m]) => `${k}:${m}`)));
    expect([...KNOWN_DEVIATIONS.keys()].filter((d) => !real.has(d))).toEqual([]);
    // a baseline states which side of the quartiles the deviation is on
    expect([...KNOWN_DEVIATIONS.entries()].filter(([, b]) => Math.abs(b) < QUARTILE_EDGE)).toEqual([]);
  });

  it('apical grey levels, contrast and texture fall inside the clinical interquartile range', { timeout: 60_000 }, () => {
    const outside: string[] = [];
    const stale: string[] = [];
    const moved: string[] = [];
    for (const [key, view, ed] of CONDITIONS) {
      const stats = apicalStats(renderApical('normal-excellent-window', view, ed));
      for (const [metric, get] of CHECKED) {
        const q = CAMUS_GOOD[key][metric];
        const v = meanStat(stats, get);
        const raw = outsideQuartiles(v, q);
        const d = Math.abs(raw) < QUARTILE_EDGE ? 0 : raw;
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
