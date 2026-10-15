/**
 * Clinical review clips (decision 328): the review of decision 326 as it is lived, not as still frames.
 *   - Cine: for each view and each of the four review cases, one cardiac cycle at 40 fps through the CPU chain
 *     (`ProceduralSliceRenderer` on the polar frame, the console with its persistence, the scan LUT), played in real
 *     time (1×), looping. With `--map`, the labelled structure map of the same polar frame plays beside the echo.
 *   - Probe sweeps: for each window (parasternal, apical, subcostal, suprasternal), from the canonical view of the
 *     first case, two clips at end-diastole: a tilt of ±15° and a rotation of ±30°, in 1° steps at 20 fps (20°/s),
 *     to judge that structures come and go continuously as the probe moves.
 * Each clip is written as an animated GIF (no dependency: 256 colours, delays on a 10 ms grid) and, when `ffmpeg` is on
 * the PATH, as an MP4 too (H.264, full grey scale, exact cadence). An index with the cost of every clip (seconds and
 * bytes) is written to <outDir>/index.md; a GIF over 10 MB is re-encoded dropping every other frame (half the frame
 * rate, the same real time and angular speed) down to 10 fps, then at half the resolution, and the index says so.
 *   npx tsx tools/offline/review/review-clips.ts [--out dir] [--views a,b] [--cases a,b] [--map] [--fps 40]
 *                                                [--only cine|sweep] [--jobs N] [--no-mp4]
 * The clips are rendered by N child processes (default: up to four, leaving two cores free).
 */
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { join } from 'node:path';
import { STRUCTURE_RGB, TISSUE_RGB, type Rgb } from '@/simulator/anatomy/structurePalette';
import { ProceduralSliceRenderer } from '@/simulator/renderer/procedural/sliceRenderer';
import type { PolarFrame } from '@/simulator/renderer/types';
import { beamFrameFromPose, poseFromControl, type ProbeControl } from '@/simulator/probe/pose';
import { canonicalControl, VIEW_TARGETS } from '@/simulator/windows/viewTargets';
import { viewLabel } from '@/simulator/windows/viewLabels';
import { buildPalette, delaysFor, encodeGif, type GifPalette } from './gif';
import {
  ascii,
  blit,
  buildReviewModels,
  consoleStateFor,
  DEFAULT_CASES,
  drawText,
  echoImage,
  fill,
  H,
  putPixel,
  renderPolar,
  type ReviewModel,
  shortCase,
  structureMap,
  W,
} from './reviewFrame';

/** Cine cadence (frames per second of real time); the GIF alternates 2 and 3 cs delays to average it. */
const DEFAULT_FPS = 40;
/** Sweep cadence and step: 1° per frame at 20 fps is 20°/s, about the speed of a deliberate hand. */
const SWEEP_FPS = 20;
const SWEEP_STEP_DEG = 1;
const SWEEP_TILT_DEG = 15;
const SWEEP_ROTATION_DEG = 30;
/** Frames held still at the canonical pose and at each extreme of a sweep (0.25 s). */
const SWEEP_HOLD = 5;
/** The two movements of a sweep, each its own clip so a full-resolution GIF stays under the limit. */
const SWEEP_MOVES = ['tilt', 'rot'] as const;
type SweepMove = (typeof SWEEP_MOVES)[number];
/** The view each window sweeps from. */
const SWEEP_VIEWS: Record<string, string> = {
  parasternal: 'plax',
  apical: 'a4c',
  subcostal: 'subcostal-4c',
  suprasternal: 'suprasternal-arch',
};
/** A GIF above this is re-encoded smaller. */
const GIF_LIMIT_BYTES = 10 * 1024 * 1024;
/** The frame rate under which a GIF is not thinned any further; the resolution is halved instead. */
const GIF_MIN_FPS = 10;
/** Frames of console history before the first encoded frame (0.35⁶ < 0.2 % of persistence left). */
const WARMUP_FRAMES = 6;

const GAP = 6;
const HEADER = 26;
const BACKGROUND: Rgb = [28, 28, 32];
const CAPTION: Rgb = [255, 220, 120];
const BAR: Rgb = [140, 140, 140];
const TICK: Rgb = [255, 255, 255];

interface Options {
  out: string;
  views: string[];
  cases: string[];
  map: boolean;
  fps: number;
  only: 'cine' | 'sweep' | null;
  jobs: number;
  mp4: boolean;
  worker: string | null;
}

interface CineJob {
  kind: 'cine';
  view: string;
  caseId: string;
}
interface SweepJob {
  kind: 'sweep';
  window: string;
  move: SweepMove;
  view: string;
  caseId: string;
}
type Job = CineJob | SweepJob;

interface ClipResult {
  job: Job;
  /** Path of the clip without extension, relative to the output directory. */
  file: string;
  frames: number;
  fps: number;
  durationS: number;
  rrS: number;
  gifBytes: number;
  /** Grey levels and chromatic colours of the GIF palette. */
  greys: number;
  colours: number;
  /** What was reduced to bring the GIF under the limit, if anything. */
  reduced: string;
  mp4Bytes: number | null;
  renderS: number;
  encodeS: number;
}

const opts = parseArgs(process.argv.slice(2));
const ffmpeg = opts.mp4 && hasFfmpeg();

if (opts.worker) {
  const jobs = JSON.parse(readFileSync(opts.worker, 'utf8')) as Job[];
  await runJobs(jobs, (r) => process.stdout.write(`RESULT ${JSON.stringify(r)}\n`));
} else {
  await main();
}

async function main(): Promise<void> {
  mkdirSync(join(opts.out, 'cine'), { recursive: true });
  mkdirSync(join(opts.out, 'sweep'), { recursive: true });
  const jobs: Job[] = [];
  if (opts.only !== 'cine')
    for (const [window, view] of Object.entries(SWEEP_VIEWS))
      if (opts.views.includes(view))
        for (const move of SWEEP_MOVES)
          jobs.push({ kind: 'sweep', window, move, view, caseId: opts.cases[0]! });
  if (opts.only !== 'sweep')
    for (const view of opts.views)
      for (const caseId of opts.cases) jobs.push({ kind: 'cine', view, caseId });
  const t0 = performance.now();
  const results: ClipResult[] = [];
  const jobsN = Math.max(1, Math.min(opts.jobs, jobs.length));
  if (jobsN === 1) await runJobs(jobs, (r) => results.push(r));
  else {
    // the sweeps (80 and 140 frames) come first and are dealt round-robin, so they spread over the processes
    const chunks: Job[][] = Array.from({ length: jobsN }, () => []);
    jobs.forEach((j, i) => chunks[i % jobsN]!.push(j));
    await Promise.all(chunks.map((chunk, k) => runChild(chunk, k, (r) => results.push(r))));
  }
  const wallS = (performance.now() - t0) / 1000;
  writeFileSync(join(opts.out, 'index.md'), indexMd(results, jobs, jobsN, wallS).join('\n') + '\n');
  for (const view of opts.views) {
    const rs = results.filter((r) => r.job.kind === 'cine' && r.job.view === view);
    if (rs.length)
      writeFileSync(join(opts.out, 'cine', `${view}.md`), viewMd(view, rs).join('\n') + '\n');
  }
  process.stdout.write(
    `${results.length} clips en ${wallS.toFixed(0)} s con ${jobsN} proceso(s); índice en ${join(opts.out, 'index.md')}\n`,
  );
}

/** Runs a chunk of jobs in a child process with the same loader and options, and collects its RESULT lines. */
async function runChild(jobs: Job[], k: number, onResult: (r: ClipResult) => void): Promise<void> {
  const file = join(opts.out, `.jobs-${k}.json`);
  writeFileSync(file, JSON.stringify(jobs));
  const args = [
    ...process.execArgv,
    process.argv[1]!,
    '--worker',
    file,
    '--out',
    opts.out,
    '--fps',
    String(opts.fps),
    ...(opts.map ? ['--map'] : []),
    ...(opts.mp4 ? [] : ['--no-mp4']),
  ];
  const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'inherit'] });
  let buf = '';
  child.stdout.on('data', (d: Buffer) => {
    buf += d.toString();
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (line.startsWith('RESULT ')) onResult(JSON.parse(line.slice(7)) as ClipResult);
      else process.stdout.write(`[${k}] ${line}\n`);
    }
  });
  const [code] = (await once(child, 'close')) as [number];
  unlinkSync(file);
  if (code !== 0) throw new Error(`worker ${k} exited with ${code}`);
}

async function runJobs(jobs: Job[], onResult: (r: ClipResult) => void): Promise<void> {
  const caseIds = [...new Set(jobs.map((j) => j.caseId))];
  const models = new Map(buildReviewModels(caseIds).map((m) => [m.c.id, m]));
  const renderer = new ProceduralSliceRenderer();
  const palette = buildPalette(clipColours());
  for (const job of jobs) {
    const r = await renderClip(job, models.get(job.caseId)!, renderer, palette);
    onResult(r);
    process.stdout.write(
      `${r.file}  ${r.frames} fotogramas  render ${r.renderS.toFixed(1)} s  codificar ${r.encodeS.toFixed(1)} s  GIF ${mb(r.gifBytes)}${r.mp4Bytes !== null ? `  MP4 ${mb(r.mp4Bytes)}` : ''}${r.reduced ? `  (${r.reduced})` : ''}\n`,
    );
  }
}

/** One frame of a clip's plan: where the probe is, which phase, and what the caption says. */
interface PlannedFrame {
  ctrl: ProbeControl;
  phase: number;
  caption: string;
}

async function renderClip(
  job: Job,
  m: ReviewModel,
  renderer: ProceduralSliceRenderer,
  palette: GifPalette,
): Promise<ClipResult> {
  const view = VIEW_TARGETS.find((v) => v.id === job.view);
  if (!view) throw new Error(`unknown view ${job.view}`);
  const base = canonicalControl(view, m.heart, m.thorax);
  const title = `${ascii(viewLabel(job.view)).toUpperCase()} · ${shortCase(job.caseId).toUpperCase()}`;
  const fps = job.kind === 'cine' ? opts.fps : SWEEP_FPS;
  const plan: PlannedFrame[] =
    job.kind === 'cine'
      ? cinePlan(base, m, title)
      : sweepPath(job.move).map(({ tilt, rot }) => ({
          ctrl: nudged(base, tilt, rot),
          phase: 0,
          caption: `${title} · TD · ${job.move === 'tilt' ? `INCL ${signed(tilt)}` : `ROT ${signed(rot)}`}`,
        }));
  const file = join(
    job.kind,
    job.kind === 'cine' ? `${job.view}-${job.caseId}` : `${job.window}-${job.move}-${job.caseId}`,
  );
  const width = GAP + W + GAP + (opts.map ? W + GAP : 0);
  const height = HEADER + H + GAP;

  const t0 = performance.now();
  const polar: PolarFrame[] = plan.map((f) =>
    renderPolar(renderer, m, beamFrameFromPose(poseFromControl(m.thorax, f.ctrl), 1), f.phase),
  );
  // the console keeps persistence across frames, as in the app; its history is warmed on the frames that precede
  // the first one (the end of the cycle, or the still canonical pose) so the loop has no cold start
  const cs = consoleStateFor(m);
  for (let i = plan.length - WARMUP_FRAMES; i < plan.length; i++)
    echoImage(polar[((i % plan.length) + plan.length) % plan.length]!, m, cs);
  const ff = ffmpeg ? startFfmpeg(join(opts.out, `${file}.mp4`), width, height, fps) : null;
  const indexed: Uint8Array[] = [];
  const canvas = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < plan.length; i++) {
    const f = plan[i]!;
    const eco = echoImage(polar[i]!, m, cs);
    fill(canvas, BACKGROUND);
    drawText(canvas, width, height, GAP, 6, f.caption, CAPTION);
    if (job.kind === 'cine') drawPhaseBar(canvas, width, f.phase, m.esPhase);
    blit(canvas, width, eco, GAP, HEADER);
    if (opts.map) blit(canvas, width, structureMap(polar[i]!).map, GAP + W + GAP, HEADER);
    indexed.push(palette.index(canvas));
    if (ff) await ff.push(Buffer.from(canvas.buffer, canvas.byteOffset, canvas.byteLength));
  }
  const t1 = performance.now();
  const mp4Bytes = ff ? await ff.finish() : null;
  const gif = encodeGifUnderLimit(width, height, palette, indexed, fps);
  writeFileSync(join(opts.out, `${file}.gif`), gif.bytes);
  const t2 = performance.now();
  return {
    job,
    file,
    frames: plan.length,
    fps,
    durationS: plan.length / fps,
    rrS: m.tables.rrS,
    gifBytes: gif.bytes.length,
    greys: palette.greys,
    colours: palette.colours.length,
    reduced: gif.reduced,
    mp4Bytes,
    renderS: (t1 - t0) / 1000,
    encodeS: (t2 - t1) / 1000,
  };
}

/** One cycle: round(RR × fps) frames, the phase of frame k at k/N, the caption naming TD and TS where they fall. */
function cinePlan(base: ProbeControl, m: ReviewModel, title: string): PlannedFrame[] {
  const n = Math.max(2, Math.round(m.tables.rrS * opts.fps));
  const tsFrame = Math.round(m.esPhase * n) % n;
  return Array.from({ length: n }, (_, k) => {
    const phase = k / n;
    const mark = k === 0 ? ' · TD' : k === tsFrame ? ' · TS' : '';
    return { ctrl: base, phase, caption: `${title} · FASE ${phase.toFixed(2)}${mark}` };
  });
}

/** One movement of the sweep: out, back through the canonical pose, out the other way and home, with holds. */
function sweepPath(move: SweepMove): { tilt: number; rot: number }[] {
  const out: { tilt: number; rot: number }[] = [];
  const at = (a: number) => (move === 'tilt' ? { tilt: a, rot: 0 } : { tilt: 0, rot: a });
  const hold = (a: number) => {
    for (let i = 0; i < SWEEP_HOLD; i++) out.push(at(a));
  };
  const ramp = (from: number, to: number) => {
    const s = Math.sign(to - from) * SWEEP_STEP_DEG;
    for (let a = from + s; s > 0 ? a <= to + 1e-9 : a >= to - 1e-9; a += s) out.push(at(a));
  };
  const A = move === 'tilt' ? SWEEP_TILT_DEG : SWEEP_ROTATION_DEG;
  hold(0);
  ramp(0, A);
  hold(A);
  ramp(A, -A);
  hold(-A);
  ramp(-A, 0);
  hold(0);
  return out;
}

/** The canonical control moved by a tilt and a rotation, within the app's limits (`clampProbe` in the store). */
function nudged(base: ProbeControl, tilt: number, rot: number): ProbeControl {
  const rotationDeg = ((((base.rotationDeg + rot + 180) % 360) + 360) % 360) - 180;
  const tiltDeg = Math.max(-70, Math.min(70, base.tiltDeg + tilt));
  return { ...base, rotationDeg, tiltDeg };
}

function signed(deg: number): string {
  return `${deg < 0 ? '-' : '+'}${String(Math.abs(Math.round(deg))).padStart(2, '0')}`;
}

/** A bar under the caption with the position in the cycle, and a tick at end-systole. */
function drawPhaseBar(
  canvas: Uint8ClampedArray,
  width: number,
  phase: number,
  esPhase: number,
): void {
  const y0 = HEADER - 4;
  const x1 = GAP + Math.round(phase * (W - 1));
  for (let y = y0; y < y0 + 2; y++)
    for (let x = GAP; x <= x1; x++) putPixel(canvas, width, x, y, BAR);
  const xt = GAP + Math.round(esPhase * (W - 1));
  for (let y = y0 - 2; y < y0 + 4; y++) putPixel(canvas, width, xt, y, TICK);
}

/**
 * Every non-grey colour a clip can draw, so the palette is known before the first frame: the map's structure and
 * tissue colours, as drawn and as dimmed behind the pleura (through the same clamped-array rounding as the map), the
 * caption and the background.
 */
function clipColours(): number[] {
  const out: number[] = [];
  const t = new Uint8ClampedArray(3);
  const add = (c: Rgb, k: number) => {
    t[0] = c[0] * k;
    t[1] = c[1] * k;
    t[2] = c[2] * k;
    out.push((t[0] << 16) | (t[1] << 8) | t[2]);
  };
  if (opts.map)
    for (const c of [...Object.values(STRUCTURE_RGB), ...Object.values(TISSUE_RGB)]) {
      add(c, 1);
      add(c, 0.3);
    }
  add(CAPTION, 1);
  add(BACKGROUND, 1);
  return out;
}

/**
 * The GIF, re-encoded while it exceeds the limit: first dropping every other frame (half the frame rate, the same
 * real time and angular speed) down to `GIF_MIN_FPS`, then at half the resolution.
 */
function encodeGifUnderLimit(
  width: number,
  height: number,
  palette: GifPalette,
  frames: Uint8Array[],
  fps: number,
): { bytes: Buffer; reduced: string } {
  let bytes = encodeGif(width, height, palette, frames, delaysFor(frames.length, fps));
  const steps: string[] = [];
  while (bytes.length > GIF_LIMIT_BYTES && fps / 2 >= GIF_MIN_FPS) {
    frames = frames.filter((_, i) => i % 2 === 0);
    fps /= 2;
    steps.push(`fps a ${fps}`);
    bytes = encodeGif(width, height, palette, frames, delaysFor(frames.length, fps));
  }
  if (bytes.length > GIF_LIMIT_BYTES) {
    const w2 = width >> 1,
      h2 = height >> 1;
    frames = frames.map((f) => {
      const g = new Uint8Array(w2 * h2);
      for (let y = 0; y < h2; y++)
        for (let x = 0; x < w2; x++) g[y * w2 + x] = f[2 * y * width + 2 * x]!;
      return g;
    });
    steps.push(`resolución a ${w2}×${h2}`);
    bytes = encodeGif(w2, h2, palette, frames, delaysFor(frames.length, fps));
  }
  return { bytes, reduced: steps.join(', ') };
}

function hasFfmpeg(): boolean {
  return spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
}

/** ffmpeg reading raw RGBA frames on stdin: H.264 at the exact cadence, 4:2:0 (the grey image is untouched). */
function startFfmpeg(
  file: string,
  width: number,
  height: number,
  fps: number,
): { push(frame: Buffer): Promise<void>; finish(): Promise<number> } {
  const args = [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgba',
    '-s',
    `${width}x${height}`,
    '-framerate',
    String(fps),
    '-i',
    'pipe:0',
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '18',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    file,
  ];
  const child = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
  const closed = once(child, 'close') as Promise<[number]>;
  return {
    async push(frame) {
      if (!child.stdin.write(frame)) await once(child.stdin, 'drain');
    },
    async finish() {
      child.stdin.end();
      const [code] = await closed;
      if (code !== 0) throw new Error(`ffmpeg failed on ${file}: ${stderr}`);
      return statSync(file).size;
    },
  };
}

function indexMd(results: ClipResult[], jobs: Job[], jobsN: number, wallS: number): string[] {
  const cine = results.filter((r) => r.job.kind === 'cine');
  const sweeps = results.filter((r) => r.job.kind === 'sweep');
  const greys = results[0]?.greys ?? 0,
    colours = results[0]?.colours ?? 0;
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const lines = [
    '# Clips de revisión clínica',
    '',
    `Generado el ${localStamp()}: ${results.length} clips (${jobs.length} pedidos) en ${(wallS / 60).toFixed(1)} min de reloj con ${jobsN} proceso(s); ${sum(results.map((r) => r.renderS)).toFixed(0)} s de render y ${sum(results.map((r) => r.encodeS)).toFixed(0)} s de codificación sumados.`,
    '',
    `Formato: GIF animado en bucle, 256 colores (${greys} niveles de gris para la eco${opts.map ? ` y ${colours} colores del mapa, el rótulo y el fondo` : ` y ${colours} colores, el rótulo y el fondo`}); ${
      ffmpeg
        ? 'ffmpeg está en el PATH, así que cada clip lleva también un MP4 (H.264, CRF 18, cadencia exacta y escala de grises completa).'
        : 'ffmpeg no está en el PATH: sólo GIF (instálalo para tener además MP4 con cadencia exacta y escala de grises completa).'
    }`,
    `El GIF sólo admite retardos múltiplos de 10 ms: a ${opts.fps} fps alterna retardos de ${Math.floor(100 / opts.fps)} y ${Math.ceil(100 / opts.fps)} cs (media exacta); el MP4 va a ${opts.fps} fps exactos.`,
    `Un GIF que supera ${mb(GIF_LIMIT_BYTES)} se recodifica quitando un fotograma de cada dos (mitad de fps, mismo tiempo real y misma velocidad angular) hasta ${GIF_MIN_FPS} fps y, si no basta, a la mitad de resolución (columna «reducción»); el MP4 no se reduce.`,
    `${opts.map ? 'A la derecha de la eco va el mapa de estructuras rotulado del mismo fotograma polar, atenuado detrás de la pleura (decisión 326).' : 'Sólo la eco; con `--map` va al lado el mapa de estructuras rotulado del mismo fotograma polar.'}`,
    'La consola conserva su persistencia entre fotogramas, como en la app; el historial se calienta con los fotogramas que preceden al primero.',
    '',
    `## Cine: un ciclo cardiaco, tiempo real (1×), ${opts.fps} fps`,
    '',
    'La fase del ciclo va en el rótulo (0 = telediástole) y en la barra bajo él; la marca blanca es la telesístole (menor volumen del VI).',
    '',
  ];
  for (const view of opts.views) {
    const rs = cine.filter((r) => r.job.view === view);
    if (!rs.length) continue;
    lines.push(
      `### ${viewLabel(view)} (${view}) — [los cuatro casos en una página](cine/${view}.md)`,
      '',
    );
    lines.push(
      '| caso | RR (s) | fotogramas | duración (s) | GIF | reducción | MP4 | render (s) | codificación (s) |',
      '|---|---:|---:|---:|---|---|---|---:|---:|',
    );
    for (const r of rs) lines.push(row(r));
    lines.push('');
  }
  if (sweeps.length) {
    lines.push(
      `## Barridos de sonda: telediástole (fase 0), ${SWEEP_FPS} fps, ${SWEEP_STEP_DEG}° por fotograma (${SWEEP_FPS * SWEEP_STEP_DEG}°/s)`,
      '',
      `Desde la vista canónica de la ventana en el caso ${sweeps[0]!.job.caseId}, dos clips: inclinación 0 → +${SWEEP_TILT_DEG}° → −${SWEEP_TILT_DEG}° → 0 (abanico sobre el eje del marcador) y rotación 0 → +${SWEEP_ROTATION_DEG}° → −${SWEEP_ROTATION_DEG}° → 0 (horaria vista por el operador), con ${SWEEP_HOLD} fotogramas (${(SWEEP_HOLD / SWEEP_FPS).toFixed(2)} s) de pausa en la pose canónica y en cada extremo; el rótulo lleva los grados (INCL, ROT).`,
      '',
      '| ventana | movimiento | vista | caso | fotogramas | duración (s) | GIF | reducción | MP4 | render (s) | codificación (s) |',
      '|---|---|---|---|---:|---:|---|---|---|---:|---:|',
    );
    for (const r of sweeps) {
      const j = r.job as SweepJob;
      lines.push(
        `| ${j.window} | ${j.move === 'tilt' ? `inclinación ±${SWEEP_TILT_DEG}°` : `rotación ±${SWEEP_ROTATION_DEG}°`} | ${viewLabel(j.view)} | ${shortCase(j.caseId)} | ${r.frames} | ${r.durationS.toFixed(1)} | [${mb(r.gifBytes)}](${r.file}.gif) | ${r.reduced || '—'} | ${r.mp4Bytes !== null ? `[${mb(r.mp4Bytes)}](${r.file}.mp4)` : '—'} | ${r.renderS.toFixed(1)} | ${r.encodeS.toFixed(1)} |`,
      );
    }
    lines.push('');
  }
  return lines;
}

function row(r: ClipResult): string {
  return `| ${shortCase(r.job.caseId)} | ${r.rrS.toFixed(3)} | ${r.frames} | ${r.durationS.toFixed(2)} | [${mb(r.gifBytes)}](${r.file}.gif) | ${r.reduced || '—'} | ${r.mp4Bytes !== null ? `[${mb(r.mp4Bytes)}](${r.file}.mp4)` : '—'} | ${r.renderS.toFixed(1)} | ${r.encodeS.toFixed(1)} |`;
}

/** A page per view with the cines of the four cases playing inline. */
function viewMd(view: string, rs: ClipResult[]): string[] {
  const lines = [
    `# ${viewLabel(view)} (${view}): cine, tiempo real 1×`,
    '',
    '[índice](../index.md)',
    '',
  ];
  for (const r of rs) {
    const name = `${view}-${r.job.caseId}`;
    lines.push(
      `## ${shortCase(r.job.caseId)} (${r.job.caseId}) — RR ${r.rrS.toFixed(3)} s, ${r.frames} fotogramas a ${r.fps} fps${r.reduced ? ` (${r.reduced})` : ''}${r.mp4Bytes !== null ? ` · [MP4](${name}.mp4)` : ''}`,
      '',
      `![${name}](${name}.gif)`,
      '',
    );
  }
  return lines;
}

/** Local date and time to the minute, as the sheets' reader sees the clock. */
function localStamp(): string {
  const d = new Date();
  const two = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

function mb(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${(bytes / 1024).toFixed(0)} kB`;
}

function parseArgs(argv: string[]): Options {
  const o: Options = {
    out: 'tools/offline/review/out/clips',
    views: VIEW_TARGETS.map((v) => v.id),
    cases: DEFAULT_CASES,
    map: false,
    fps: DEFAULT_FPS,
    only: null,
    jobs: Math.max(1, Math.min(4, cpus().length - 2)),
    mp4: true,
    worker: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--out') o.out = next();
    else if (a === '--views') o.views = next().split(',');
    else if (a === '--cases') o.cases = next().split(',');
    else if (a === '--map') o.map = true;
    else if (a === '--fps') o.fps = Number(next());
    else if (a === '--only') o.only = next() as Options['only'];
    else if (a === '--jobs') o.jobs = Number(next());
    else if (a === '--no-mp4') o.mp4 = false;
    else if (a === '--worker') o.worker = next();
    else throw new Error(`unknown argument ${a}`);
  }
  if (o.only && o.only !== 'cine' && o.only !== 'sweep') throw new Error('--only cine|sweep');
  return o;
}
