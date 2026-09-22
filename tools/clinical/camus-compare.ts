/**
 * CLI: CAMUS_DIR=/ruta/fuera/del/repo/database_nifti npx tsx tools/clinical/camus-compare.ts [--limit N] [--out stats.json]
 *      [--reference-out ...] [--geometry-out ...] [--surroundings-out src/clinical/reference-values/camusSurroundings.ts]
 *      [--sweep-console [--sweep-compensation 0.45,1.0] [--sweep-gray clinical] [--sweep-range 60,70] [--sweep-gain -12,-8]]
 *        [--sweep-console] [--reference-out src/clinical/reference-values/camusImageStats.ts]
 *
 * Compares the simulator's apical images with the CAMUS clinical database, region by region (LV cavity,
 * LV myocardium, left atrium), running the SAME statistics code on both sides (src/clinical/regionStats.ts):
 * grey-level histograms, tissue/blood contrast, myocardial texture and speckle cell size.
 *
 * The reference is the optimal window (decision 70): CAMUS images rated Good against the excellent-window case.
 * Those are the images a trainee should learn to recognise, and the only ones a console can be calibrated on —
 * a poor clinical image is poor for reasons the console does not model. The difficult window against CAMUS Poor
 * is still printed, for information, and never takes part in a choice.
 *
 * Clinical data rules (decision 69, .claude/skills/fidelity-method): CAMUS_DIR must be outside this public
 * repository — the tool refuses to run otherwise — and nothing derived from an individual image is written.
 * The output is aggregate statistics only. Labels are verified from geometry on every file before use.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { parseNifti, type NiftiVolume } from '@/clinical/nifti';
import {
  identifyLabels,
  imageStats,
  orientApical,
  type ImageStats,
  type RegionImage,
} from '@/clinical/regionStats';
import { apicalGeometry, type ApicalGeometry } from '@/clinical/apicalGeometry';
import { surroundings, type Surroundings, type SurroundingsMetric } from '@/clinical/surroundings';
import {
  apicalStats,
  meanStat,
  presentApical,
  renderApicalRealizations,
  type ApicalRender,
  type ConsoleOverride,
} from '@/simulator/renderer/clinicalImage';
import { DEFAULT_ACQUISITION } from '@/simulator/renderer/types';

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const limit = Number(arg('--limit') ?? '500');
const outFile = arg('--out');
const referenceOut = arg('--reference-out');
const geometryOut = arg('--geometry-out');
const surroundingsOut = arg('--surroundings-out');
const repoRoot = resolve(process.cwd());

const camusDir = process.env['CAMUS_DIR'];
if (!camusDir) {
  process.stderr.write(
    'Falta CAMUS_DIR.\n' +
      '1. Regístrate y descarga CAMUS desde https://humanheart-project.creatis.insa-lyon.fr/database/ (cita IEEE TMI 2019, Leclerc et al.).\n' +
      '2. Descomprime en una carpeta FUERA de este repositorio, p. ej. ~/datos/CAMUS/database_nifti\n' +
      '3. CAMUS_DIR=~/datos/CAMUS/database_nifti npx tsx tools/clinical/camus-compare.ts --limit 100\n',
  );
  process.exit(1);
}
const camusAbs = resolve(camusDir);
if (camusAbs === repoRoot || camusAbs.startsWith(repoRoot + sep)) {
  process.stderr.write(
    `CAMUS_DIR (${camusAbs}) está dentro del repositorio público. Muévelo fuera: los datos clínicos no pueden acabar en git.\n`,
  );
  process.exit(2);
}

function readVolume(path: string): NiftiVolume {
  const raw = readFileSync(path);
  const bytes = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw;
  return parseNifti(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
}

/** One frame of a CAMUS sequence as a RegionImage, grey normalised to 0-255 only if the file is not already in that range. */
function camusFrame(img: NiftiVolume, gt: NiftiVolume, t: number): RegionImage {
  const [w, h] = img.dims;
  const plane = w * h;
  const grey = new Float32Array(plane);
  const labels = new Uint8Array(plane);
  let lo = Infinity,
    hi = -Infinity;
  for (let i = 0; i < plane; i++) {
    const v = img.voxels[i + t * plane]!;
    grey[i] = v;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
    labels[i] = Math.round(gt.voxels[i + t * plane]!);
  }
  if (lo < 0 || hi > 255)
    for (let i = 0; i < plane; i++) grey[i] = (255 * (grey[i]! - lo)) / Math.max(1e-6, hi - lo);
  return { width: w, height: h, grey, labels, mmPerPx: [img.spacing[0], img.spacing[1]] };
}

type Scalar = (s: ImageStats) => number;
// key (used in the generated reference), printed name, accessor
const METRICS: [string, string, Scalar][] = [
  ['cavityGrey', 'LV cavity grey (median)', (s) => s.cavity.median],
  ['myocardiumGrey', 'LV myocardium grey (median)', (s) => s.myocardium.median],
  ['atriumGrey', 'Left atrium grey (median)', (s) => s.atrium.median],
  ['contrast', 'Tissue/blood contrast (grey levels)', (s) => s.tissueBloodContrast],
  ['myocardialLocalStd', 'Myocardial local std (grey)', (s) => s.myocardialLocalStd],
  ['myocardialDetrendedStd', 'Myocardial detrended std (grey)', (s) => s.myocardialDetrendedStd],
  ['cavityDetrendedStd', 'Cavity detrended std (grey)', (s) => s.cavityDetrendedStd],
  ['speckleCellHorizontalMm', 'Speckle cell horizontal (mm)', (s) => s.speckleCellMm.horizontal],
  ['speckleCellVerticalMm', 'Speckle cell vertical (mm)', (s) => s.speckleCellMm.vertical],
  ['myocardialResidualSkew', 'Myocardial residual skewness', (s) => s.myocardialResidualSkew],
  ['levelStdSlope', 'Local std against local grey (slope)', (s) => s.levelStdSlope],
  ['brightGreyP99', 'Bright end: p99 of non-black grey', (s) => s.brightGreyP99],
];
interface Quartiles {
  median: number;
  p10: number;
  p25: number;
  p75: number;
  p90: number;
  n: number;
}
const quantiles = (v: number[]): Quartiles => {
  const s = v.filter(Number.isFinite).sort((a, b) => a - b);
  const at = (q: number): number =>
    s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))]! : NaN;
  return { median: at(0.5), p10: at(0.1), p25: at(0.25), p75: at(0.75), p90: at(0.9), n: s.length };
};

/** Info_4CH.cfg / Info_2CH.cfg: "Key: value" lines (ED, ES, NbFrame, Sex, Age, ImageQuality, EF, FrameRate). */
function readCfg(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z]+)\s*:\s*(.+?)\s*$/.exec(line);
    if (m) out[m[1]!] = m[2]!;
  }
  return out;
}

// Aggregates keyed by view, phase and image quality ("all" pools every quality). Sex and age from the cfg are
// deliberately not read into anything: only image quality is used, and only to stratify.
const clinical = new Map<string, ImageStats[]>();
const push = (key: string, st: ImageStats): void => {
  if (!clinical.has(key)) clinical.set(key, []);
  clinical.get(key)!.push(st);
};
let rejected = 0,
  missing = 0;
// apical geometry of the optimal-window images (decision 92), keyed by view and phase
const geometry = new Map<string, ApicalGeometry[]>();
// what the optimal-window images show around the left ventricle (decision 144), keyed by view and phase
const surround = new Map<string, Surroundings[]>();
const qualityCount: Record<string, number> = {};
const patients = readdirSync(camusAbs)
  .filter((n) => /^patient\d+$/.test(n))
  .sort()
  .slice(0, limit);
for (const p of patients)
  for (const ch of ['4CH', '2CH'] as const) {
    const quality = readCfg(join(camusAbs, p, `Info_${ch}.cfg`))['ImageQuality'] ?? 'Unknown';
    qualityCount[quality] = (qualityCount[quality] ?? 0) + 1;
    for (const phase of ['ED', 'ES'] as const) {
      const imgPath = join(camusAbs, p, `${p}_${ch}_${phase}.nii.gz`);
      const gtPath = join(camusAbs, p, `${p}_${ch}_${phase}_gt.nii.gz`);
      if (!existsSync(imgPath) || !existsSync(gtPath)) {
        missing++;
        continue;
      }
      const img = readVolume(imgPath),
        gt = readVolume(gtPath);
      if (img.dims[0] !== gt.dims[0] || img.dims[1] !== gt.dims[1]) {
        rejected++;
        continue;
      }
      const frame = camusFrame(img, gt, 0);
      try {
        identifyLabels(frame.labels, frame.width, frame.height);
      } catch {
        rejected++; // label geometry does not match the convention: never measure on a guess
        continue;
      }
      const oriented = orientApical(frame);
      const st = imageStats(oriented);
      push(`${ch}-${phase}-all`, st);
      push(`${ch}-${phase}-${quality}`, st);
      if (quality === 'Good') {
        const key = `${ch}-${phase}`;
        if (!geometry.has(key)) geometry.set(key, []);
        geometry.get(key)!.push(apicalGeometry(oriented, ch));
        if (!surround.has(key)) surround.set(key, []);
        surround.get(key)!.push(surroundings(oriented, ch));
      }
    }
  }

/** The default-console image (first noise realization) of the first scatterer realization, for the geometry comparison. */
function presentApicalFrame(
  cache: Map<string, ApicalRender[]>,
  caseId: string,
  view: 'a4c' | 'a2c',
  phase: 'ED' | 'ES',
): RegionImage {
  const key = `${caseId}|${view}|${phase}`;
  if (!cache.has(key)) cache.set(key, renderApicalRealizations(caseId, view, phase === 'ED'));
  return presentApical(cache.get(key)![0]!);
}

// each simulator view is rendered once per scatterer realization; consoles only change its presentation, averaged over
// scatterer and receiver-noise realizations (decisions 91 and 99)
const renders = new Map<string, ApicalRender[]>();
const simStats = (
  caseId: string,
  view: 'a4c' | 'a2c',
  phase: 'ED' | 'ES',
  consoleOverride: ConsoleOverride = {},
): ImageStats[] => {
  const key = `${caseId}|${view}|${phase}`;
  if (!renders.has(key)) renders.set(key, renderApicalRealizations(caseId, view, phase === 'ED'));
  return renders.get(key)!.flatMap((r) => apicalStats(r, consoleOverride));
};

const report: Record<string, unknown> = {
  source:
    'CAMUS — Leclerc et al., IEEE TMI 38(9):2198-2210, 2019, doi:10.1109/TMI.2019.2900516 (aggregate statistics only)',
  patients: patients.length,
  sequencesByQuality: qualityCount,
  rejectedFrames: rejected,
  missingFrames: missing,
  comparisons: {},
};
const VIEWS = [
  ['4CH', 'a4c'],
  ['2CH', 'a2c'],
] as const;
const PHASES = ['ED', 'ES'] as const;
// the optimal window is the reference; the difficult one is printed for information only
const PAIRS: [string, string, string][] = [
  ['normal-excellent-window', 'Good', 'excellent window vs CAMUS Good (reference)'],
  ['normal-difficult-window', 'Poor', 'difficult window vs CAMUS Poor (information only)'],
];
for (const [caseId, quality, label] of PAIRS)
  for (const [ch, view] of VIEWS)
    for (const phase of PHASES) {
      const clin = clinical.get(`${ch}-${phase}-${quality}`) ?? [];
      const all = clinical.get(`${ch}-${phase}-all`) ?? [];
      const sim = simStats(caseId, view, phase);
      process.stdout.write(
        `\n=== ${label} — ${ch} ${phase} (CAMUS ${quality} n=${clin.length}, all n=${all.length}) vs simulator ${view}\n`,
      );
      const rows: Record<string, unknown> = {};
      for (const [, name, get] of METRICS) {
        const q = quantiles(clin.map(get));
        const qa = quantiles(all.map(get));
        const s = meanStat(sim, get);
        const inside = Number.isFinite(q.p25) && s >= q.p25 && s <= q.p75;
        process.stdout.write(
          `  ${name.padEnd(38)} ${quality.padEnd(4)} ${q.median.toFixed(2).padStart(7)} [${q.p25.toFixed(2)}–${q.p75.toFixed(2)}]  all ${qa.median.toFixed(2).padStart(7)}   sim ${s.toFixed(2).padStart(7)}  ${Number.isFinite(q.median) ? (inside ? 'within IQR' : 'OUTSIDE IQR') : ''}\n`,
        );
        rows[name] = { camus: q, camusAll: qa, simulator: s, withinIqr: inside };
      }
      (report['comparisons'] as Record<string, unknown>)[`${caseId}:${ch}-${phase}`] = rows;
    }

if (process.argv.includes('--sweep-console')) {
  // Distance to the clinical distribution of optimal-window images, normalised by its spread: |sim - median| / IQR,
  // averaged over the four apical conditions and the scored metrics. The speckle cell is reported but NOT scored:
  // clinical scanners apply speckle reduction filters that coarsen the texture, which the console does not model,
  // and scoring it would pick a worse console to compensate for post-processing that is not there.
  const SCORED = METRICS.filter(([k]) => !k.startsWith('speckleCell'));
  // The surroundings score with the regions (decision 144): what the console does to the near field, the far
  // background and the bands outside the walls counts as much as what it does to cavity and myocardium.
  const SCORED_SURROUNDINGS: SurroundingsMetric[] = [
    'nearFieldGrey',
    'farBackgroundGrey',
    'farBackgroundP99',
    'side1BandGrey',
    'side2BandGrey',
  ];
  const results: { cfg: string; score: number; override: ConsoleOverride }[] = [];
  process.stdout.write(
    '\n=== console sweep against CAMUS Good: mean |sim - median| / IQR over 4 conditions (lower is better)\n',
  );
  const compensations = (arg('--sweep-compensation') ?? '0.45').split(',').map(Number);
  const grayMaps = (arg('--sweep-gray') ?? 'clinical,s-curve,linear,high-contrast').split(
    ',',
  ) as ConsoleOverride['grayMap'][];
  const ranges = (arg('--sweep-range') ?? '55,60,65,70,75,80').split(',').map(Number);
  const gains = (arg('--sweep-gain') ?? '-4,-2,0,2,4').split(',').map(Number);
  for (const depthCompensationDbPerCmMHz of compensations)
    for (const grayMap of grayMaps)
      for (const dynamicRangeDb of ranges)
        for (const gainDb of gains) {
          const override: ConsoleOverride = {
            grayMap,
            dynamicRangeDb,
            gainDb,
            depthCompensationDbPerCmMHz,
          };
          let sum = 0,
            n = 0;
          for (const [ch, view] of VIEWS)
            for (const phase of PHASES) {
              const clin = clinical.get(`${ch}-${phase}-Good`) ?? [];
              if (clin.length < 3) continue;
              const sim = simStats('normal-excellent-window', view, phase, override);
              for (const [, , get] of SCORED) {
                const q = quantiles(clin.map(get));
                sum += Math.abs(meanStat(sim, get) - q.median) / Math.max(1e-6, q.p75 - q.p25);
                n++;
              }
              const clinS = surround.get(`${ch}-${phase}`) ?? [];
              if (clinS.length >= 3) {
                const simS = surroundings(
                  presentApical(
                    renders.get(`normal-excellent-window|${view}|${phase}`)![0]!,
                    override,
                  ),
                  ch,
                );
                for (const k of SCORED_SURROUNDINGS) {
                  const q = quantiles(clinS.map((g) => g[k]));
                  sum += Math.abs(simS[k] - q.median) / Math.max(1e-6, q.p75 - q.p25);
                  n++;
                }
              }
            }
          const cfg = `comp ${depthCompensationDbPerCmMHz} ${grayMap} DR ${dynamicRangeDb} gain ${gainDb}`;
          results.push({ cfg, score: sum / Math.max(1, n), override });
        }
  results.sort((x, y) => x.score - y.score);
  for (const r of results.slice(0, 12))
    process.stdout.write(`  ${r.cfg.padEnd(30)} score ${r.score.toFixed(2)}\n`);
  const d = DEFAULT_ACQUISITION;
  const current = results.find(
    (r) =>
      r.override.grayMap === d.grayMap &&
      r.override.dynamicRangeDb === d.dynamicRangeDb &&
      r.override.gainDb === d.gainDb,
  );
  process.stdout.write(
    `\nbest console: ${results[0]!.cfg} (score ${results[0]!.score.toFixed(2)}); current default ${d.grayMap} DR ${d.dynamicRangeDb} gain ${d.gainDb}: ${current ? current.score.toFixed(2) : 'not in the grid'}; worst: ${results.at(-1)!.cfg} (${results.at(-1)!.score.toFixed(2)})\n`,
  );
  report['consoleSweep'] = results.map(({ cfg, score }) => ({ cfg, score }));
}

if (referenceOut) {
  // The optimal-window reference the console test checks against: aggregate quartiles only, never an image.
  const f = (x: number): string => (Number.isFinite(x) ? String(Math.round(x * 100) / 100) : 'NaN');
  let body = '';
  for (const [ch] of VIEWS)
    for (const phase of PHASES) {
      const clin = clinical.get(`${ch}-${phase}-Good`) ?? [];
      body += `  '${ch}-${phase}': {\n`;
      for (const [key, , get] of METRICS) {
        const q = quantiles(clin.map(get));
        body += `    ${key}: { median: ${f(q.median)}, p10: ${f(q.p10)}, p25: ${f(q.p25)}, p75: ${f(q.p75)}, p90: ${f(q.p90)}, n: ${q.n} },\n`;
      }
      body += '  },\n';
    }
  const module =
    `/**\n` +
    ` * GENERATED by tools/clinical/camus-compare.ts --reference-out (decision 70). Do not edit by hand: re-run the tool.\n` +
    ` *\n` +
    ` * Displayed grey-level statistics of CAMUS apical images rated Good — the optimal window — per view and phase:\n` +
    ` * median, interquartile range and 10th/90th percentiles across images of each per-image statistic in\n` +
    ` * src/clinical/regionStats.ts (region medians after a 2-pixel erosion, contrast = myocardium − cavity, 5×5 local\n` +
    ` * std, grey std against the ±4 mm local mean in myocardium and cavity, speckle cell by ACF of those residuals,\n` +
    ` * skewness of the myocardial residuals, slope of local std against local grey, 99th percentile of non-black grey).\n` +
    ` * ${patients.length} patients read, ${rejected} frames rejected by the label check. Aggregate statistics only.\n` +
    ` *\n` +
    ` * Source: CAMUS — S. Leclerc et al., "Deep Learning for Segmentation Using an Open Large-Scale Dataset in 2D\n` +
    ` * Echocardiography", IEEE TMI 38(9):2198-2210, 2019, doi:10.1109/TMI.2019.2900516.\n` +
    ` */\n` +
    `export interface Quartiles {\n  median: number;\n  p10: number;\n  p25: number;\n  p75: number;\n  p90: number;\n  n: number;\n}\n\n` +
    `export type CamusMetric = ${METRICS.map(([k]) => `'${k}'`).join(' | ')};\n\n` +
    `export const CAMUS_GOOD: Record<'4CH-ED' | '4CH-ES' | '2CH-ED' | '2CH-ES', Record<CamusMetric, Quartiles>> = {\n${body}};\n`;
  writeFileSync(referenceOut, module);
  process.stdout.write(`optimal-window reference written to ${referenceOut}\n`);
}

const GEOMETRY_METRICS: [keyof ApicalGeometry, string][] = [
  ['apexOffsetMm', 'LV apex offset from the centre line (mm, + lateral / image right)'],
  ['apexDepthMm', 'LV apex depth along the centre line (mm)'],
  ['axisTiltDeg', 'LV long-axis tilt to the centre line (°)'],
  ['septalRayAngleDeg', 'Septum–scan line angle (°, 4CH)'],
  ['lateralRayAngleDeg', 'Lateral wall–scan line angle (°, 4CH)'],
  ['septalMinusLateralGrey', 'Septal minus lateral wall grey (4CH)'],
];
{
  process.stdout.write(
    '\n=== apical geometry: CAMUS Good vs simulator (normal-excellent-window, default console)\n',
  );
  for (const [ch, view] of VIEWS)
    for (const phase of PHASES) {
      const clin = geometry.get(`${ch}-${phase}`) ?? [];
      const sim = apicalGeometry(
        presentApicalFrame(renders, 'normal-excellent-window', view, phase),
        ch,
      );
      for (const [k, name] of GEOMETRY_METRICS) {
        const q = quantiles(clin.map((g) => g[k]));
        if (!Number.isFinite(q.median)) continue;
        process.stdout.write(
          `  ${ch} ${phase} ${name.padEnd(62)} ${q.median.toFixed(1).padStart(6)} [${q.p25.toFixed(1)}–${q.p75.toFixed(1)}]  sim ${sim[k].toFixed(1).padStart(6)}\n`,
        );
      }
    }
}
if (geometryOut) {
  const f = (x: number): string => (Number.isFinite(x) ? String(Math.round(x * 100) / 100) : 'NaN');
  let body = '';
  for (const [ch] of VIEWS)
    for (const phase of PHASES) {
      const clin = geometry.get(`${ch}-${phase}`) ?? [];
      body += `  '${ch}-${phase}': {\n`;
      for (const [k] of GEOMETRY_METRICS) {
        const q = quantiles(clin.map((g) => g[k]));
        if (Number.isFinite(q.median))
          body += `    ${k}: { median: ${f(q.median)}, p10: ${f(q.p10)}, p25: ${f(q.p25)}, p75: ${f(q.p75)}, p90: ${f(q.p90)}, n: ${q.n} },\n`;
      }
      body += '  },\n';
    }
  const module =
    `/**\n` +
    ` * GENERATED by tools/clinical/camus-compare.ts --geometry-out (decision 92). Do not edit by hand: re-run the tool.\n` +
    ` *\n` +
    ` * Where the left ventricle sits in CAMUS apical images rated Good, against the sector (src/clinical/apicalGeometry.ts):\n` +
    ` * median, interquartile range and 10th/90th percentiles across images. Aggregate statistics only.\n` +
    ` *\n` +
    ` * Source: CAMUS — S. Leclerc et al., "Deep Learning for Segmentation Using an Open Large-Scale Dataset in 2D\n` +
    ` * Echocardiography", IEEE TMI 38(9):2198-2210, 2019, doi:10.1109/TMI.2019.2900516.\n` +
    ` */\n` +
    `import type { Quartiles } from './camusImageStats';\n\n` +
    `export type ApicalGeometryMetric = ${GEOMETRY_METRICS.map(([k]) => `'${k}'`).join(' | ')};\n\n` +
    `export const CAMUS_GOOD_GEOMETRY: Record<'4CH-ED' | '4CH-ES' | '2CH-ED' | '2CH-ES', Partial<Record<ApicalGeometryMetric, Quartiles>>> = {\n${body}};\n`;
  writeFileSync(geometryOut, module);
  process.stdout.write(`apical geometry reference written to ${geometryOut}\n`);
}

const SURROUNDINGS_METRICS: [SurroundingsMetric, string][] = [
  ['nearFieldGrey', 'Near field grey, first 15 mm (median)'],
  ['farBackgroundGrey', 'Far background grey, > 8 mm from LV/LA (median)'],
  ['farBackgroundP99', 'Far background grey, 99th percentile'],
  ['side1BandGrey', 'Band 3-9 mm outside side 1 (septal / inferior)'],
  ['side2BandGrey', 'Band 3-9 mm outside side 2 (lateral / anterior)'],
  ['side1EpicardialPeakGrey', 'Brightest pixel 0-4 mm outside side 1 epicardium'],
  ['side2EpicardialPeakGrey', 'Brightest pixel 0-4 mm outside side 2 epicardium'],
  ['side1EndoOverMid', 'Side 1 wall: endocardial over mid-wall grey'],
  ['side1EpiOverMid', 'Side 1 wall: epicardial over mid-wall grey'],
  ['side2EndoOverMid', 'Side 2 wall: endocardial over mid-wall grey'],
  ['side2EpiOverMid', 'Side 2 wall: epicardial over mid-wall grey'],
];
{
  process.stdout.write(
    '\n=== surroundings of the LV: CAMUS Good vs simulator (normal-excellent-window, default console)\n',
  );
  for (const [ch, view] of VIEWS)
    for (const phase of PHASES) {
      const clin = surround.get(`${ch}-${phase}`) ?? [];
      const sim = surroundings(
        presentApicalFrame(renders, 'normal-excellent-window', view, phase),
        ch,
      );
      for (const [k, name] of SURROUNDINGS_METRICS) {
        const q = quantiles(clin.map((g) => g[k]));
        if (!Number.isFinite(q.median)) continue;
        process.stdout.write(
          `  ${ch} ${phase} ${name.padEnd(52)} ${q.median.toFixed(2).padStart(7)} [${q.p25.toFixed(2)}–${q.p75.toFixed(2)}]  sim ${sim[k].toFixed(2).padStart(7)}\n`,
        );
      }
      const prof = (v: number[][]): string =>
        [0, 1, 2, 3, 4].map((k) => quantiles(v.map((t) => t[k]!)).median.toFixed(0)).join(' ');
      process.stdout.write(
        `  ${ch} ${phase} transmural side 1 (endo → epi, medians)                  ${prof(clin.map((g) => g.side1Transmural))}  sim ${sim.side1Transmural.map((x) => x.toFixed(0)).join(' ')}\n` +
          `  ${ch} ${phase} transmural side 2 (endo → epi, medians)                  ${prof(clin.map((g) => g.side2Transmural))}  sim ${sim.side2Transmural.map((x) => x.toFixed(0)).join(' ')}\n`,
      );
    }
}
if (surroundingsOut) {
  const f = (x: number): string => (Number.isFinite(x) ? String(Math.round(x * 100) / 100) : 'NaN');
  let body = '';
  for (const [ch] of VIEWS)
    for (const phase of PHASES) {
      const clin = surround.get(`${ch}-${phase}`) ?? [];
      body += `  '${ch}-${phase}': {\n`;
      for (const [k] of SURROUNDINGS_METRICS) {
        const q = quantiles(clin.map((g) => g[k]));
        if (Number.isFinite(q.median))
          body += `    ${k}: { median: ${f(q.median)}, p10: ${f(q.p10)}, p25: ${f(q.p25)}, p75: ${f(q.p75)}, p90: ${f(q.p90)}, n: ${q.n} },\n`;
      }
      body += '  },\n';
    }
  const module =
    `/**\n` +
    ` * GENERATED by tools/clinical/camus-compare.ts --surroundings-out (decision 144). Do not edit by hand: re-run the tool.\n` +
    ` *\n` +
    ` * What CAMUS apical images rated Good show around the left ventricle (src/clinical/surroundings.ts): near field,\n` +
    ` * far background, the bands outside each wall, the pericardial line and the transmural grey ratios; median,\n` +
    ` * interquartile range and 10th/90th percentiles across images. Side 1 is the septum (4CH) or the inferior wall\n` +
    ` * (2CH), side 2 the lateral or the anterior wall. Aggregate statistics only.\n` +
    ` *\n` +
    ` * Source: CAMUS — S. Leclerc et al., "Deep Learning for Segmentation Using an Open Large-Scale Dataset in 2D\n` +
    ` * Echocardiography", IEEE TMI 38(9):2198-2210, 2019, doi:10.1109/TMI.2019.2900516.\n` +
    ` */\n` +
    `import type { Quartiles } from './camusImageStats';\n` +
    `import type { SurroundingsMetric } from '../surroundings';\n\n` +
    `export const CAMUS_GOOD_SURROUNDINGS: Record<'4CH-ED' | '4CH-ES' | '2CH-ED' | '2CH-ES', Partial<Record<SurroundingsMetric, Quartiles>>> = {\n${body}};\n`;
  writeFileSync(surroundingsOut, module);
  process.stdout.write(`surroundings reference written to ${surroundingsOut}\n`);
}

process.stdout.write(
  `\npatients ${patients.length} · sequences by quality ${JSON.stringify(qualityCount)} · frames rejected by the label check ${rejected} · frames missing ${missing}\n`,
);
if (outFile) {
  writeFileSync(outFile, JSON.stringify(report, null, 2));
  process.stdout.write(`aggregate statistics written to ${outFile}\n`);
}
