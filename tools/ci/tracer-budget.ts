/**
 * Cost guard of the CPU tracer (decision 247). The CPU renderer forms the image where WebGL2 is missing and is the
 * reference the GPU port is checked against; its cost per frame rose 40–70 % over a few weeks of anatomy work without a
 * line in the decisions saying so (engineering review of 2026-09-27). This measures it and fails when it grows more than
 * BUDGET over the recorded baseline, so that a costlier tracer comes with the decision that justifies it.
 *
 * Time is CPU time of this process (`process.cpuUsage`), not wall time, so another process on the machine does not
 * count; and it is divided by the CPU time of a fixed reference kernel measured in the same process, so that a faster or
 * slower machine moves both alike. The ratio is compared only on CI (`CI` set), where the baseline was measured; on other
 * machines it is reported.
 *   npx tsx tools/ci/tracer-budget.ts            # measure and compare
 *   npx tsx tools/ci/tracer-budget.ts --record N # print the JSON of a new baseline set by decision N
 */
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

/** How much the ratio may grow over the baseline before the guard fails. */
const BUDGET = 1.25;
const VIEWS = ['a4c', 'plax'] as const;
const WARMUP = 4;
const FRAMES = 12;

interface Baseline {
  ratio: number;
  /** The decision that set it: raising the baseline takes a decision that explains the cost. */
  decision: number;
  msPerFrame: number;
  kernelMs: number;
}

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

let sink = 0;
for (let i = 0; i < 3; i++) sink += kernel();
const kernelMs = median(Array.from({ length: 9 }, () => cpuMs(() => (sink += kernel()))));
const msPerFrame = tracerMsPerFrame();
const ratio = msPerFrame / kernelMs;
const line = `tracer ${msPerFrame.toFixed(1)} ms/frame (CPU, medium tier, ${VIEWS.join(' + ')}), kernel ${kernelMs.toFixed(1)} ms, ratio ${ratio.toFixed(3)}`;
// the kernel's result is used, so that no compiler can drop the work it measures
if (!Number.isFinite(sink)) throw new Error('reference kernel diverged');

const recordAt = process.argv.indexOf('--record');
if (recordAt >= 0) {
  const decision = Number(process.argv[recordAt + 1]);
  if (!(decision > 0))
    throw new Error('--record needs the number of the decision that sets the baseline');
  process.stdout.write(
    `${line}\n${JSON.stringify({ ratio: +ratio.toFixed(3), decision, msPerFrame: +msPerFrame.toFixed(1), kernelMs: +kernelMs.toFixed(1) }, null, 2)}\n`,
  );
  process.exit(0);
}
const baseline = JSON.parse(
  readFileSync(join(process.cwd(), 'tools', 'ci', 'tracer-budget.json'), 'utf8'),
) as Baseline;
if (!(baseline.ratio > 0)) {
  // no baseline recorded yet: report the runner's ratio so one can be set from it
  process.stdout.write(`${line}\nno baseline recorded yet (tools/ci/tracer-budget.json)\n`);
  process.exit(0);
}
const growth = ratio / baseline.ratio;
process.stdout.write(
  `${line}\nbaseline ${baseline.ratio.toFixed(3)} (decision ${baseline.decision}): ${((growth - 1) * 100).toFixed(1)} %\n`,
);
if (!process.env['CI']) {
  process.stdout.write(
    'not on CI: the ratio is reported, not compared (the baseline is a CI runner’s)\n',
  );
} else if (growth > BUDGET) {
  process.stdout.write(
    `the CPU tracer costs ${((growth - 1) * 100).toFixed(0)} % more than at decision ${baseline.decision}: ` +
      `a costlier tracer needs a decision that explains it, and a new baseline (--record N) in tools/ci/tracer-budget.json\n`,
  );
  process.exit(1);
}
