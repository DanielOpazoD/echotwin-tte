/**
 * The verdict of the CPU tracer's cost guard (decisions 247 and 332), kept apart from the measurement so that a test can
 * hold it.
 *
 * Decision 247 compared the ratio of the tracer's CPU time to that of a fixed arithmetic kernel with one recorded
 * number. That ratio does not travel between machines: on 16 runners sampled on 16 October 2026, the same tree of
 * decision 247 gave 0.95–1.21, varying ±7 % even between machines of one processor model, and the guard failed on
 * `main` whenever a slow machine came up. Measured on the same machine, one after the other, the two trees kept a
 * steady proportion: 1.235 ± 0.030 across five processor models. So the guard now measures a reference tree (a commit
 * named in `tracer-budget.json`) and the tree under test on the same machine, alternating, and compares the median of
 * the paired ratios with the budget.
 */

/** How much the paired ratio may grow over the reference tree before the guard fails. */
export const BUDGET = 1.25;

/** One measurement of one tree, as its `tracer-budget.ts --record` prints it. */
export interface Run {
  msPerFrame: number;
  kernelMs: number;
}

export interface Reference {
  /** The commit whose tree is the reference: raising it takes a decision that explains the cost. */
  commit: string;
  /** The decision that tree closes. */
  decision: number;
  /** The decision that set it as the reference. */
  recordedBy: number;
}

export interface Pair {
  head: Run;
  ref: Run;
}

const ratio = (r: Run): number => r.msPerFrame / r.kernelMs;

/**
 * The run in the output of `tracer-budget.ts --record`: the last JSON object it prints. Every version of the tool since
 * decision 247 prints one with `msPerFrame` and `kernelMs`, so an old reference tree can be measured with its own tool.
 */
export function parseRun(stdout: string): Run {
  const start = stdout.lastIndexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error(`no measurement in the output:\n${stdout}`);
  const o = JSON.parse(stdout.slice(start, end + 1)) as Partial<Run>;
  if (!(Number(o.msPerFrame) > 0 && Number(o.kernelMs) > 0))
    throw new Error(`the measurement lacks msPerFrame or kernelMs:\n${stdout}`);
  return { msPerFrame: Number(o.msPerFrame), kernelMs: Number(o.kernelMs) };
}

/** The growth of the tree under test over the reference: the median, over rounds, of the ratio of the paired ratios. */
export function pairedGrowth(pairs: readonly Pair[]): number {
  if (pairs.length === 0) throw new Error('no rounds measured');
  const g = pairs.map((p) => ratio(p.head) / ratio(p.ref)).sort((a, b) => a - b);
  const mid = Math.floor(g.length / 2);
  return g.length % 2 ? g[mid]! : (g[mid - 1]! + g[mid]!) / 2;
}

export const overBudget = (growth: number): boolean => growth > BUDGET;
