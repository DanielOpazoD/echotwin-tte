/**
 * Distinguishability score (decision 146): how well a simple classifier tells the simulator's apical images from
 * CAMUS Good ones, on whole-sector statistics that need no labels (src/clinical/sectorStats.ts). A logistic regression
 * is trained on the CAMUS Good frames (4CH and 2CH, ED and ES) against simulated frames of the given cases (both
 * views, both phases, several scatterer seeds) and scored by the area under the ROC curve on held-out folds: 0.5 is
 * chance, 1 finds every simulated image. The standardised weights and the AUC of each statistic alone say what does the
 * telling, which is the list of what to fix next.
 *
 *   CAMUS_DIR=~/datos/CAMUS/database_nifti npx tsx tools/clinical/discriminate.ts [--cases normal-excellent-window]
 *     [--seeds 24] [--limit 500] [--folds 5] [--out summary.json]
 *
 * Clinical data rules (decision 69): CAMUS_DIR must lie outside this public repository and nothing derived from an
 * individual image is written; the summary holds the score, the weights and per-statistic aggregates only.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { parseNifti, type NiftiVolume } from '@/clinical/nifti';
import { identifyLabels, orientApical, type RegionImage } from '@/clinical/regionStats';
import { SECTOR_METRICS, sectorStats, type SectorStats } from '@/clinical/sectorStats';
import { auc, crossValidate, trainLogistic } from '@/clinical/logistic';
import { presentApical, renderApical } from '@/simulator/renderer/clinicalImage';
import { loadCaseById } from '@/cases';

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const cases = (arg('--cases') ?? 'normal-excellent-window').split(',');
const seeds = Number(arg('--seeds') ?? 24);
const limit = Number(arg('--limit') ?? 500);
const folds = Number(arg('--folds') ?? 5);
const outFile = arg('--out');
const repoRoot = resolve(process.cwd());
const camusDir = process.env['CAMUS_DIR'];
if (!camusDir) {
  process.stderr.write('Falta CAMUS_DIR (fuera del repositorio).\n');
  process.exit(1);
}
const camusAbs = resolve(camusDir);
if (camusAbs === repoRoot || camusAbs.startsWith(repoRoot + sep)) {
  process.stderr.write(`CAMUS_DIR (${camusAbs}) está dentro del repositorio público.\n`);
  process.exit(2);
}

function readVolume(path: string): NiftiVolume {
  const raw = readFileSync(path);
  const bytes = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw;
  return parseNifti(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
}
function camusFrame(img: NiftiVolume, gt: NiftiVolume): RegionImage {
  const [w, h] = img.dims;
  const plane = w * h;
  const grey = new Float32Array(plane);
  const labels = new Uint8Array(plane);
  let lo = Infinity,
    hi = -Infinity;
  for (let i = 0; i < plane; i++) {
    const v = img.voxels[i]!;
    grey[i] = v;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
    labels[i] = Math.round(gt.voxels[i]!);
  }
  if (lo < 0 || hi > 255)
    for (let i = 0; i < plane; i++) grey[i] = (255 * (grey[i]! - lo)) / Math.max(1e-6, hi - lo);
  return { width: w, height: h, grey, labels, mmPerPx: [img.spacing[0], img.spacing[1]] };
}
function readCfg(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z]+)\s*:\s*(.+?)\s*$/.exec(line);
    if (m) out[m[1]!] = m[2]!;
  }
  return out;
}

const row = (s: SectorStats): number[] => SECTOR_METRICS.map((k) => s[k]);

// clinical images: every CAMUS Good frame, labels only used to orient the image apex up
const x: number[][] = [],
  y: number[] = [],
  tag: string[] = [];
const patients = readdirSync(camusAbs)
  .filter((n) => /^patient\d+$/.test(n))
  .sort()
  .slice(0, limit);
let clinical = 0;
for (const p of patients)
  for (const ch of ['4CH', '2CH'] as const) {
    if ((readCfg(join(camusAbs, p, `Info_${ch}.cfg`))['ImageQuality'] ?? '') !== 'Good') continue;
    for (const phase of ['ED', 'ES'] as const) {
      const imgPath = join(camusAbs, p, `${p}_${ch}_${phase}.nii.gz`);
      const gtPath = join(camusAbs, p, `${p}_${ch}_${phase}_gt.nii.gz`);
      if (!existsSync(imgPath) || !existsSync(gtPath)) continue;
      const frame = camusFrame(readVolume(imgPath), readVolume(gtPath));
      try {
        identifyLabels(frame.labels, frame.width, frame.height);
      } catch {
        continue;
      }
      x.push(row(sectorStats(orientApical(frame))));
      y.push(0);
      tag.push(`${ch}-${phase}`);
      clinical++;
    }
  }
// simulated images: cases × views × phases × scatterer seeds, default console
let simulated = 0;
for (const caseId of cases) {
  const base = loadCaseById(caseId).seed;
  for (const view of ['a4c', 'a2c'] as const)
    for (const ed of [true, false])
      for (let k = 0; k < seeds; k++) {
        const img = presentApical(renderApical(caseId, view, ed, base + 17 * k + 3), {}, k);
        x.push(row(sectorStats(img)));
        y.push(1);
        tag.push(`${view === 'a4c' ? '4CH' : '2CH'}-${ed ? 'ED' : 'ES'}`);
        simulated++;
      }
}
process.stdout.write(
  `clinical ${clinical} · simulated ${simulated} (${cases.join(', ')} × ${seeds} seeds)\n`,
);

const cv = crossValidate(x, y, folds, 7);
process.stdout.write(
  `\nDistinguishability AUC (${folds}-fold, held out): ${cv.auc.toFixed(3)}  folds ${cv.folds.map((f) => f.toFixed(3)).join(' ')}\n` +
    `  (0.5 = the classifier cannot tell; 1 = every simulated image found)\n`,
);
// per condition: the same held-out scores restricted to one view and phase
for (const cond of ['4CH-ED', '4CH-ES', '2CH-ED', '2CH-ES']) {
  const s: number[] = [],
    l: number[] = [];
  for (let i = 0; i < x.length; i++)
    if (tag[i] === cond) {
      s.push(cv.scores[i]!);
      l.push(y[i]!);
    }
  process.stdout.write(`  ${cond}: AUC ${auc(s, l).toFixed(3)} on ${s.length} images\n`);
}
// what tells them apart: each statistic alone (AUC of the raw value, oriented so that > 0.5 means higher in the
// simulator), and the standardised weights of the full model
const single = SECTOR_METRICS.map((k, j) => {
  const v = x.map((r) => r[j]!);
  const ok = v.map((t, i) => (Number.isFinite(t) ? i : -1)).filter((i) => i >= 0);
  const a = auc(
    ok.map((i) => v[i]!),
    ok.map((i) => y[i]!),
  );
  const med = (cls: number): number => {
    const s = ok
      .filter((i) => y[i] === cls)
      .map((i) => v[i]!)
      .sort((p, q) => p - q);
    return s.length ? s[s.length >> 1]! : NaN;
  };
  return { metric: k, auc: a, clinicalMedian: med(0), simulatedMedian: med(1) };
});
const model = trainLogistic(x, y);
const weights = SECTOR_METRICS.map((k, j) => ({ metric: k, weight: model.weights[j]! }));
process.stdout.write(
  '\nEach statistic alone (AUC away from 0.5 = it tells; medians clinical | simulated):\n',
);
for (const s of [...single].sort((a, b) => Math.abs(b.auc - 0.5) - Math.abs(a.auc - 0.5)))
  process.stdout.write(
    `  ${s.metric.padEnd(18)} AUC ${s.auc.toFixed(3)}   ${s.clinicalMedian.toFixed(3).padStart(9)} | ${s.simulatedMedian.toFixed(3).padStart(9)}\n`,
  );
process.stdout.write(
  '\nStandardised weights of the full model (sign: + means higher in the simulator):\n',
);
for (const w of [...weights].sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)).slice(0, 12))
  process.stdout.write(
    `  ${w.metric.padEnd(18)} ${w.weight >= 0 ? '+' : ''}${w.weight.toFixed(3)}\n`,
  );
if (outFile) {
  writeFileSync(
    outFile,
    JSON.stringify(
      {
        clinical,
        simulated,
        cases,
        seeds,
        folds,
        auc: cv.auc,
        foldAucs: cv.folds,
        single,
        weights,
      },
      null,
      2,
    ),
  );
  process.stdout.write(`summary written to ${outFile}\n`);
}
