/**
 * The realism bench (decision 344), one command:
 *
 *   npm run realism -- [--out dir] [--jobs N] [--cases a,b] [--views plax,psax-mv,a4c,a2c]
 *                      [--turing <folder outside the repo>] [--per-view 6] [--seed 1] [--clip-seconds 2]
 *                      [--answers <folder of respuestas-*.json>] [--camus-limit N] [--echonet-videos 40]
 *                      [--report docs/validation/banco-realismo.md] [--quick]
 *                      [--engine actual] [--baseline <baseline.json> | --no-baseline] [--save-baseline <file>] [--strict]
 *
 * 1. Phantoms of the image formation against the Field II–style reference (`phantoms.ts`).
 * 2. One cycle of each view and case through the app's CPU chain at 50 frames/s (`simCine.ts`), measured by
 *    `cineMetrics.ts`; the four-chamber view once more without clutter, to attribute the strain it reads.
 * 3. CAMUS (CAMUS_DIR, or ~/datos/CAMUS/database_nifti when it exists) and EchoNet-Dynamic (ECHONET_DIR) aggregates.
 * 4. With --turing, a blinded sitting of the visual Turing test in that folder; with --answers, its graded sheets.
 * 5. results.json (aggregates only) and the Spanish report (informe.md, and --report). With a baseline (by default the
 *    committed `baseline.json`, the current model), each gap is compared with it and the verdict printed: the change
 *    brings the simulator closer, moves it away, or both (decision 345); --strict exits 1 when any gap worsens.
 *
 * Clinical data never enters the repository (decision 69): the clinical folders and the Turing folder must lie outside
 * it, and nothing derived from an individual clinical image is written to --out.
 */
import { spawn, spawnSync } from 'node:child_process';
import { loadCaseById } from '@/cases';
import { once } from 'node:events';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { cpus, homedir } from 'node:os';
import { join } from 'node:path';
import type { ClipItem } from '@/clinical/realism/turing';
import { gradeTuring, type AnswerSheet, type Trial } from '@/clinical/realism/turing';
import { tissueDecorrelation } from '@/clinical/realism/speckleTracking';
import { seededRandom } from '@/clinical/realism/turing';
import { compareGaps, toBaseline, type Baseline } from '@/clinical/realism/verdict';
import type { Cine } from './simCine';
import { engineById, type CineVariant } from './engines';
import { cineMetrics, type CineMetrics } from './cineMetrics';
import {
  assertOutsideRepo,
  camusSummary,
  ECHONET_DECORRELATION,
  echonetSummary,
} from './clinicalData';
import { hasFfmpeg, toEchonet, toTile, writeMp4, writePngGrey, type Grey } from './formats';
import { exportTuring } from './turingExport';
import { aggregate, reportMd } from './report';

/**
 * The healthy heart first (Daniel, 2026-10-18): the normal case with an excellent window, the one compared with CAMUS
 * Good, and with a difficult one. Pathologies are measured on request (`--cases`).
 */
export const DEFAULT_CASES = ['normal-excellent-window', 'normal-difficult-window'];
/** Scatterer realizations of each simulated clip of the Turing test, so a sitting has enough clips of each kind. */
export const TURING_REALIZATIONS = 4;
export const DEFAULT_VIEWS = ['plax', 'psax-mv', 'a4c', 'a2c'];
/** The bench's cine rate: CAMUS sequences (~48 Hz) and EchoNet videos (50 Hz) are acquired near it. */
export const BENCH_FPS = 50;
/** The committed baseline: the current model at the commit it names (decision 345). */
export const DEFAULT_BASELINE = 'tools/offline/realism/baseline.json';

export interface CineJob {
  engine: string;
  caseId: string;
  view: string;
  variant: CineVariant;
  /** 0: the case's own scatterers, measured; k > 0: another realization, only for the Turing clips. */
  realization: number;
  /** Folder for the Turing clips of this cine (outside the repo), or null. */
  staging: string | null;
  clipSeconds: number;
}

export interface CineResult {
  job: CineJob;
  metrics: CineMetrics;
  /** Frame-to-frame correlation of the cine in EchoNet's format, by grey alone (as on EchoNet). */
  echonetDecorrelation: { peak: number; zeroShift: number; pairs: number };
  clips: ClipItem[];
  seconds: number;
}

interface Options {
  out: string;
  jobs: number;
  cases: string[];
  views: string[];
  turing: string | null;
  perView: number;
  seed: number;
  clipSeconds: number;
  answers: string | null;
  camusLimit: number;
  echonetVideos: number;
  report: string | null;
  quick: boolean;
  engine: string;
  /** Baseline to compare with (null: none). */
  baseline: string | null;
  saveBaseline: string | null;
  strict: boolean;
  worker: string | null;
}

function parseArgs(argv: string[]): Options {
  const o: Options = {
    out: 'tools/offline/realism/out',
    jobs: Math.max(1, Math.min(4, cpus().length - 2)),
    cases: DEFAULT_CASES,
    views: DEFAULT_VIEWS,
    turing: null,
    perView: 6,
    seed: 1,
    clipSeconds: 2,
    answers: null,
    camusLimit: Infinity,
    echonetVideos: 40,
    report: null,
    quick: false,
    engine: 'actual',
    baseline: existsSync(DEFAULT_BASELINE) ? DEFAULT_BASELINE : null,
    saveBaseline: null,
    strict: false,
    worker: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} necesita un valor`);
      return v;
    };
    if (a === '--out') o.out = next();
    else if (a === '--jobs') o.jobs = Number(next());
    else if (a === '--cases') o.cases = next().split(',');
    else if (a === '--views') o.views = next().split(',');
    else if (a === '--turing') o.turing = next();
    else if (a === '--per-view') o.perView = Number(next());
    else if (a === '--seed') o.seed = Number(next());
    else if (a === '--clip-seconds') o.clipSeconds = Number(next());
    else if (a === '--answers') o.answers = next();
    else if (a === '--camus-limit') o.camusLimit = Number(next());
    else if (a === '--echonet-videos') o.echonetVideos = Number(next());
    else if (a === '--report') o.report = next();
    else if (a === '--quick') o.quick = true;
    else if (a === '--engine') o.engine = next();
    else if (a === '--baseline') o.baseline = next();
    else if (a === '--no-baseline') o.baseline = null;
    else if (a === '--save-baseline') o.saveBaseline = next();
    else if (a === '--strict') o.strict = true;
    else if (a === '--worker') o.worker = next();
    else throw new Error(`argumento desconocido ${a}`);
  }
  if (o.quick) {
    o.cases = o.cases.slice(0, 1);
    o.camusLimit = Math.min(o.camusLimit, 50);
    o.echonetVideos = Math.min(o.echonetVideos, 5);
  }
  return o;
}

/** The simulator's Turing items of a cine: a clip on the tile canvas, stills at ED and ES (apical), an EchoNet clip (A4C). */
function writeSimClips(cine: Cine, job: CineJob): ClipItem[] {
  if (!job.staging || job.variant !== 'default') return [];
  const base = `sim-${job.caseId}-${job.view}-r${job.realization}`;
  const grey = (k: number): Float32Array => cine.frames[k % cine.frames.length]!.grey;
  const W = Math.sqrt(cine.frames[0]!.grey.length);
  const mm: [number, number] = [cine.mmPerPx, cine.mmPerPx];
  const n = Math.max(2, Math.round(job.clipSeconds * cine.fps));
  const items: ClipItem[] = [];
  const what = (s: string): string =>
    `simulador ${job.caseId} ${job.view} realización ${job.realization} ${s}`;
  if (hasFfmpeg()) {
    const tiles: Grey[] = Array.from({ length: n }, (_, k) => toTile(grey(k), W, W, mm));
    writeMp4(join(job.staging, `${base}.mp4`), tiles, cine.fps);
    items.push({
      source: 'sim',
      view: `${job.view}/tile-clip`,
      file: join(job.staging, `${base}.mp4`),
      what: what('clip'),
    });
    if (job.view === 'a4c') {
      const box = (() => {
        // one bounding square for the whole clip, as EchoNet crops a video once
        const f = cine.frames[0]!.grey;
        let x0 = W,
          y0 = W,
          x1 = -1,
          y1 = -1;
        for (let y = 0; y < W; y++)
          for (let x = 0; x < W; x++)
            if (f[x + y * W]! > 0) {
              x0 = Math.min(x0, x);
              x1 = Math.max(x1, x);
              y0 = Math.min(y0, y);
              y1 = Math.max(y1, y);
            }
        return { x0, y0, x1, y1 };
      })();
      const small = Array.from({ length: n }, (_, k) => toEchonet(grey(k), W, W, box));
      writeMp4(join(job.staging, `${base}-112.mp4`), small, cine.fps);
      items.push({
        source: 'sim',
        view: 'a4c/echonet-clip',
        file: join(job.staging, `${base}-112.mp4`),
        what: what('clip EchoNet'),
      });
    }
  }
  if (job.view === 'a4c' || job.view === 'a2c') {
    const es = Math.round(cine.esPhase * cine.rrS * cine.fps) % cine.frames.length;
    for (const [phase, k] of [
      ['ED', 0],
      ['ES', es],
    ] as const) {
      const file = join(job.staging, `${base}-${phase}.png`);
      writePngGrey(file, toTile(grey(k), W, W, mm));
      items.push({ source: 'sim', view: `${job.view}/tile-still`, file, what: what(phase) });
    }
  }
  return items;
}

function runJob(job: CineJob): CineResult | null {
  const t0 = performance.now();
  const seed = job.realization ? loadCaseById(job.caseId).seed + 1000 * job.realization : undefined;
  const cyc = engineById(job.engine).renderCine(job.caseId, job.view, {
    fps: BENCH_FPS,
    variant: job.variant,
    seed,
  });
  if (!cyc) return null;
  const metrics = cineMetrics(cyc);
  const W = Math.sqrt(cyc.frames[0]!.grey.length);
  const small = cyc.frames.map((f) => {
    const g = toEchonet(f.grey, W, W);
    return { width: g.width, height: g.height, grey: Float32Array.from(g.data) };
  });
  const echonetDecorrelation = tissueDecorrelation(small, {
    ...ECHONET_DECORRELATION,
    rand: seededRandom(343),
  });
  // a clip longer than a cycle repeats the cycle, as a loop of the scanner's cine memory
  const clips = writeSimClips(cyc, job);
  return { job, metrics, echonetDecorrelation, clips, seconds: (performance.now() - t0) / 1000 };
}

async function runChild(jobs: CineJob[], k: number, out: string): Promise<CineResult[]> {
  const file = join(out, `.jobs-${k}.json`);
  writeFileSync(file, JSON.stringify(jobs));
  const child = spawn(process.execPath, [...process.execArgv, process.argv[1]!, '--worker', file], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const results: CineResult[] = [];
  let buf = '';
  child.stdout.on('data', (d: Buffer) => {
    buf += d.toString();
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines)
      if (line.startsWith('RESULT ')) results.push(JSON.parse(line.slice(7)) as CineResult);
      else if (line.trim()) process.stdout.write(`[${k}] ${line}\n`);
  });
  const [code] = (await once(child, 'close')) as [number];
  unlinkSync(file);
  if (code !== 0) throw new Error(`el proceso ${k} terminó con ${code}`);
  return results;
}

function gradeAnswers(
  turingDir: string,
  answersDir: string,
): (ReturnType<typeof gradeTuring> & { reader: string; echoReader: boolean })[] | null {
  const keyPath = join(turingDir, 'key.json');
  if (!existsSync(keyPath)) return null;
  const key = (JSON.parse(readFileSync(keyPath, 'utf8')) as { key: Trial['key'] }).key;
  return readdirSync(answersDir)
    .filter((f) => /^respuestas-.*\.json$/.test(f))
    .map((f) => {
      const sheet = JSON.parse(readFileSync(join(answersDir, f), 'utf8')) as AnswerSheet;
      return { reader: sheet.reader, echoReader: sheet.echoReader, ...gradeTuring(key, sheet) };
    });
}

async function main(o: Options): Promise<void> {
  const t0 = performance.now();
  mkdirSync(o.out, { recursive: true });
  const log = (s: string): void => void process.stdout.write(`${s}\n`);
  const turingDir = o.turing ? assertOutsideRepo(o.turing, '--turing') : null;
  const staging = turingDir ? join(turingDir, '.staging') : null;
  if (staging) mkdirSync(staging, { recursive: true });

  const engine = engineById(o.engine);
  log(`motor: ${engine.id} (${engine.label})`);
  log(`1/5 fantomas ${engine.phantoms ? '' : '(el motor no tiene los suyos: se omiten)'}…`);
  const phantoms = engine.phantoms ? engine.phantoms() : null;

  const jobs: CineJob[] = [];
  for (const caseId of o.cases)
    for (const view of o.views) {
      jobs.push({
        engine: engine.id,
        caseId,
        view,
        variant: 'default',
        realization: 0,
        staging,
        clipSeconds: o.clipSeconds,
      });
      if (staging)
        for (let k = 1; k < TURING_REALIZATIONS; k++)
          jobs.push({
            engine: engine.id,
            caseId,
            view,
            variant: 'default',
            realization: k,
            staging,
            clipSeconds: o.clipSeconds,
          });
      if (view === 'a4c')
        jobs.push({
          engine: engine.id,
          caseId,
          view,
          variant: 'noclutter',
          realization: 0,
          staging: null,
          clipSeconds: 0,
        });
    }
  log(`2/5 ${jobs.length} cines del simulador con ${Math.min(o.jobs, jobs.length)} proceso(s)…`);
  const n = Math.max(1, Math.min(o.jobs, jobs.length));
  const chunks: CineJob[][] = Array.from({ length: n }, () => []);
  jobs.forEach((j, i) => chunks[i % n]!.push(j));
  const cines = (await Promise.all(chunks.map((c, k) => runChild(c, k, o.out)))).flat();

  const camusDir =
    process.env['CAMUS_DIR'] ??
    (existsSync(join(homedir(), 'datos/CAMUS/database_nifti'))
      ? join(homedir(), 'datos/CAMUS/database_nifti')
      : null);
  log(`3/5 CAMUS ${camusDir ? `(${camusDir})` : '(sin CAMUS_DIR: se omite)'}…`);
  const camus = camusDir
    ? camusSummary(assertOutsideRepo(camusDir, 'CAMUS_DIR'), o.camusLimit)
    : null;
  const echonetDir = process.env['ECHONET_DIR'] ?? null;
  log(`   EchoNet ${echonetDir ? `(${echonetDir})` : '(sin ECHONET_DIR: se omite)'}…`);
  const echonet = echonetDir
    ? echonetSummary(assertOutsideRepo(echonetDir, 'ECHONET_DIR'), o.echonetVideos)
    : null;

  log(`4/5 prueba de Turing ${turingDir ? `en ${turingDir}` : '(sin --turing: se omite)'}…`);
  const turing = turingDir
    ? exportTuring(
        {
          dir: turingDir,
          perView: o.perView,
          seed: o.seed,
          clipSeconds: o.clipSeconds,
          camusDir: camusDir ? assertOutsideRepo(camusDir, 'CAMUS_DIR') : null,
          echonetDir: echonetDir ? assertOutsideRepo(echonetDir, 'ECHONET_DIR') : null,
          extraDir: process.env['REALISM_REAL_DIR']
            ? assertOutsideRepo(process.env['REALISM_REAL_DIR'], 'REALISM_REAL_DIR')
            : null,
        },
        cines.flatMap((c) => c.clips),
      )
    : null;
  const graded = turingDir && o.answers ? gradeAnswers(turingDir, o.answers) : null;

  log('5/5 informe…');
  const results = aggregate({
    phantoms,
    cines,
    camus,
    echonet,
    turing,
    graded,
    sources: { camus: camusDir !== null, echonet: echonetDir !== null },
    wallSeconds: (performance.now() - t0) / 1000,
    engine: { id: engine.id, label: engine.label, commit: gitCommit() },
  });
  if (o.baseline) {
    const base = JSON.parse(readFileSync(o.baseline, 'utf8')) as Baseline;
    results.comparison = {
      baseline: { engine: base.engine, commit: base.commit, generatedAt: base.generatedAt },
      ...compareGaps(base.gaps, results.gaps),
    };
  }
  writeFileSync(join(o.out, 'results.json'), JSON.stringify(results, null, 1));
  if (o.saveBaseline)
    writeFileSync(
      o.saveBaseline,
      JSON.stringify(
        toBaseline(engine.id, results.engine.commit, results.generatedAt, results.gaps),
        null,
        1,
      ) + '\n',
    );
  const md = reportMd(results);
  writeFileSync(join(o.out, 'informe.md'), md);
  if (o.report) writeFileSync(o.report, md);
  log(
    `listo en ${((performance.now() - t0) / 60000).toFixed(1)} min: ${join(o.out, 'informe.md')}${o.report ? ` y ${o.report}` : ''}`,
  );
  const c = results.comparison;
  if (c) {
    log(
      `frente a la línea base (${c.baseline.engine} @ ${c.baseline.commit}): ${c.verdict} — mejoran ${c.improved}, empeoran ${c.worsened}, iguales ${c.unchanged}`,
    );
    if (o.strict && c.worsened > 0) process.exitCode = 1;
  }
}

/** The short hash of the commit measured, with a mark when the tree has uncommitted changes. */
function gitCommit(): string {
  const head = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
    encoding: 'utf8',
  }).stdout.trim();
  const dirty = spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], {
    encoding: 'utf8',
  }).stdout.trim();
  return `${head || 'desconocido'}${dirty ? '+cambios' : ''}`;
}

const opts = parseArgs(process.argv.slice(2));
if (opts.worker) {
  const jobs = JSON.parse(readFileSync(opts.worker, 'utf8')) as CineJob[];
  for (const job of jobs) {
    const r = runJob(job);
    if (!r) {
      process.stdout.write(`${job.caseId} ${job.view} ${job.variant}: el motor no lo modela\n`);
      continue;
    }
    process.stdout.write(`${job.caseId} ${job.view} ${job.variant}: ${r.seconds.toFixed(0)} s\n`);
    process.stdout.write(`RESULT ${JSON.stringify(r)}\n`);
  }
} else await main(opts);
