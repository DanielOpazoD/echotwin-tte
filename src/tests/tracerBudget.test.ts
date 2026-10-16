/**
 * The CPU tracer's cost guard (decisions 247 and 332) compares a tree with a reference tree measured on the same
 * machine. These hold its verdict, what it reads from each tree's tool, and that CI runs it that way.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BUDGET,
  overBudget,
  pairedGrowth,
  parseRun,
  type Reference,
} from '../../tools/ci/tracerBudgetCheck';

const ROOT = join(__dirname, '..', '..');
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');

describe('the paired verdict of the CPU tracer guard', () => {
  it('reads the measurement from the output of every version of the tool, the one of decision 247 included', () => {
    // verbatim shape of `tracer-budget.ts --record 1` at decision 247 (db5e0c7)
    const at247 =
      'tracer 84.2 ms/frame (CPU, medium tier, a4c + plax), kernel 79.2 ms, ratio 1.064\n' +
      '{\n  "ratio": 1.064,\n  "decision": 1,\n  "msPerFrame": 84.2,\n  "kernelMs": 79.2\n}\n';
    expect(parseRun(at247)).toEqual({ msPerFrame: 84.2, kernelMs: 79.2 });
    const now =
      'tracer 107.6 ms/frame (CPU, medium tier, a4c + plax), kernel 79.3 ms, ratio 1.356\n' +
      '{\n  "ratio": 1.356,\n  "msPerFrame": 107.6,\n  "kernelMs": 79.3\n}\n';
    expect(parseRun(now)).toEqual({ msPerFrame: 107.6, kernelMs: 79.3 });
    expect(() => parseRun('tracer 84.2 ms/frame, no JSON')).toThrow();
    expect(() => parseRun('{ "ratio": 1.1 }')).toThrow();
  });

  it('normalises each run by its own kernel, so a slow spell on one run does not read as growth', () => {
    // round 2: the machine slowed down while the reference ran, tracer and kernel alike
    const g = pairedGrowth([
      { head: { msPerFrame: 60, kernelMs: 50 }, ref: { msPerFrame: 50, kernelMs: 50 } },
      { head: { msPerFrame: 60, kernelMs: 50 }, ref: { msPerFrame: 80, kernelMs: 80 } },
      { head: { msPerFrame: 60, kernelMs: 50 }, ref: { msPerFrame: 50, kernelMs: 50 } },
    ]);
    expect(g).toBeCloseTo(1.2, 6);
  });

  it('takes the median of the rounds, so one disturbed round does not decide', () => {
    const g = pairedGrowth([
      { head: { msPerFrame: 55, kernelMs: 50 }, ref: { msPerFrame: 50, kernelMs: 50 } },
      { head: { msPerFrame: 150, kernelMs: 50 }, ref: { msPerFrame: 50, kernelMs: 50 } },
      { head: { msPerFrame: 54, kernelMs: 50 }, ref: { msPerFrame: 50, kernelMs: 50 } },
    ]);
    expect(g).toBeCloseTo(1.1, 6);
    expect(overBudget(g)).toBe(false);
  });

  it('fails above the budget and not at it', () => {
    expect(BUDGET).toBe(1.25);
    expect(overBudget(1.25)).toBe(false);
    expect(overBudget(1.2501)).toBe(true);
    expect(() => pairedGrowth([])).toThrow();
  });
});

describe('the reference and its wiring in CI', () => {
  const { reference, rounds } = JSON.parse(read('tools/ci/tracer-budget.json')) as {
    reference: Reference;
    rounds: number;
  };

  it('names a full commit, the decision it closes and the decision that set it, measured in an odd number of rounds', () => {
    expect(reference.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(reference.recordedBy).toBeGreaterThan(reference.decision);
    expect(
      read('docs/DECISIONS.md').includes(`\n${reference.recordedBy}. **`),
      `decision ${reference.recordedBy} is in docs/DECISIONS.md`,
    ).toBe(true);
    expect(rounds % 2).toBe(1);
    expect(rounds).toBeGreaterThanOrEqual(3);
  });

  it('runs the guard in CI against that reference, checked out on the same machine', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain("require('./tools/ci/tracer-budget.json').reference.commit");
    expect(ci).toContain('git worktree add --detach /tmp/tracer-ref "$ref"');
    expect(ci).toContain('npx tsx tools/ci/tracer-budget.ts --reference /tmp/tracer-ref');
  });
});
