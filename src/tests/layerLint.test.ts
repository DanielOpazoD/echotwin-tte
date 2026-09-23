import { describe, expect, it } from 'vitest';
import { ESLint, Linter } from 'eslint';

/**
 * The layer fences of eslint.config.js as ESLint resolves them for a real file of each layer (decision 154). In a flat
 * config the last block that matches a file replaces the options of `no-restricted-imports`; for a day the finer
 * blocks erased the engine fence and React, zustand or the store could be imported into the engine with no error.
 * This test asks ESLint for the rule it would apply and lints forbidden imports with it.
 */
const FORBIDDEN: [file: string, imports: string[]][] = [
  [
    'src/simulator/core/protocol.ts',
    [
      'zustand',
      'react',
      '@/app/frameBus',
      '@/ui/cutMap',
      '@/workers/sim.worker',
      '@/education/report',
    ],
  ],
  [
    'src/simulator/renderer/scanConvert.ts',
    ['react', '@/app/store', '@/education/report', '@/simulator/doppler/flowField'],
  ],
  [
    'src/clinical/segmentation/catalog.ts',
    ['zustand', '@/app/store', '@/simulator/anatomy/lvSegments', '@/cases', '@/education/report'],
  ],
  ['src/cases/index.ts', ['react', '@/app/frameBus', '@/education/report']],
  ['src/education/report.ts', ['react', '@/ui/cutMap', '@/workers/sim.worker']],
  ['src/core/vec3.ts', ['react', '@/simulator/anatomy/tissue', '../clinical/nifti']],
];
/** Imports each layer may make: the fence must not turn into a blanket ban. */
const ALLOWED: [file: string, imports: string[]][] = [
  [
    'src/simulator/core/protocol.ts',
    ['@/simulator/renderer/types', '@/clinical/segmentation/catalog'],
  ],
  ['src/simulator/renderer/scanConvert.ts', ['./types', '@/core/vec3']],
  ['src/clinical/segmentation/catalog.ts', ['./wallMotion']],
  ['src/education/report.ts', ['@/simulator/hemodynamics/groundTruth']],
];

describe('layer fences as ESLint resolves them', () => {
  const eslint = new ESLint({ cwd: process.cwd() });
  const lintImports = async (file: string, imports: string[]) => {
    const cfg = (await eslint.calculateConfigForFile(file)) as {
      rules: Record<string, Linter.RuleEntry>;
    };
    const rule = cfg.rules['no-restricted-imports'];
    expect(rule, `${file}: no-restricted-imports is configured`).toBeDefined();
    const code = imports.map((m, i) => `import * as m${i} from '${m}';\nvoid m${i};`).join('\n');
    const linter = new Linter({ configType: 'flat' });
    const messages = linter.verify(
      code,
      [
        {
          files: ['**/*.ts'],
          languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
          rules: { 'no-restricted-imports': rule! },
        },
      ],
      { filename: file },
    );
    // the line of each import that the rule flags
    return new Set(messages.map((m) => imports[(m.line - 1) / 2]));
  };

  it('forbids in every layer what its fences forbid, the engine fence included', async () => {
    for (const [file, imports] of FORBIDDEN) {
      const flagged = await lintImports(file, imports);
      for (const m of imports) expect(flagged.has(m), `${file} must not import ${m}`).toBe(true);
    }
  }, 60_000);

  it('still allows the imports each layer is meant to make', async () => {
    for (const [file, imports] of ALLOWED) {
      const flagged = await lintImports(file, imports);
      for (const m of imports) expect(flagged.has(m), `${file} may import ${m}`).toBe(false);
    }
  }, 60_000);
});
