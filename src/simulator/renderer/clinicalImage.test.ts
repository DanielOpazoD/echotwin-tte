// @tier slow
import { describe, expect, it } from 'vitest';
import type { ImageStats } from '@/clinical/regionStats';
import { apicalGeometry } from '@/clinical/apicalGeometry';
import {
  CAMUS_GOOD_GEOMETRY,
  type ApicalGeometryMetric,
} from '@/clinical/reference-values/camusApicalGeometry';
import { CAMUS_GOOD, type CamusMetric } from '@/clinical/reference-values/camusImageStats';
import { CAMUS_GOOD_SECTOR } from '@/clinical/reference-values/camusSectorStats';
import { SECTOR_METRICS, sectorStats } from '@/clinical/sectorStats';
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
 * stayed above the upper quartile (51 against 47). From the apical probe of decision 139 every wall is seen at about
 * 20° and the three came inside (A4C end-diastole contrast 48, A2C end-systole myocardium 99 and contrast 41). A
 * declaration that holds no longer fails the test, so the list cannot outlive the defect.
 */
const KNOWN_DEVIATIONS: ReadonlyMap<string, number> = new Map([
  // Each entry holds its baseline: the signed distance outside the clinical quartiles, in quartile widths (negative
  // below the 25th percentile, positive above the 75th). A declared deviation used to be checked only for being
  // declared and not stale, so it could grow without limit (external audit F11, decision 88). Baselines measured with
  // the complex receiver noise and the clinical grey map, averaged over the noise realizations (decision 91);
  // re-baselined under the fibre-orientation model of decision 123.
  // Texture (decisions 74 and 91, docs/LIMITATIONS.md): the speckle cell is 1.4-1.5 × 1.0 mm against 2.1 × 1.7 mm, so a
  // 5×5 window holds more of the texture variance than in a clinical image: local std 11.7-12.4 against upper quartiles of 10.1-11.3 while
  // the std against the ±4 mm mean is 16.1-17.2 against ~21 (ratio 0.69-0.70 against 0.45-0.51). The fibre-orientation
  // anisotropy of decision 123 added ~0.4-0.5 quartile widths to the local std: a single beam holds the gain gradient
  // along a curving wall that spatial compounding averages out in a clinical image. The residuals keep a
  // log-Rayleigh tail of dark nulls (skewness −0.27 to −0.38 against +0.08 to +0.28). Receiver noise added as an
  // envelope hid part of this until decision 91: it filled the nulls (local std 9.3-9.7, texture contrast ~13) and its
  // per-sample grain shrank the cell to 1.2-1.35 × 0.9-1.0 mm. Widening the PSF matched these numbers and looked false
  // (dark worm-like nulls, granular blood); smoothing after detection lost the texture contrast (decision 74).
  // Texture under the compounding and grains of decision 145 (docs/LIMITATIONS.md): two looks averaged after detection,
  // coherent grains integrated over the slice and a 1.35× axial pulse put the speckle cell (2.0-2.3 × 1.7-1.9 mm), the
  // residual skewness (+0.18 to +0.30) and the end-diastolic local std inside the clinical quartiles; the end-systolic
  // local std sits under them (8.6-8.7 against 9.1-9.5), the variance against the ±4 mm mean stays short (15-17.4
  // against 18.4-24: the clinical grain is more contrasted at 2-4 mm than a thresholded lattice) and the slope of local
  // std against grey level with it (3.6-4.2 against 4.2-5.7 lower quartiles).
  ['4CH-ES:myocardialLocalStd', -0.43],
  ['2CH-ES:myocardialLocalStd', -0.32],
  ['4CH-ED:myocardialDetrendedStd', -0.45],
  ['4CH-ES:myocardialDetrendedStd', -0.89],
  ['2CH-ED:myocardialDetrendedStd', -0.52],
  ['2CH-ES:myocardialDetrendedStd', -0.73],
  ['4CH-ED:levelStdSlope', -0.12],
  ['4CH-ES:levelStdSlope', -0.65],
  ['2CH-ES:levelStdSlope', -0.11],
  // Contrast under the environment of decision 144 (docs/LIMITATIONS.md): the console the CAMUS sweep chose with the
  // focused beam (0.7 dB/cm/MHz) lifts the mid-field walls to 106 while the cavity, read at the receiver's lower noise
  // floor, stays at 50: 57 grey levels of contrast against 40 [33-47] in the 4CH and 56 against 44 [36-53] in the 2CH
  // at end-diastole; at end-systole both are inside.
  ['4CH-ED:contrast', 0.73],
  ['2CH-ED:contrast', 0.16],
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
 * quartile widths like KNOWN_DEVIATIONS. Until decision 139 the A4C probe sat 2.6 cm septal of the LV long axis and
 * eighteen of these were declared: the apex 19 mm lateral of the centre line (0 in CAMUS Good), the septum along its scan
 * lines (3.5° against 21°), the lateral wall oblique (32° against 17°) and the septum 46 grey levels darker than the
 * lateral wall (+35 in CAMUS Good). With the long axis where cardiac MRI puts it and the apical probe looking down it,
 * fourteen fall inside the clinical interquartile range (four-chamber end-diastole: apex 3.2 mm from the centre line at
 * 26.9 mm, axis 5.7°, walls at 22° and 19°). What stays outside: the septum is as bright as the lateral wall at
 * end-diastole, not brighter (+2 grey levels against +13 to +53); at end-systole the axis tilts 8° (0.3–6.9) and the
 * septum stands 21° to its scan lines (8–20); and the two-chamber axis tilts 1.5° at end-diastole against 3.8–10.8°.
 */
const KNOWN_GEOMETRY_DEVIATIONS: ReadonlyMap<string, number> = new Map([
  ['4CH-ED:septalMinusLateralGrey', -0.28],
  ['4CH-ES:axisTiltDeg', 0.16],
  ['4CH-ES:septalRayAngleDeg', 0.11],
  ['2CH-ED:axisTiltDeg', -0.33],
]);

/**
 * The whole sector against CAMUS Good, without labels (decision 146), baselines in quartile widths like KNOWN_DEVIATIONS.
 * These are the statistics that told twelve blind-test tiles apart when the LV statistics could not, so each entry is a
 * named visual defect: the sector holds black pixels where a clinical image never does (its cavities and background
 * keep a haze above grey 20), it is sharper (gradients 1.5× the clinical median) and drawn with thin bright lines, its
 * texture is longer along the beam at 1 mm and more coherent across it at 8 mm, its near field (0–2 cm) is brighter and
 * its cavity band (4–6 cm) darker, and the outer sector is brighter against the centre. Filled in at decision 146 from
 * the first measurement; each is a target of phases 1–3 of the fidelity plan.
 */
const KNOWN_SECTOR_DEVIATIONS: ReadonlyMap<string, number> = new Map([
  // black pixels where a clinical image has none (its cavities and background keep a haze above grey 20)
  ['4CH-ED:darkFraction', 2.1],
  ['4CH-ES:darkFraction', 0.77],
  ['2CH-ED:darkFraction', 1.78],
  ['2CH-ES:darkFraction', 1.27],
  ['2CH-ED:bandDark0', 0.22],
  ['2CH-ES:bandDark0', 0.22],
  ['4CH-ED:bandDark2', 0.44],
  ['4CH-ES:bandDark2', 0.44],
  ['2CH-ED:bandDark2', 0.67],
  ['2CH-ES:bandDark2', 1.22],
  ['4CH-ED:bandDark4', 3.9],
  ['4CH-ES:bandDark4', 3.23],
  ['2CH-ED:bandDark4', 4.96],
  ['2CH-ES:bandDark4', 4.81],
  ['4CH-ED:bandDark6', 27.9],
  ['4CH-ES:bandDark6', 2.58],
  ['2CH-ED:bandDark6', 30.69],
  ['2CH-ES:bandDark6', 30.38],
  ['4CH-ED:bandDark8', 13.94],
  ['4CH-ES:bandDark8', 1.63],
  ['2CH-ED:bandDark8', 12.78],
  ['2CH-ES:bandDark8', 1.47],
  ['4CH-ED:bandDark10', 0.35],
  ['4CH-ES:bandDark10', 1.18],
  ['2CH-ED:bandDark10', 0.21],
  ['2CH-ES:bandDark10', 1.24],
  // sharper than clinical (gradients 1.4-1.5× the median) and drawn with thin bright lines
  ['4CH-ED:gradientP50', 2.51],
  ['4CH-ES:gradientP50', 2.52],
  ['2CH-ED:gradientP50', 3.09],
  ['2CH-ES:gradientP50', 2.42],
  ['4CH-ED:gradientP95', 0.92],
  ['4CH-ES:gradientP95', 0.66],
  ['2CH-ED:gradientP95', 1.11],
  ['2CH-ES:gradientP95', 0.76],
  ['4CH-ED:ridgeFraction', 1.97],
  ['4CH-ES:ridgeFraction', 1.71],
  ['2CH-ED:ridgeFraction', 0.97],
  ['2CH-ES:ridgeFraction', 0.18],
  // more texture contrast over the whole sector: the blood pool and background are grainier than the clinical haze
  ['4CH-ED:localStd', 0.11],
  ['4CH-ED:detrendedStd', 0.5],
  ['2CH-ED:detrendedStd', 0.47],
  // texture longer along the beam at 1 mm (0.31-0.35 against 0.20-0.23) and, in the 2CH, less coherent across it at 2-4 mm
  ['4CH-ED:radialCorr1', 1.33],
  ['4CH-ES:radialCorr1', 0.59],
  ['2CH-ED:radialCorr1', 1.72],
  ['2CH-ES:radialCorr1', 1.17],
  ['2CH-ED:radialCorr2', 0.26],
  ['4CH-ED:radialCorr4', -0.15],
  ['4CH-ES:radialCorr4', -0.24],
  ['2CH-ED:radialCorr4', 0.23],
  ['2CH-ES:radialCorr4', 0.15],
  ['4CH-ES:radialCorr8', -0.16],
  ['2CH-ED:radialCorr8', -0.34],
  ['2CH-ES:radialCorr8', -0.88],
  ['2CH-ED:tangentialCorr2', -0.2],
  ['2CH-ES:tangentialCorr2', -0.11],
  ['4CH-ES:tangentialCorr4', -0.21],
  ['2CH-ED:tangentialCorr4', -1.08],
  ['2CH-ES:tangentialCorr4', -0.99],
  ['4CH-ED:tangentialCorr8', 0.77],
  ['2CH-ES:tangentialCorr8', -0.35],
  // near field (0-2 cm) brighter (141-154 against 105-115) and the cavity bands (4-10 cm) darker than clinical
  ['4CH-ED:bandGrey0', 0.53],
  ['4CH-ES:bandGrey0', 0.76],
  ['2CH-ED:bandGrey0', 0.24],
  ['2CH-ES:bandGrey0', 0.55],
  ['4CH-ED:bandGrey4', -0.27],
  ['4CH-ES:bandGrey4', -0.2],
  ['2CH-ED:bandGrey4', -0.5],
  ['2CH-ES:bandGrey4', -0.83],
  ['4CH-ES:bandGrey6', -0.25],
  ['2CH-ED:bandGrey6', -0.26],
  ['2CH-ES:bandGrey6', -0.35],
  ['4CH-ES:bandGrey8', -0.29],
  ['2CH-ED:bandGrey8', -0.15],
  ['2CH-ES:bandGrey8', -0.31],
  // a duller bright end at end-systole and, in the 4CH, an outer sector brighter against the centre
  ['2CH-ES:greyP75', -0.1],
  ['4CH-ES:greyP95', -0.14],
  ['2CH-ES:greyP95', -0.15],
  ['4CH-ED:edgeRollOff', 0.12],
  ['2CH-ED:edgeRollOff', -0.27],
  ['2CH-ES:edgeRollOff', -0.43],
]);

/**
 * Signed distance outside the quartiles in quartile widths: negative below p25, positive above p75, 0 inside. A metric
 * the clinical images hold constant (the fraction of black pixels is 0 in three images of four) has no quartile width;
 * its unit is then the 10th–90th percentile spread or, failing that too, one hundredth of the median (at least 0.01).
 */
const outsideQuartiles = (
  v: number,
  q: { p25: number; p75: number; median: number; p10?: number; p90?: number },
): number => {
  const width =
    q.p75 - q.p25 > 0
      ? q.p75 - q.p25
      : Math.max((q.p90 ?? 0) - (q.p10 ?? 0), 0.01 * Math.max(1, Math.abs(q.median)));
  return v < q.p25 ? (v - q.p25) / width : v > q.p75 ? (v - q.p75) / width : 0;
};

/** Undeclared, stale and moved entries of one condition's measured values against a reference and its declarations. */
function audit(
  key: string,
  values: [
    string,
    number,
    { p25: number; p75: number; median: number; p10?: number; p90?: number },
  ][],
  declared: ReadonlyMap<string, number>,
  out: { outside: string[]; stale: string[]; moved: string[] },
): void {
  for (const [metric, v, q] of values) {
    const raw = outsideQuartiles(v, q);
    const d = Math.abs(raw) < QUARTILE_EDGE ? 0 : raw;
    const id = `${key}:${metric}`;
    const baseline = declared.get(id);
    if (d !== 0 && baseline === undefined)
      out.outside.push(
        `${id} = ${v.toFixed(3)} outside [${q.p25}, ${q.p75}] (median ${q.median}): ${d.toFixed(2)} quartile widths`,
      );
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
    const realSector = new Set(
      CONDITIONS.flatMap(([k]) => Object.keys(CAMUS_GOOD_SECTOR[k]).map((m) => `${k}:${m}`)),
    );
    expect([...KNOWN_SECTOR_DEVIATIONS.keys()].filter((d) => !realSector.has(d))).toEqual([]);
    expect(
      [...KNOWN_SECTOR_DEVIATIONS.entries()].filter(([, b]) => Math.abs(b) < QUARTILE_EDGE),
    ).toEqual([]);
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
    'the whole sector, without labels, reads like clinical images or deviates as declared',
    { timeout: 240_000 },
    () => {
      const out = { outside: [] as string[], stale: [] as string[], moved: [] as string[] };
      for (const [key, view, ed] of CONDITIONS) {
        const g = renderOnce(view, ed).flatMap((r) =>
          Array.from({ length: NOISE_REALIZATIONS }, (_, fi) =>
            sectorStats(presentApical(r, {}, fi)),
          ),
        );
        const ref = CAMUS_GOOD_SECTOR[key];
        audit(
          key,
          SECTOR_METRICS.filter((m) => ref[m]).map((m) => [
            m,
            g.reduce((a, x) => a + x[m], 0) / g.length,
            ref[m]!,
          ]),
          KNOWN_SECTOR_DEVIATIONS,
          out,
        );
      }
      expect(out, 'undeclared, stale and moved whole-sector deviations from CAMUS Good').toEqual({
        outside: [],
        stale: [],
        moved: [],
      });
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
            g.reduce((a, x) => a + x[m], 0) / g.length,
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
