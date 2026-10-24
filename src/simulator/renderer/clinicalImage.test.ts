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
import { CAMUS_GOOD_SURROUNDINGS } from '@/clinical/reference-values/camusSurroundings';
import { surroundings, type SurroundingsMetric } from '@/clinical/surroundings';
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
  // Decision 296: removing the artificial 3 mm clutter envelope reduces blood mottling but leaves
  // cavity residual texture below CAMUS; record that cost, not a wider clinical tolerance.
  ['4CH-ED:cavityDetrendedStd', -0.49],
  ['4CH-ES:cavityDetrendedStd', -0.64],
  ['2CH-ES:contrast', -0.27],
  // decision 264: with the chest-wall reverberation fading within 0.8 cm the near field comes inside and the two-chamber cavities darken
  // decision 263: the cavity reverberation no longer reinforced behind blood darkens the end-diastolic cavities
  ['2CH-ED:cavityDetrendedStd', -0.76],
  // decision 258, through the app's persistence and with the cavity haze: the myocardium's local texture falls with
  // the averaged receiver noise (the end-systolic atria, 82-84 against upper quartiles of 78-79 then, and the two-chamber
  // contrast came inside at decision 263, when the haze stopped growing behind the ventricle's blood)
  ['2CH-ED:myocardialResidualSkew', 0.17],
  // decision 299: the beam pays the mean of its pencils' amplitudes, so the walls beside blood keep more of their echo
  // and the four-chamber end-diastolic contrast rises over the upper quartile; decision 312 recalibrated the haze of the
  // cavities with its new loss and left it 0.17 widths over (49 against 33-47), the end-systolic one 0.12 under (34
  // against 36-49), the two-chamber end-systolic cell inside and the four-chamber end-systolic cell a little narrower
  // (1.97 against 2.00-2.28)
  ['4CH-ES:contrast', -0.12],
  ['4CH-ES:speckleCellHorizontalMm', -0.46],
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
  // decision 299 brought the residual texture 0.16-0.19 widths closer (−0.95, −0.8, −1.29 and −0.98 before)
  ['4CH-ES:myocardialLocalStd', -0.77],
  ['2CH-ES:myocardialLocalStd', -0.49],
  ['4CH-ED:myocardialDetrendedStd', -0.83],
  ['4CH-ES:myocardialDetrendedStd', -1.35],
  ['2CH-ED:myocardialDetrendedStd', -0.7],
  ['2CH-ES:myocardialDetrendedStd', -1.02],
  // −0.12 → −0.28 at decision 227, and 2CH-ES out: the chordae, drawn as bright rods until then, lifted the texture of
  // the mid cavity; as thin cords they leave it a little darker and more uniform than CAMUS Good, at the quartiles' edge
  // (the two-chamber end-diastolic cavity came inside at decision 261, and the four-chamber end-diastolic slope at 263)
  ['2CH-ES:cavityDetrendedStd', -0.71],
  // (the end-diastolic contrast, 57 grey levels against 40 [33-47] once and 0.34-0.48 widths out at decision 238, came
  // inside with the cavity haze of decision 258; the four-chamber one is out again above, decision 263)
  // (the horizontal speckle cell of the myocardium, at the edge of the clinical range since decision 215, came inside
  // at decision 299)
  // Decision 317 fitted the axial pulse to the autocorrelation of CAMUS Good along the beam (0.71, 0.30, 0.11 at 0.5, 1
  // and 1.5 mm in the myocardium; 0.72, 0.33, 0.13 now, 0.78, 0.41, 0.15 with the 1.35× pulse of decision 145). The
  // speckle cell here is taken along the image's axes, and on the walls, 20-30° off the beam, the vertical cell mixes
  // the axial correlation with the lateral one, whose tail at 2-4 mm the model lacks (tangential 0.17, −0.04, −0.07
  // at 2, 3 and 4 mm against 0.24, 0.07, 0.05): the cells read 1.4-1.5 mm high and 1.9 mm wide against 1.5-2.0 and
  // 2.0-2.3. Decision 145 had matched the cell by lengthening the pulse.
  ['4CH-ED:speckleCellVerticalMm', -0.66],
  ['4CH-ES:speckleCellVerticalMm', -0.78],
  ['2CH-ED:speckleCellVerticalMm', -0.42],
  ['2CH-ES:speckleCellHorizontalMm', -0.64],
  ['2CH-ES:speckleCellVerticalMm', -0.48],
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
/**
 * What surrounds the left ventricle (decision 144: near field, far background, the bands outside each wall, the
 * pericardial line and the transmural profile), against CAMUS Good. Its reference was generated with the decision but
 * no test read it on the app's chain until decision 312: 20 of its 44 values were outside the quartiles, among them the
 * right ventricle beside the septum (40 grey against 48-74), which decision 312 brought inside.
 */
const KNOWN_SURROUNDINGS_DEVIATIONS: ReadonlyMap<string, number> = new Map([
  // The wall profile (LIMITATIONS.md): the endocardial fifth reads brighter than the mid-wall (1.04-1.21 against
  // 0.76-0.88) and the lateral epicardial fifth darker (0.81-0.87 against 1.01-1.18). The apical beams that reach the
  // outer half of a wall run lengthwise inside it and lose 6.8 dB per cm of myocardium (0.9 dB/cm/MHz, harmonic): with
  // the myocardium attenuating like blood the profile takes the clinical shape (septum peaked at mid-wall, lateral wall
  // rising to the epicardium). The fibre helix took 0.2 off the endocardial fifth (decision 144); a march of sub-beams
  // converging from the whole aperture moved the epicardial fifth only 5 grey (decision 312, not kept); the published anisotropy (0.52 dB/cm/MHz across the
  // fibres, 1.88 along) averages over the helix to the 0.9 the model has. The fifths also hang on where the contour
  // runs (decision 313): CAMUS counts trabeculae and papillary muscles as cavity and traces the lateral epicardium at the
  // pericardium; the simulator's labels are the exact surfaces, and drawing its endocardial contour 1 mm into the cavity
  // takes the endocardial fifth from 1.02 to 0.84-0.85 of the mid-wall, its epicardial one 1 mm out the lateral
  // epicardial fifth from 0.83 to 1.02.
  ['4CH-ED:side1EndoOverMid', 0.9],
  ['4CH-ED:side2EndoOverMid', 1.02],
  ['4CH-ED:side2EpiOverMid', -0.39],
  ['4CH-ES:side1EndoOverMid', 1.42],
  ['4CH-ES:side2EndoOverMid', 1.18],
  ['4CH-ES:side2EpiOverMid', -0.34],
  ['2CH-ED:side1EndoOverMid', 0.97],
  ['2CH-ED:side2EndoOverMid', 0.59],
  ['2CH-ES:side1EndoOverMid', 1.03],
  ['2CH-ES:side1EpiOverMid', -0.26],
  ['2CH-ES:side2EndoOverMid', 0.88],
  ['2CH-ES:side2EpiOverMid', -0.19],
  // The near field, 15 mm under the sector apex, brighter than clinical (128 against 83-122; 125 before decision 312,
  // at the edge), and at end-systole the lateral band (86 against 91-135; 80 before the lung's haze kept what it had at
  // the heart's surface, decision 313), both pericardial peaks and the bright end of the far background dimmer; the
  // two-chamber anterior pericardial peak a little brighter.
  ['4CH-ED:nearFieldGrey', 0.15],
  ['4CH-ES:nearFieldGrey', 0.14],
  ['4CH-ES:farBackgroundP99', -0.21],
  ['4CH-ES:side2BandGrey', -0.1],
  ['4CH-ES:side1EpicardialPeakGrey', -0.33],
  ['4CH-ES:side2EpicardialPeakGrey', -0.18],
  ['2CH-ED:side2EpicardialPeakGrey', 0.13],
]);

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
  // the left atrium held on the aortic root (decision 341) moves the two-chamber end-diastolic correlation 8 mm along
  // the beam from −0.013 to −0.017, just past the quartile's edge
  ['2CH-ED:radialCorr8', -0.49],
  // decision 333: the pericardium's interface echo is collagen against fat (0.15, not 1.0): the white lines it drew
  // across the beam were thin bright ridges, and the end-systolic ridge deficit grows (1.42 → 1.67 four-chamber,
  // 1.38 → 1.58 two-chamber); the two-chamber correlation 1 mm along the beam comes closer (0.46/0.52 → 0.24) and
  // the four-chamber ones at 1 mm (end-diastole) and 4 mm (end-systole) inside; the end-systolic four-chamber texture 8
  // mm across the beam and the end-diastolic two-chamber one 4 mm along it step just outside (the four-chamber one
  // −0.15 since decision 367, with the right atrium's lateral wall and its sac; −0.1 before)
  ['4CH-ES:tangentialCorr8', -0.15],
  ['2CH-ED:radialCorr4', 0.24],
  // Decision 296: diffuse clutter loses coarse image-plane modulation; small residual texture/edge deficits. At decision
  // 312 the four-chamber end-diastolic edge came inside, the two-chamber end-systolic local std too, and the two-chamber
  // end-systolic sector edge falls off faster than clinical (1.33 against 0.96-1.26).
  ['2CH-ES:edgeRollOff', 0.25],
  // Decision 291: measured texture debt after anatomically constrained LA normalization.
  // Original reference quartiles and drift tolerances remain unchanged.
  // decision 299: the four-chamber end-diastolic correlation came inside and the two-chamber end-systolic one closer (−0.39)
  // decision 312: the four-chamber end-diastolic texture a little anticorrelated at 4 mm along the beam (−0.060 against
  // −0.055 to −0.014)
  // decisions 271-273: the gastric fundus and the posterior column
  // decision 270: the lung's diffuse reverberation now carries its path loss, so the outer sector of the end-systolic four-chamber view darkens
  ['4CH-ES:edgeRollOff', -0.12],
  // decision 264: with the chest-wall reverberation fading within 0.8 cm the near field comes inside and the two-chamber cavities darken
  // decision 369: the septum without its 7 mm limbus draws one bright interface fewer at end-systole (1.58 before)
  ['2CH-ES:ridgeFraction', 1.43],
  // decision 263: the cavity reverberation no longer reinforced behind blood darkens the end-diastolic cavities
  // decision 262: with the LV's diaphragmatic face on the diaphragm, liver fills the two-chamber sector beyond the
  // inferior wall where lung reverberation was; at end-systole its texture and the outer sector move out
  // decision 261: without the window's extra chest-wall attenuation the near field (2-4 cm) is brighter than clinical
  // and the gradients sharper; the cavity bands and the bright end come inside (the 0-2 cm band at decision 264)
  ['4CH-ED:bandGrey2', 0.19],
  ['2CH-ED:gradientP95', 0.62],
  // decision 299: walls beside blood keep more of their echo, so the steepest gradients sharpen and the two-chamber
  // end-systolic sector edge falls off a little faster
  ['4CH-ED:gradientP95', 0.34],
  ['2CH-ES:gradientP95', 0.17],
  ['2CH-ES:bandGrey2', 0.19],
  // Measured since decision 258 as the app shows it, through the console's persistence, with the haze of the cavities:
  // the black pixels of the single frame (up to 27.6 quartile widths out in the 4-6 cm band) mostly went, and the rest,
  // the four-chamber cavity at 4-8 cm, went at decision 312, when the haze stopped dimming behind the apex and the
  // septum.
  // sharper than clinical and drawn with thin bright lines, less so through the persistence (median gradient 2.2-2.9
  // quartile widths out before decision 258)
  ['4CH-ED:gradientP50', 0.89],
  ['4CH-ES:gradientP50', 0.71],
  ['2CH-ED:gradientP50', 1.32],
  ['2CH-ES:gradientP50', 0.76],
  // decision 317: with the shorter pulse the thin bright interfaces stand out more (0.71, 0.61, 0.96 and 0.53 widths
  // out before): the next target, with the lateral tail
  // decision 367: the right atrium's lateral wall rising from the tricuspid hinge draws one more interface along the
  // beam at end-diastole (1.71 before)
  ['4CH-ED:ridgeFraction', 1.86],
  // decision 370: the pulmonary veins' wall, thinned to 0.7 mm, draws a thin line in the four-chamber view at end-systole
  // where the 1.2 mm arterial wall drew a band (1.67 before)
  ['4CH-ES:ridgeFraction', 1.85],
  // decision 321: the coronary sinus in the inferior atrioventricular groove adds its wall's specular line (1.6 before)
  ['2CH-ED:ridgeFraction', 2.35],
  // texture longer along the beam at 1 mm (0.34 against 0.20-0.23), less coherent across it at 2-4 mm in places, and
  // through the persistence a little smoother over the sector (local std)
  // decision 324: with the superior vena cava joining the top of the atrium, the end-systolic four-chamber texture at
  // 4 mm (−0.48 before); the end-diastolic one at 4 mm across the beam came inside
  ['2CH-ED:radialCorr2', 0.6],
  // decision 321: with the coronary sinus at the inferior groove, the two-chamber end-diastolic texture at 8 mm (−0.11 before)
  ['2CH-ED:radialCorr1', 0.24],
  ['2CH-ES:radialCorr1', 0.24],
  ['2CH-ED:tangentialCorr4', -0.65],
  // decision 366: the lateral wall of the left atrium stands on the hinge, along the beam, and the two-chamber sector at
  // end-diastole correlates less across the beam (2CH-ED radialCorr2, radialCorr8 and tangentialCorr4 moved with it)
  ['2CH-ED:tangentialCorr2', -0.17],
  // grey levels: the 2-4 cm band brighter than clinical (the app's near-field clutter, decision 238, more so without the
  // window's chest-wall attenuation of decision 261; the 0-2 cm band came inside at 264), the four-chamber end-systolic
  // bright end dimmer
  // decision 312: the haze recalibrated with its new loss also lifts the first 2 cm of the four-chamber end-systolic
  // sector over the upper quartile (130 against 85-124)
  ['2CH-ED:bandGrey2', 0.5],
  // decision 317: with the shorter pulse the end-systolic four-chamber outer band and the two-chamber end-systolic dark end
  // move to the edge, and the two-chamber end-diastolic texture loses its anticorrelation at 4 mm
  ['4CH-ES:bandGrey8', -0.11],
  // decision 318: with the atrium filling its septal corner the four-chamber end-diastolic texture at 1 mm and the
  // two-chamber end-systolic one at 4 mm move just past the quartiles
  // decision 327: the ventricular wall ends at the hinge of its azimuth, basal of the mean annular plane at the anterior
  // and inferior hinges the two-chamber view cuts, and the atrium lies flat on the septum: the two-chamber texture moves
  // (ridges 1.83 → 1.99 and 1.22 → 1.38, the end-diastolic myocardial residual −0.52 → −0.70, the end-systolic speckle
  // cell across the beam −0.45 → −0.64; at 2-8 mm along the beam closer to the quartiles, at 2 mm across it and the
  // end-systolic dark end inside), and the four-chamber end-diastolic texture at 8 mm across the beam steps just past
  // them (the ridges and the lateral tail remain the next target, docs/LIMITATIONS.md)
  // decision 328: with the atrium's base broad on its annulus (the fat wedges under the hinges gone, the atrium against
  // the root in the long axis) the apical gradients at the 95th percentile and the four-chamber end-diastolic texture at
  // 1 mm and 4 mm along the beam step a little farther out (0.16 → 0.34, 0.45 → 0.62, 0.16 → 0.33, −0.32), the
  // end-systolic one at 4 mm closer (−0.5 → −0.35) and at 1 mm across the beam just out (0.13); the end-systolic bright
  // end, the two-chamber texture at 8 mm along the beam and the end-systolic one at 4 mm come inside
  // decision 330: with the atrium's posterior wall flat on the descending aorta (the band behind it a single line, the
  // body narrower and drawn forward) the ridges step farther out (1.39 → 1.71, 1.99 → 2.35: still the next target), the
  // end-systolic four-chamber texture at 8 mm across the beam and the two-chamber one at 8 mm along it step just past the
  // quartiles (−0.14, 0.13), the four-chamber end-systolic texture at 4 mm along the beam and the two-chamber
  // end-diastolic one at 2 mm along and 4 mm across it come closer (−0.35 → −0.11, 0.61 → 0.38, −0.69 → −0.21), and the
  // four-chamber end-diastolic texture at 4 mm along and 8 mm across the beam, the end-systolic one at 1 mm across it
  // and the two-chamber end-diastolic one at 4 mm along it come inside
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
    const realSurroundings = new Set(
      CONDITIONS.flatMap(([k]) => Object.keys(CAMUS_GOOD_SURROUNDINGS[k]).map((m) => `${k}:${m}`)),
    );
    expect(
      [...KNOWN_SURROUNDINGS_DEVIATIONS.keys()].filter((d) => !realSurroundings.has(d)),
    ).toEqual([]);
    expect(
      [...KNOWN_SURROUNDINGS_DEVIATIONS.entries()].filter(([, b]) => Math.abs(b) < QUARTILE_EDGE),
    ).toEqual([]);
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

  it('apical grey levels, contrast and texture fall inside the clinical interquartile range', () => {
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
  });

  it('the whole sector, without labels, reads like clinical images or deviates as declared', () => {
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
  });

  it('what surrounds the left ventricle reads like clinical images or deviates as declared', () => {
    const out = { outside: [] as string[], stale: [] as string[], moved: [] as string[] };
    for (const [key, view, ed] of CONDITIONS) {
      const g = renderOnce(view, ed).flatMap((r) =>
        Array.from({ length: NOISE_REALIZATIONS }, (_, fi) =>
          surroundings(presentApical(r, {}, fi), key.startsWith('4CH') ? '4CH' : '2CH'),
        ),
      );
      const ref = CAMUS_GOOD_SURROUNDINGS[key];
      audit(
        key,
        (Object.keys(ref) as SurroundingsMetric[]).map((m) => [
          m,
          g.reduce((a, x) => a + x[m], 0) / g.length,
          ref[m]!,
        ]),
        KNOWN_SURROUNDINGS_DEVIATIONS,
        out,
      );
    }
    expect(out, 'undeclared, stale and moved deviations around the LV from CAMUS Good').toEqual({
      outside: [],
      stale: [],
      moved: [],
    });
  });

  it('the left ventricle sits in the apical sector where clinical images put it', () => {
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
    expect(out, 'undeclared, stale and moved apical geometry deviations from CAMUS Good').toEqual({
      outside: [],
      stale: [],
      moved: [],
    });
  });
});
