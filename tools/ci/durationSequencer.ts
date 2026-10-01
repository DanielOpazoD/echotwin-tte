import { BaseSequencer, type TestSpecification } from 'vitest/node';
import { relative } from 'node:path';
import durations from './test-durations.json';

/**
 * Shards the suite by how long its files take (decision 239). Vitest splits the files into equal counts in the order of a
 * hash of their paths: in CI the four shards took 3.0, 10.9, 12.6 and 1.5 minutes, two of them holding the three slowest
 * files each while the other two held mostly fast ones. Here every shard computes the same greedy assignment — longest
 * file first, onto the shard with least time so far — from the durations CI measured (`test-durations.json`); a file not
 * listed yet counts as a typical file of its tier.
 */
const DURATION_S: Readonly<Record<string, number>> = durations;
const NEW_SLOW_S = 60;
const NEW_FAST_S = 1;

export class DurationSequencer extends BaseSequencer {
  override shard(files: TestSpecification[]): Promise<TestSpecification[]> {
    const { index, count } = this.ctx.config.shard!;
    const root = this.ctx.config.root;
    const weighed = files
      .map((spec) => {
        const path = relative(root, spec.moduleId).split('\\').join('/');
        const known = DURATION_S[path];
        const s = known ?? (spec.project.name === 'slow' ? NEW_SLOW_S : NEW_FAST_S);
        return { spec, path, s };
      })
      .sort((a, b) => b.s - a.s || (a.path < b.path ? -1 : 1));
    const load = new Array<number>(count).fill(0);
    const mine: TestSpecification[] = [];
    for (const f of weighed) {
      let k = 0;
      for (let j = 1; j < count; j++) if (load[j]! < load[k]!) k = j;
      load[k]! += f.s;
      if (k === index - 1) mine.push(f.spec);
    }
    return Promise.resolve(mine);
  }
}
