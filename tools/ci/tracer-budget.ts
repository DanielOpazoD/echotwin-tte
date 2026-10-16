/**
 * Cost guard of the CPU tracer (decision 247). The CPU renderer forms the image where WebGL2 is missing and is the
 * reference the GPU port is checked against; its cost per frame rose 40–70 % over a few weeks of anatomy work without a
 * line in the decisions saying so (engineering review of 2026-09-27). This measures it and fails when it grows more than
 * BUDGET over the recorded baseline, so that a costlier tracer comes with the decision that justifies it.
 *
 * Time is CPU time of this process (`process.cpuUsage`), not wall time, so another process on the machine does not
 * count; and it is divided by the CPU time of a fixed reference kernel measured in the same process. That ratio does not
 * travel between machines (decision 332), so the guard measures the reference tree named in `tracer-budget.json` and
 * this tree on the same machine, alternating, each with its own copy of this tool, and compares the median of the
 * paired ratios with the budget (`tracerBudgetCheck.ts`). Being paired, the comparison holds on any machine.
 *   npx tsx tools/ci/tracer-budget.ts                     # measure this tree and report its ratio
 *   npx tsx tools/ci/tracer-budget.ts --reference <dir>   # compare with the reference tree checked out in <dir>
 *   npx tsx tools/ci/tracer-budget.ts --record N          # print one measurement as JSON (what --reference reads)
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadCaseById } from '@/cases';
import { buildCaseModels, REST_PATIENT } from '@/simulator/anatomy/caseModels';
import { computeHeartPose } from '@/simulator/anatomy/heartModel';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { ProceduralSliceRenderer } from '@/simulator/renderer/procedural/sliceRenderer';
import { scenePhysicsFor } from '@/simulator/renderer/scenePhysics';
import {
  allocPolarFrame,
  DEFAULT_ACQUISITION,
  polarSpecFor,
  type Scene,
} from '@/simulator/renderer/types';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import {
  BUDGET,
  overBudget,
  type Pair,
  pairedGrowth,
  parseRun,
  type Reference,
} from './tracerBudgetCheck';

const VIEWS = ['a4c', 'plax'] as const;
const WARMUP = 4;
const FRAMES = 12;

const cpuMs = (run: () => void): number => {
  const u0 = process.cpuUsage();
  run();
  const u = process.cpuUsage(u0);
  return (u.user + u.system) / 1000;
};
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

/**
 * A fixed kernel of the tracer's kind of arithmetic (vector lengths, square roots, exponentials over typed arrays): the
 * unit the tracer's cost is expressed in. It must never change, or every baseline goes with it.
 */
function kernel(): number {
  const n = 1 << 16;
  const a = new Float32Array(n);
  let acc = 0;
  for (let pass = 0; pass < 24; pass++)
    for (let i = 0; i < n; i++) {
      const x = ((i * 2654435761) >>> 0) / 4294967296 - 0.5;
      const y = ((i * 40503 + pass * 97) % 65536) / 65536 - 0.5;
      const r = Math.sqrt(x * x + y * y + 0.01);
      a[i] = a[i]! * 0.5 + Math.exp(-r * 3) * Math.cos(r * 17 + pass);
      acc += a[i]!;
    }
  return acc;
}

function tracerMsPerFrame(): number {
  const c = loadCaseById('normal-excellent-window');
  const { heart, thorax, tables } = buildCaseModels(c, REST_PATIENT);
  const settings = { ...DEFAULT_ACQUISITION };
  const spec = polarSpecFor(settings, 'medium');
  const renderer = new ProceduralSliceRenderer();
  const frame = allocPolarFrame(spec);
  // the mean of the views' medians: one noisy view does not decide, and each view weighs the same
  const medians: number[] = [];
  for (const id of VIEWS) {
    const per: number[] = [];
    const beam = beamFrameFromPose(
      poseFromControl(thorax, canonicalControl(getViewTarget(id), heart, thorax)),
      1,
    );
    for (let i = 0; i < WARMUP + FRAMES; i++) {
      const phase = (i % 8) / 8;
      const scene: Scene = {
        heart,
        heartPose: computeHeartPose(heart, cycleStateAt(tables, phase)),
        thorax,
        physics: scenePhysicsFor(c, settings),
      };
      const ms = cpuMs(() => renderer.render(scene, beam, spec, phase, frame));
      if (i >= WARMUP) per.push(ms);
    }
    medians.push(median(per));
  }
  return medians.reduce((a, b) => a + b, 0) / medians.length;
}

/** Measures one tree with its own copy of this tool, in a process of its own. */
function measureTree(dir: string): ReturnType<typeof parseRun> {
  const r = spawnSync('npx', ['tsx', 'tools/ci/tracer-budget.ts', '--record', '1'], {
    cwd: dir,
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`measuring ${dir} failed:\n${r.stdout}\n${r.stderr}`);
  return parseRun(r.stdout);
}

const referenceAt = process.argv.indexOf('--reference');
if (referenceAt >= 0) {
  const refDir = process.argv[referenceAt + 1];
  if (!refDir) throw new Error('--reference needs the directory of the reference tree');
  const { reference, rounds } = JSON.parse(
    readFileSync(join(process.cwd(), 'tools', 'ci', 'tracer-budget.json'), 'utf8'),
  ) as { reference: Reference; rounds: number };
  const pairs: Pair[] = [];
  for (let i = 0; i < rounds; i++) {
    // the order alternates, so that a drift of the machine over the run weighs on both trees alike
    const first = i % 2 === 0 ? 'ref' : 'head';
    const a = measureTree(first === 'ref' ? refDir : process.cwd());
    const b = measureTree(first === 'ref' ? process.cwd() : refDir);
    const pair = first === 'ref' ? { ref: a, head: b } : { head: a, ref: b };
    pairs.push(pair);
    process.stdout.write(
      `round ${i + 1}: this tree ${pair.head.msPerFrame.toFixed(1)} ms/frame (kernel ${pair.head.kernelMs.toFixed(1)}), ` +
        `reference ${pair.ref.msPerFrame.toFixed(1)} ms/frame (kernel ${pair.ref.kernelMs.toFixed(1)})\n`,
    );
  }
  const growth = pairedGrowth(pairs);
  const at = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: refDir,
    encoding: 'utf8',
  }).stdout.trim();
  const which =
    at === reference.commit
      ? `the tree of decision ${reference.decision} (${reference.commit.slice(0, 7)})`
      : `the tree in ${refDir} (${at.slice(0, 7) || 'not a git checkout'}; tracer-budget.json names ${reference.commit.slice(0, 7)}, decision ${reference.decision})`;
  const line = `CPU tracer: ${((growth - 1) * 100).toFixed(1)} % over ${which}, measured on this machine in ${rounds} alternated rounds; limit ${((BUDGET - 1) * 100).toFixed(0)} %`;
  process.stdout.write(`${line}\n`);
  if (process.env['CI'])
    process.stdout.write(
      `::${overBudget(growth) ? 'error' : 'notice'} title=CPU tracer budget::${line}\n`,
    );
  if (overBudget(growth)) {
    process.stdout.write(
      `the CPU tracer costs ${((growth - 1) * 100).toFixed(0)} % more than at decision ${reference.decision}: ` +
        `a costlier tracer needs a decision that explains it, and that decision's commit as the reference in tools/ci/tracer-budget.json\n`,
    );
    process.exit(1);
  }
  process.exit(0);
}

let sink = 0;
for (let i = 0; i < 3; i++) sink += kernel();
const kernelMs = median(Array.from({ length: 9 }, () => cpuMs(() => (sink += kernel()))));
const msPerFrame = tracerMsPerFrame();
const ratio = msPerFrame / kernelMs;
const line = `tracer ${msPerFrame.toFixed(1)} ms/frame (CPU, medium tier, ${VIEWS.join(' + ')}), kernel ${kernelMs.toFixed(1)} ms, ratio ${ratio.toFixed(3)}`;
// the kernel's result is used, so that no compiler can drop the work it measures
if (!Number.isFinite(sink)) throw new Error('reference kernel diverged');

if (process.argv.includes('--record')) {
  // the format every version of this tool prints since decision 247: a line, then the measurement as JSON
  process.stdout.write(
    `${line}\n${JSON.stringify({ ratio: +ratio.toFixed(3), msPerFrame: +msPerFrame.toFixed(1), kernelMs: +kernelMs.toFixed(1) }, null, 2)}\n`,
  );
  process.exit(0);
}
process.stdout.write(
  `${line}\nthe ratio alone does not travel between machines: compare with --reference <dir of the reference tree> (decision 332)\n`,
);
