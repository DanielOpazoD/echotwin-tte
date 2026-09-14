/**
 * CLI: CAMUS_DIR=/ruta/fuera/del/repo/database_nifti npx tsx tools/clinical/camus-compare.ts [--limit N] [--out stats.json]
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
import { identifyLabels, imageStats, orientApical, type ImageStats, type RegionImage } from '@/clinical/regionStats';
import { apicalStats, meanStat, renderApical, type ApicalRender, type ConsoleOverride } from '@/simulator/renderer/clinicalImage';
import { DEFAULT_ACQUISITION } from '@/simulator/renderer/types';

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const limit = Number(arg('--limit') ?? '500');
const outFile = arg('--out');
const referenceOut = arg('--reference-out');
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
  process.stderr.write(`CAMUS_DIR (${camusAbs}) está dentro del repositorio público. Muévelo fuera: los datos clínicos no pueden acabar en git.\n`);
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
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < plane; i++) {
    const v = img.voxels[i + t * plane]!;
    grey[i] = v;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
    labels[i] = Math.round(gt.voxels[i + t * plane]!);
  }
  if (lo < 0 || hi > 255) for (let i = 0; i < plane; i++) grey[i] = (255 * (grey[i]! - lo)) / Math.max(1e-6, hi - lo);
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
interface Quartiles { median: number; p10: number; p25: number; p75: number; p90: number; n: number }
const quantiles = (v: number[]): Quartiles => {
  const s = v.filter(Number.isFinite).sort((a, b) => a - b);
  const at = (q: number): number => (s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))]! : NaN);
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
let rejected = 0, missing = 0;
const qualityCount: Record<string, number> = {};
const patients = readdirSync(camusAbs).filter((n) => /^patient\d+$/.test(n)).sort().slice(0, limit);
for (const p of patients)
  for (const ch of ['4CH', '2CH'] as const) {
    const quality = readCfg(join(camusAbs, p, `Info_${ch}.cfg`))['ImageQuality'] ?? 'Unknown';
    qualityCount[quality] = (qualityCount[quality] ?? 0) + 1;
    for (const phase of ['ED', 'ES'] as const) {
      const imgPath = join(camusAbs, p, `${p}_${ch}_${phase}.nii.gz`);
      const gtPath = join(camusAbs, p, `${p}_${ch}_${phase}_gt.nii.gz`);
      if (!existsSync(imgPath) || !existsSync(gtPath)) { missing++; continue; }
      const img = readVolume(imgPath), gt = readVolume(gtPath);
      if (img.dims[0] !== gt.dims[0] || img.dims[1] !== gt.dims[1]) { rejected++; continue; }
      const frame = camusFrame(img, gt, 0);
      try {
        identifyLabels(frame.labels, frame.width, frame.height);
      } catch {
        rejected++; // label geometry does not match the convention: never measure on a guess
        continue;
      }
      const st = imageStats(orientApical(frame));
      push(`${ch}-${phase}-all`, st);
      push(`${ch}-${phase}-${quality}`, st);
    }
  }

// each simulator view is rendered once; consoles only change its presentation, averaged over receiver-noise realizations
const renders = new Map<string, ApicalRender>();
const simStats = (caseId: string, view: 'a4c' | 'a2c', phase: 'ED' | 'ES', consoleOverride: ConsoleOverride = {}): ImageStats[] => {
  const key = `${caseId}|${view}|${phase}`;
  if (!renders.has(key)) renders.set(key, renderApical(caseId, view, phase === 'ED'));
  return apicalStats(renders.get(key)!, consoleOverride);
};

const report: Record<string, unknown> = {
  source: 'CAMUS — Leclerc et al., IEEE TMI 38(9):2198-2210, 2019, doi:10.1109/TMI.2019.2900516 (aggregate statistics only)',
  patients: patients.length,
  sequencesByQuality: qualityCount,
  rejectedFrames: rejected,
  missingFrames: missing,
  comparisons: {},
};
const VIEWS = [['4CH', 'a4c'], ['2CH', 'a2c']] as const;
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
      process.stdout.write(`\n=== ${label} — ${ch} ${phase} (CAMUS ${quality} n=${clin.length}, all n=${all.length}) vs simulator ${view}\n`);
      const rows: Record<string, unknown> = {};
      for (const [, name, get] of METRICS) {
        const q = quantiles(clin.map(get));
        const qa = quantiles(all.map(get));
        const s = meanStat(sim, get);
        const inside = Number.isFinite(q.p25) && s >= q.p25 && s <= q.p75;
        process.stdout.write(`  ${name.padEnd(38)} ${quality.padEnd(4)} ${q.median.toFixed(2).padStart(7)} [${q.p25.toFixed(2)}–${q.p75.toFixed(2)}]  all ${qa.median.toFixed(2).padStart(7)}   sim ${s.toFixed(2).padStart(7)}  ${Number.isFinite(q.median) ? (inside ? 'within IQR' : 'OUTSIDE IQR') : ''}\n`);
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
  const results: { cfg: string; score: number; override: ConsoleOverride }[] = [];
  process.stdout.write('\n=== console sweep against CAMUS Good: mean |sim - median| / IQR over 4 conditions (lower is better)\n');
  for (const grayMap of ['clinical', 's-curve', 'linear', 'high-contrast'] as const)
    for (const dynamicRangeDb of [55, 60, 65, 70, 75, 80])
      for (const gainDb of [-4, -2, 0, 2, 4]) {
        const override: ConsoleOverride = { grayMap, dynamicRangeDb, gainDb };
        let sum = 0, n = 0;
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
          }
        const cfg = `${grayMap} DR ${dynamicRangeDb} gain ${gainDb}`;
        results.push({ cfg, score: sum / Math.max(1, n), override });
      }
  results.sort((x, y) => x.score - y.score);
  for (const r of results.slice(0, 12)) process.stdout.write(`  ${r.cfg.padEnd(30)} score ${r.score.toFixed(2)}\n`);
  const d = DEFAULT_ACQUISITION;
  const current = results.find((r) => r.override.grayMap === d.grayMap && r.override.dynamicRangeDb === d.dynamicRangeDb && r.override.gainDb === d.gainDb);
  process.stdout.write(`\nbest console: ${results[0]!.cfg} (score ${results[0]!.score.toFixed(2)}); current default ${d.grayMap} DR ${d.dynamicRangeDb} gain ${d.gainDb}: ${current ? current.score.toFixed(2) : 'not in the grid'}; worst: ${results.at(-1)!.cfg} (${results.at(-1)!.score.toFixed(2)})\n`);
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

process.stdout.write(`\npatients ${patients.length} · sequences by quality ${JSON.stringify(qualityCount)} · frames rejected by the label check ${rejected} · frames missing ${missing}\n`);
if (outFile) {
  writeFileSync(outFile, JSON.stringify(report, null, 2));
  process.stdout.write(`aggregate statistics written to ${outFile}\n`);
}
