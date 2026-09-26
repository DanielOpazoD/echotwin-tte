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
  // std against grey level with it (3.6-4.2 against 4.2-5.7 lower quartiles). With the probe on the long axis (decision
  // 215) the four-chamber walls run closer to their scan lines and their residual texture fell 0.2 widths further.
  ['4CH-ES:myocardialLocalStd', -0.43],
  ['2CH-ES:myocardialLocalStd', -0.32],
  ['4CH-ED:myocardialDetrendedStd', -0.64],
  ['4CH-ES:myocardialDetrendedStd', -1.08],
  ['2CH-ED:myocardialDetrendedStd', -0.52],
  ['2CH-ES:myocardialDetrendedStd', -0.73],
  // −0.12 → −0.28 at decision 227, and 2CH-ES out: the chordae, drawn as bright rods until then, lifted the texture of
  // the mid cavity; as thin cords they leave it a little darker and more uniform than CAMUS Good, at the quartiles' edge
  ['4CH-ED:levelStdSlope', -0.28],
  ['4CH-ES:levelStdSlope', -0.65],
  ['2CH-ES:levelStdSlope', -0.14],
  ['4CH-ES:cavityGrey', -0.1],
  ['2CH-ED:cavityDetrendedStd', -0.13],
  ['2CH-ES:cavityDetrendedStd', -0.2],
  // Contrast under the environment of decision 144 (docs/LIMITATIONS.md): the console the CAMUS sweep chose with the
  // focused beam (0.7 dB/cm/MHz) lifts the mid-field walls to 106 while the cavity, read at the receiver's lower noise
  // floor, stays at 50: 57 grey levels of contrast against 40 [33-47] in the 4CH and 56 against 44 [36-53] in the 2CH
  // at end-diastole (59 with the probe on the long axis, decision 215); at end-systole both are inside.
  ['4CH-ED:contrast', 0.73],
  ['2CH-ED:contrast', 0.34],
  // the horizontal speckle cell of the myocardium sits at the edge of the clinical range: 4CH end-diastole came inside
  // with the probe on the long axis (decision 215), and both end-systolic cells fall under it (1.96 against 1.98-2.0 mm)
  ['4CH-ES:speckleCellHorizontalMm', -0.14],
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
 * 26.9 mm, axis 5.7°, walls at 22° and 19°). With the probe on the long axis (decision 215) the four-chamber axis and
 * septum came inside at end-systole too (2.0° and 17°). What stays outside: the septum is darker than the lateral wall,
 * not brighter (−10 and −3 grey levels against +13 to +53), and the two-chamber view. There CAMUS images show the apex
 * 4–7 mm to one side of the centre line and the base 6° to the other, a probe off the axis; with the probe on it the apex
 * sits on the line (0.3–0.5 mm) and the axis along it (0.1–0.5°), and leaning the sector moves both to the same side.
 */
const KNOWN_GEOMETRY_DEVIATIONS: ReadonlyMap<string, number> = new Map([
  ['4CH-ED:septalMinusLateralGrey', -0.58],
  ['2CH-ED:axisTiltDeg', -0.48],
  ['4CH-ES:septalMinusLateralGrey', -0.22],
  ['2CH-ED:apexOffsetMm', 0.63],
  ['2CH-ES:apexOffsetMm', 0.21],
  ['2CH-ES:axisTiltDeg', -0.31],
]);

/**
 * The whole sector against CAMUS Good, without labels (decision 146), baselines in quartile widths like KNOWN_DEVIATIONS.
 * These are the statistics that told twelve blind-test tiles apart when the LV statistics could not, so each entry is a
 * named visual defect: the sector holds black pixels where a clinical image never does (its cavities and background
 * keep a haze above grey 20), it is sharper (gradients 1.5× the clinical median) and drawn with thin bright lines, its
 * texture is longer along the beam at 1 mm and more coherent across it at 8 mm, its cavity band (4–6 cm) is darker, and
 * the outer sector darker against the centre. Filled in at decision 146 from the first measurement; each is a target of
 * phases 1–3 of the fidelity plan. The near field came inside at decision 156.
 */
const KNOWN_SECTOR_DEVIATIONS: ReadonlyMap<string, number> = new Map([
  // black pixels where a clinical image has none (its cavities and background keep a haze above grey 20)
  ['4CH-ED:darkFraction', 1.93],
  // the right ventricle contracts in systole since decision 220 and leaves less black blood in the four-chamber view
  ['4CH-ES:darkFraction', 0.39],
  ['4CH-ED:bandDark2', 0.44],
  ['4CH-ES:bandDark2', 0.44],
  ['2CH-ED:bandDark2', 0.14],
  ['2CH-ES:bandDark2', 0.24],
  ['4CH-ED:bandDark4', 3.72],
  // decision 225: the papillary muscles rose 0.6-0.8 cm toward the base, and the mid-cavity bands they crossed are blacker
  ['4CH-ES:bandDark4', 2.83],
  ['2CH-ED:bandDark4', 2.67],
  ['2CH-ES:bandDark4', 2.32],
  ['4CH-ED:bandDark6', 27.45],
  ['4CH-ES:bandDark6', 1.2],
  ['2CH-ED:bandDark6', 6.66],
  ['2CH-ES:bandDark6', 3.85],
  ['4CH-ED:bandDark8', 12.12],
  // up from 1.63 at decision 220: the contracted right ventricle leaves the atria deeper in the sector at end-systole
  ['4CH-ES:bandDark8', 1.86],
  // decision 221: the A-lines that lit this band at oblique incidence are gone
  ['2CH-ED:bandDark8', 1.31],
  ['2CH-ES:bandDark8', 0.22],
  // the rib shadow over the inferior side of the two-chamber sector went away with the probe on the long axis (decision
  // 215): dark pixels at 4-8 cm fell from 5-31 quartile widths to 0.2-6.7
  ['4CH-ED:bandDark10', 0.35],
  // 1.18 → 1.35 with the RV body contracting 0.42 (decision 214): 0.0044 → 0.0047 of the band's pixels dark, against
  // CAMUS Good median 0, p75 0.002 and p90 0.015 — an IQR of 0.002 turns 0.0003 into 0.17 widths
  // decision 221: the A-lines that lit this band at oblique incidence are gone
  ['4CH-ES:bandDark10', 1.14],
  ['2CH-ED:bandDark10', 0.21],
  // decision 221: the A-lines that lit this band at oblique incidence are gone
  ['2CH-ES:bandDark10', 0.73],
  // sharper than clinical (gradients 1.4-1.5× the median) and drawn with thin bright lines; less so since decision 221,
  // when the A-lines at oblique incidence went (median gradient 2.2-2.9 quartile widths out, from 2.5-3.5; ridges 0.4-1.2,
  // from 1.0-2.2)
  ['4CH-ED:gradientP50', 2.22],
  ['4CH-ES:gradientP50', 2.31],
  ['2CH-ED:gradientP50', 2.92],
  ['2CH-ES:gradientP50', 2.27],
  ['4CH-ED:gradientP95', 0.61],
  ['4CH-ES:gradientP95', 0.44],
  ['2CH-ED:gradientP95', 1.13],
  ['2CH-ES:gradientP95', 0.9],
  ['4CH-ED:ridgeFraction', 1.23],
  // 0.36 → 0.56 at decision 226: thin bright lines at the systolic crux, where both valves now hinge on the septum
  ['4CH-ES:ridgeFraction', 0.56],
  ['2CH-ES:ridgeFraction', 0.45],
  ['2CH-ED:ridgeFraction', 1.2],
  // more texture contrast over the whole sector: the blood pool and background are grainier than the clinical haze
  ['2CH-ED:detrendedStd', 0.4],
  // (4CH-ED, on the edge since the papillary muscles rose out of the mid-cavity band at decision 225, came inside with the
  // chordae as thin cords, decision 227)
  // texture longer along the beam at 1 mm (0.31-0.35 against 0.20-0.23) and, in the 2CH, less coherent across it at 2-4 mm
  ['4CH-ED:radialCorr1', 0.88],
  ['4CH-ES:radialCorr1', 0.35],
  // (the four-chamber end-systolic texture against the ±4 mm mean and its correlation along the beam at 8 mm, declared
  // since decision 161, came inside at decisions 220 and 221)
  // 1.71 and 1.24 until the chordae became thin cords (decision 227): their bright rods ran along the apical beams
  ['2CH-ED:radialCorr1', 1.51],
  ['2CH-ES:radialCorr1', 1.03],
  ['4CH-ES:tangentialCorr4', -0.35],
  // −0.45 until decision 227 (the 2CH-ES one, −0.27, came inside with it)
  ['2CH-ED:tangentialCorr4', -0.28],
  // decision 227, at the edge: the four-chamber end-systolic texture along the beam at 2 mm, and the outer sector of the
  // two-chamber against its centre
  ['4CH-ES:radialCorr2', -0.1],
  ['2CH-ES:edgeRollOff', 0.12],
  // 0.49 → 0.62 with the septal crest (decision 223) and 0.65 with the tricuspid annulus reaching the septum (decision
  // 224): the septal leaflet moves in the four-chamber view (50 samples at 11 cm), 0.0985 → 0.0998 in every realization;
  // 0.83 with the crux of decision 226, whose bright block of fibrous tissue beside the septum became myocardium
  ['4CH-ED:tangentialCorr8', 0.83],
  // decision 226: without that block the four-chamber end-diastolic texture anticorrelates along the beam at 2 and 4 mm,
  // at the edge (and its 95th percentile of grey sits on the clinical quartile's edge, 156.6 against 161)
  ['4CH-ED:radialCorr2', -0.15],
  ['4CH-ED:radialCorr4', -0.16],
  // the cavity bands (4-10 cm) darker than clinical; the near field (0-2 cm), 141-154 against 105-115 until the
  // chest-wall muscle came down to its clinical grey (decision 156), is inside
  ['4CH-ED:bandGrey4', -0.27],
  ['2CH-ED:bandGrey4', -0.17],
  ['4CH-ES:bandGrey8', -0.29],
  ['2CH-ES:bandGrey8', -0.11],
  // a duller bright end at end-systole
  // decision 221: without the bright A-lines at oblique incidence the bright end of the sector comes down
  ['4CH-ES:greyP95', -0.36],
  // Where the rib shadow lay, the two-chamber sector shows lit tissue since decision 215 — the lung edge and, at its
  // inferior edge, the diaphragm over the liver — with the model's sharper, beam-elongated texture: gradients, ridges and
  // the radial correlation at 1 mm rose 0.4-1.2 widths, the outer quarter of the sector against its central half went
  // from under the clinical ratio to over it (1.66 and 1.37 against 1.10-1.48 and 0.96-1.26), and the whole-sector texture
  // contrast came out of the quartiles.
  ['2CH-ED:edgeRollOff', 0.21],
  ['2CH-ED:bandGrey2', 0.23],
  // (the 2CH-ES whole-sector texture contrast, 0.16 out, came inside with the chordae as thin cords, decision 227)
  // decision 221: without the A-lines at oblique incidence, which striped the lung region, the far two-chamber band is
  // duller (its texture correlation across the beam at 2 mm, out since 221, came back inside at decision 225, and the
  // four-chamber correlation along it at 4 mm with the atrium beside the membranous septum, decision 222)
  ['2CH-ED:bandGrey10', -0.12],
  ['2CH-ES:tangentialCorr8', -0.27],
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
