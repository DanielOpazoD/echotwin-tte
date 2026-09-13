import { describe, expect, it } from 'vitest';
import { imageStats, type ImageStats } from '@/clinical/regionStats';
import { CAMUS_GOOD, type CamusMetric } from '@/clinical/reference-values/camusImageStats';
import { presentApical, renderApical } from './clinicalImage';

/**
 * The default console against clinical optimal-window images (decision 70). The excellent-window case, rendered and
 * measured exactly as tools/clinical/camus-compare.ts does, must fall inside the interquartile range of CAMUS apical
 * images rated Good for LV cavity, myocardium and left atrium grey, tissue/blood contrast and myocardial local
 * texture, in both apical views at end-diastole and end-systole.
 *
 * The speckle cell is not checked: the simulator's is about half the clinical one (≈1 mm against ≈2 mm), a texture
 * defect of image formation and post-processing tracked in docs/LIMITATIONS.md, not something a console can set.
 */
const CHECKED: [CamusMetric, (s: ImageStats) => number][] = [
  ['cavityGrey', (s) => s.cavity.median],
  ['myocardiumGrey', (s) => s.myocardium.median],
  ['atriumGrey', (s) => s.atrium.median],
  ['contrast', (s) => s.tissueBloodContrast],
  ['myocardialLocalStd', (s) => s.myocardialLocalStd],
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
const KNOWN_DEVIATIONS: ReadonlySet<string> = new Set(['4CH-ED:myocardiumGrey', '4CH-ED:contrast', '2CH-ES:atriumGrey', '2CH-ES:contrast']);

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
