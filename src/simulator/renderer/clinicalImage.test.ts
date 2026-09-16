// @tier slow
import { describe, expect, it } from 'vitest';
import type { ImageStats } from '@/clinical/regionStats';
import { apicalGeometry, type ApicalGeometry } from '@/clinical/apicalGeometry';
import {
  CAMUS_GOOD_GEOMETRY,
  type ApicalGeometryMetric,
} from '@/clinical/reference-values/camusApicalGeometry';
import { CAMUS_GOOD, type CamusMetric } from '@/clinical/reference-values/camusImageStats';
import {
  apicalStats,
  meanStat,
  NOISE_REALIZATIONS,
  presentApical,
  renderApicalRealizations,
  type ApicalRender,
} from './clinicalImage';

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

/** Each condition is rendered once per scatterer realization for both tests. */
const renders = new Map<string, ApicalRender[]>();
const renderOnce = (view: 'a4c' | 'a2c', ed: boolean): ApicalRender[] => {
  const key = `${view}|${ed}`;
  if (!renders.has(key))
    renders.set(key, renderApicalRealizations('normal-excellent-window', view, ed));
  return renders.get(key)!;
};

/**
 * Deviations of the model, not of the console, each named in docs/LIMITATIONS.md. Tissue/blood contrast is nearly
 * constant across CAMUS Good (medians 40-44 in all four conditions) but spans 30 grey levels in the model, from 51
 * in A4C end-diastole to 21 in A2C end-systole, and no console moves both inside: gains from −4 to +2 dB and a 65 dB
 * range leave 4 to 7 conditions out and never fix either contrast (decision 70). The fibre-orientation anisotropy of
 * decision 123 keeps the beam-parallel apical walls bright, which brought A2C end-diastole contrast inside (38
 * against quartiles 36-53) and A2C end-systole myocardium and contrast closer, while the A4C end-diastole contrast
 * stayed above the upper quartile (51 against 47, within the p90 of 53): without spatial compounding the
 * perpendicular walls hold their full backscatter. A declaration that holds no longer fails the test, so the
 * list cannot outlive the defect.
 */
const KNOWN_DEVIATIONS: ReadonlyMap<string, number> = new Map([
  // Each entry holds its baseline: the signed distance outside the clinical quartiles, in quartile widths (negative
  // below the 25th percentile, positive above the 75th). A declared deviation used to be checked only for being
  // declared and not stale, so it could grow without limit (external audit F11, decision 88). Baselines measured with
  // the complex receiver noise and the clinical grey map, averaged over the noise realizations (decision 91);
  // re-baselined under the fibre-orientation model of decision 123.
  ['4CH-ED:contrast', 0.3],
  ['2CH-ES:myocardiumGrey', -0.19],
  ['2CH-ES:contrast', -0.83],
  // Texture (decisions 74 and 91, docs/LIMITATIONS.md): the speckle cell is 1.4-1.5 × 1.0 mm against 2.1 × 1.7 mm, so a
  // 5×5 window holds more of the texture variance than in a clinical image: local std 11.7-12.4 against upper quartiles of 10.1-11.3 while
  // the std against the ±4 mm mean is 16.1-17.2 against ~21 (ratio 0.69-0.70 against 0.45-0.51). The fibre-orientation
  // anisotropy of decision 123 added ~0.4-0.5 quartile widths to the local std: a single beam holds the gain gradient
  // along a curving wall that spatial compounding averages out in a clinical image. The residuals keep a
  // log-Rayleigh tail of dark nulls (skewness −0.27 to −0.38 against +0.08 to +0.28). Receiver noise added as an
  // envelope hid part of this until decision 91: it filled the nulls (local std 9.3-9.7, texture contrast ~13) and its
  // per-sample grain shrank the cell to 1.2-1.35 × 0.9-1.0 mm. Widening the PSF matched these numbers and looked false
  // (dark worm-like nulls, granular blood); smoothing after detection lost the texture contrast (decision 74).
  ['4CH-ED:myocardialLocalStd', 1.02],
  ['4CH-ES:myocardialLocalStd', 0.54],
  ['2CH-ED:myocardialLocalStd', 1.49],
  ['2CH-ES:myocardialLocalStd', 0.59],
  ['4CH-ED:myocardialDetrendedStd', -0.49],
  ['4CH-ES:myocardialDetrendedStd', -0.55],
  ['2CH-ED:myocardialDetrendedStd', -0.46],
  ['2CH-ES:myocardialDetrendedStd', -0.48],
  ['4CH-ED:speckleCellHorizontalMm', -1.61],
  ['4CH-ES:speckleCellHorizontalMm', -2.23],
  ['2CH-ED:speckleCellHorizontalMm', -1.59],
  ['2CH-ES:speckleCellHorizontalMm', -2.46],
  ['4CH-ED:speckleCellVerticalMm', -2.18],
  ['4CH-ES:speckleCellVerticalMm', -2.26],
  ['2CH-ED:speckleCellVerticalMm', -1.96],
  ['2CH-ES:speckleCellVerticalMm', -1.93],
  // Shape of the grey scale (decisions 90-91). The slope of local std against grey level and the white end came inside
  // with the clinical grey map; the skewness of the myocardial residuals rose from −0.35..−0.51 but is still negative.
  ['4CH-ED:myocardialResidualSkew', -0.88],
  ['4CH-ES:myocardialResidualSkew', -1.11],
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
 * a declared one (decision 91). The statistics are means over SPECKLE_REALIZATIONS scatterer realizations, each presented
 * with NOISE_REALIZATIONS receiver-noise realizations (decision 99): a single realization of the speckle moved the local
 * std and the residual skew by up to 0.33 quartile widths while their ten-realization means stayed within 0.12, so a value
 * 0.004 outside (A2C end-systole slope 7.21 against 7.2) cannot say which side it is on.
 */
const QUARTILE_EDGE = 0.1;

/**
 * Where the left ventricle sits in the apical images against the sector (decision 92, docs/LIMITATIONS.md), baselines in
 * quartile widths like KNOWN_DEVIATIONS. The A4C probe sits 2.6 cm septal of the LV long axis, so the apex lies 47° off
 * the centre line (19 mm lateral in the image against 0 in CAMUS Good): the septum runs along its scan lines (3.5° against
 * 21°), whose path crosses 3.6 cm of myocardium before the mid-septum, the lateral wall is seen obliquely (32° against
 * 17°), and the septum comes out darker than the lateral wall (−46 grey levels at end-diastole, −28 at end-systole,
 * against +35 and +24 in CAMUS Good; the fibre-orientation anisotropy of decision 123 brightened both walls relative
 * to the wall-normal model). The A2C apex lies on the
 * other side of the centre line from the clinical one, with the axis tilted the other way and 6-9 mm deeper.
 */
const KNOWN_GEOMETRY_DEVIATIONS: ReadonlyMap<string, number> = new Map([
  ['4CH-ED:apexOffsetMm', 2.25],
  ['4CH-ED:apexDepthMm', -0.11],
  ['4CH-ED:axisTiltDeg', -0.63],
  ['4CH-ED:septalRayAngleDeg', -0.97],
  ['4CH-ED:lateralRayAngleDeg', 1.42],
  ['4CH-ED:septalMinusLateralGrey', -1.47],
  ['4CH-ES:apexOffsetMm', 1.72],
  ['4CH-ES:apexDepthMm', -0.46],
  ['4CH-ES:axisTiltDeg', -0.43],
  ['4CH-ES:septalRayAngleDeg', -0.52],
  ['4CH-ES:lateralRayAngleDeg', 1.21],
  ['4CH-ES:septalMinusLateralGrey', -0.93],
  ['2CH-ED:apexOffsetMm', 1.23],
  ['2CH-ED:apexDepthMm', 0.2],
  ['2CH-ED:axisTiltDeg', -0.9],
  ['2CH-ES:apexOffsetMm', 0.46],
  ['2CH-ES:apexDepthMm', 0.34],
  ['2CH-ES:axisTiltDeg', -0.55],
]);

/** Signed distance outside the quartiles in quartile widths: negative below p25, positive above p75, 0 inside. */
const outsideQuartiles = (v: number, q: { p25: number; p75: number }): number =>
  v < q.p25 ? (v - q.p25) / (q.p75 - q.p25) : v > q.p75 ? (v - q.p75) / (q.p75 - q.p25) : 0;

/** Undeclared, stale and moved entries of one condition's measured values against a reference and its declarations. */
function audit(
  key: string,
  values: [string, number, { p25: number; p75: number; median: number }][],
  declared: ReadonlyMap<string, number>,
  out: { outside: string[]; stale: string[]; moved: string[] },
): void {
  for (const [metric, v, q] of values) {
    const raw = outsideQuartiles(v, q);
    const d = Math.abs(raw) < QUARTILE_EDGE ? 0 : raw;
    const id = `${key}:${metric}`;
    const baseline = declared.get(id);
    if (d !== 0 && baseline === undefined)
      out.outside.push(`${id} = ${v.toFixed(2)} outside [${q.p25}, ${q.p75}] (median ${q.median})`);
    if (d === 0 && baseline !== undefined)
      out.stale.push(`${id} = ${v.toFixed(2)} is inside [${q.p25}, ${q.p75}]`);
    if (d !== 0 && baseline !== undefined && Math.abs(d - baseline) > BASELINE_TOLERANCE)
      out.moved.push(
        `${id} = ${v.toFixed(2)}: ${d.toFixed(2)} quartile widths outside against a baseline of ${baseline} (${Math.abs(d) > Math.abs(baseline) ? 'regression' : 'improvement: lower the baseline'})`,
      );
  }
}

describe('the default console against clinical optimal-window images (CAMUS Good)', () => {
  it('declared deviations name real conditions and metrics', () => {
    const real = new Set(CONDITIONS.flatMap(([k]) => CHECKED.map(([m]) => `${k}:${m}`)));
    expect([...KNOWN_DEVIATIONS.keys()].filter((d) => !real.has(d))).toEqual([]);
    const realGeometry = new Set(
      CONDITIONS.flatMap(([k]) => Object.keys(CAMUS_GOOD_GEOMETRY[k]).map((m) => `${k}:${m}`)),
    );
    expect([...KNOWN_GEOMETRY_DEVIATIONS.keys()].filter((d) => !realGeometry.has(d))).toEqual([]);
    expect(
      [...KNOWN_GEOMETRY_DEVIATIONS.entries()].filter(([, b]) => Math.abs(b) < QUARTILE_EDGE),
    ).toEqual([]);
    // a baseline states which side of the quartiles the deviation is on
    expect([...KNOWN_DEVIATIONS.entries()].filter(([, b]) => Math.abs(b) < QUARTILE_EDGE)).toEqual(
      [],
    );
  });

  it(
    'apical grey levels, contrast and texture fall inside the clinical interquartile range',
    { timeout: 360_000 },
    () => {
      const out = { outside: [] as string[], stale: [] as string[], moved: [] as string[] };
      for (const [key, view, ed] of CONDITIONS) {
        const stats = renderOnce(view, ed).flatMap((r) => apicalStats(r));
        audit(
          key,
          CHECKED.map(([metric, get]) => [metric, meanStat(stats, get), CAMUS_GOOD[key][metric]]),
          KNOWN_DEVIATIONS,
          out,
        );
      }
      // one assertion, so a failure lists undeclared, stale and moved entries together
      expect(
        out,
        'undeclared deviations from CAMUS Good, declared ones that no longer deviate, and declared ones that moved from their baseline',
      ).toEqual({ outside: [], stale: [], moved: [] });
    },
  );

  it(
    'the left ventricle sits in the apical sector where clinical images put it',
    { timeout: 180_000 },
    () => {
      const out = { outside: [] as string[], stale: [] as string[], moved: [] as string[] };
      for (const [key, view, ed] of CONDITIONS) {
        const g = renderOnce(view, ed).flatMap((r) =>
          Array.from({ length: NOISE_REALIZATIONS }, (_, fi) =>
            apicalGeometry(presentApical(r, {}, fi), key.startsWith('4CH') ? '4CH' : '2CH'),
          ),
        );
        const ref = CAMUS_GOOD_GEOMETRY[key];
        audit(
          key,
          (Object.keys(ref) as ApicalGeometryMetric[]).map((m) => [
            m,
            g.reduce((a, x) => a + x[m as keyof ApicalGeometry], 0) / g.length,
            ref[m]!,
          ]),
          KNOWN_GEOMETRY_DEVIATIONS,
          out,
        );
      }
      expect(out, 'undeclared, stale and moved apical geometry deviations from CAMUS Good').toEqual(
        { outside: [], stale: [], moved: [] },
      );
    },
  );
});
