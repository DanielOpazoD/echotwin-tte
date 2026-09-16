import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A test that steps SimulatorCore, renders frames or Monte-Carlos the model belongs to the slow tier
 * (`// @tier slow` on its first line, read by vite.config.ts). A file that imports one of the heavy modules
 * must say which tier it belongs to — `slow`, or `fast` when it deliberately stays light (fake timers, a
 * single low-tier frame) — so a new heavy test cannot slip into `npm test` by omission.
 */
const HEAVY_IMPORTS = [
  '@/simulator/core/simulatorCore',
  './simulatorCore',
  '@/simulator/renderer/procedural/sliceRenderer',
  './sliceRenderer',
  '@/simulator/renderer/clinicalImage',
  '@/simulator/anatomy/measureModel',
  '@/simulator/anatomy/caseModels',
  './caseModels',
];

function testFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.test\.tsx?$/.test(name)) out.push(p);
    }
  };
  walk(join(process.cwd(), 'src'));
  return out;
}

describe('test tiers', () => {
  // this file names the heavy modules and the marker in its own source: it is not a subject
  const files = testFiles().filter((p) => !p.endsWith('testTiers.test.ts'));
  it('finds the suite', () => {
    expect(files.length).toBeGreaterThan(40);
  });

  it('every test that imports a heavy module declares its tier on the first line', () => {
    const undeclared: string[] = [];
    for (const p of files) {
      const src = readFileSync(p, 'utf8');
      const heavy = HEAVY_IMPORTS.some((h) => src.includes(`'${h}'`));
      if (heavy && !/^\/\/ @tier (slow|fast)\n/.test(src))
        undeclared.push(p.slice(process.cwd().length + 1));
    }
    expect(
      undeclared,
      'add `// @tier slow` (or `// @tier fast` on purpose) as the first line',
    ).toEqual([]);
  });

  it('the marker, when present, is on the first line with a known tier', () => {
    const wrong: string[] = [];
    for (const p of files) {
      const src = readFileSync(p, 'utf8');
      const anywhere = src.includes('@tier ');
      if (anywhere && !/^\/\/ @tier (slow|fast)\n/.test(src)) wrong.push(p);
    }
    expect(wrong).toEqual([]);
  });
});
