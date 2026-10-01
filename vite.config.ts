/// <reference types="vitest/config" />
import { DurationSequencer } from './tools/ci/durationSequencer';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { stripGlslTemplateComments } from './src/simulator/renderer/gpu/glslStrip';

/**
 * The shaders' comments stay in the source, next to the lines they explain, and leave the bundle (decision 228): the
 * build strips them, with the indentation, from the template literals of the GLSL modules. Tests and the dev server read
 * the sources as written.
 */
function glslStrip(): Plugin {
  return {
    name: 'echotwin-glsl-strip',
    apply: 'build',
    enforce: 'pre',
    transform(code, id) {
      if (
        !/[\\/]src[\\/]simulator[\\/]renderer[\\/]gpu[\\/]glsl(Common|Heart|Thorax|Passes|Image|Generated)\.ts$/.test(
          id,
        )
      )
        return null;
      return { code: stripGlslTemplateComments(code), map: null };
    },
  };
}

/**
 * Test tiers. Tests that drive SimulatorCore through several beats or render frames take seconds to minutes
 * each and, on a loaded machine, flake on time alone (VALIDATION.md). A test file opts into the slow tier with
 * a `// @tier slow` marker on its first line; `VITEST_TIER` selects: unset/`fast` = everything else
 * (`npm test`, ~1 min); `slow` = only the marked files (`npm run test:slow`); `all` = the whole suite
 * (`npm run test:all`, used by `npm run check` and CI). The marker lives in the file, not in a list here, so a
 * new heavy test cannot land in the fast tier by omission; `src/tests/testTiers.test.ts` makes files that
 * import the heavy modules declare a tier explicitly.
 */
const ROOT = fileURLToPath(new URL('.', import.meta.url));
function testFilesWithMarker(marker: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.test\.tsx?$/.test(name) && readFileSync(p, 'utf8').startsWith(marker))
        out.push(relative(ROOT, p));
    }
  };
  // the config's own directory, not the working directory: a dev server launched from elsewhere found no `src`
  walk(join(ROOT, 'src'));
  return out;
}
const SLOW_TEST_FILES = testFilesWithMarker('// @tier slow');
const testTier = process.env['VITEST_TIER'] ?? 'fast';
/**
 * One time limit per tier, the same here and in CI (decision 239): a limit is there to fail a hang, not to measure speed
 * (the tracer's cost has a guard of its own). Tests used to declare 70 limits of their own, from 30 s to 900 s, and the
 * local scripts raised the default to 180 s while CI kept 60 s, so a test could pass here and time out there. A fast test
 * takes at most ~10 s in CI; the slowest slow test, ~5 min under coverage. Hooks (`beforeAll`) share the limit of their tier.
 */
const FAST_LIMIT_MS = 60_000;
const SLOW_LIMIT_MS = 900_000;
const TEST_FILES = ['src/**/*.test.ts', 'src/**/*.test.tsx'];
// CI runs the suite in shards that emit blob reports; a merge job applies the thresholds once.
// A shard's coverage map is partial and would always fail the per-area floors, so collection-only
// runs skip them (see .github/workflows/ci.yml).
const coverageShard = process.env['VITEST_COVERAGE_SHARD'] === '1';

export default defineConfig({
  plugins: [react(), glslStrip()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: { three: ['three'], react: ['react', 'react-dom'] },
        // the chunk that carries the WebGL2 port keeps its name, whatever module Rollup would name it after: it is shared by
        // the lazy core and the backend comparison, and when the scene physics joined it (decision 238) it came out as
        // `scenePhysics-*.js` and fell under the budget of an ordinary chunk
        chunkFileNames: (chunk) =>
          chunk.moduleIds.some((id) => id.includes('/renderer/gpu/webgl2Renderer'))
            ? 'assets/webgl2Renderer-[hash].js'
            : 'assets/[name]-[hash].js',
      },
    },
  },
  worker: { format: 'es', plugins: () => [glslStrip()] },
  test: {
    environment: 'node',
    // shards balanced by the time their files take, not by their count (decision 239)
    sequence: { sequencer: DurationSequencer },
    // each tier is a project with its own limit; VITEST_TIER picks which run
    projects: [
      ...(testTier === 'slow'
        ? []
        : [
            {
              extends: true as const,
              test: {
                name: 'fast',
                include: TEST_FILES,
                exclude: ['e2e/**', 'node_modules/**', ...SLOW_TEST_FILES],
                testTimeout: FAST_LIMIT_MS,
                hookTimeout: FAST_LIMIT_MS,
              },
            },
          ]),
      ...(testTier === 'fast'
        ? []
        : [
            {
              extends: true as const,
              test: {
                name: 'slow',
                include: SLOW_TEST_FILES,
                testTimeout: SLOW_LIMIT_MS,
                // a beforeAll that steps the core for the file's tests takes as long as a test (the M-mode strip's does)
                hookTimeout: SLOW_LIMIT_MS,
              },
            },
          ]),
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: ['src/**'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
        'src/**/*.testkit.ts',
        'src/tests/goldens/**',
      ],
      // keep the report when a test fails so a red run still shows what it covered
      reportOnFailure: true,
      // Floors measured on the full suite (2026-09-14): global 67 % lines / 60 % branches.
      // The per-area floors sit ~5 points below their measured values; the gpu/, ui/, workers/
      // and app/ directories stay under the global floor only — WebGL and DOM paths are exercised
      // by the E2E suite, not by unit tests.
      thresholds: coverageShard
        ? undefined
        : {
            lines: 60,
            statements: 60,
            branches: 55,
            functions: 50,
            'src/cases/**': { lines: 85 },
            'src/clinical/**': { lines: 70 },
            'src/core/**': { lines: 75 },
            'src/education/**': { lines: 80 },
            'src/simulator/anatomy/**': { lines: 90 },
            'src/simulator/cardiac-cycle/**': { lines: 90 },
            'src/simulator/core/**': { lines: 80 },
            'src/simulator/doppler/**': { lines: 85 },
            'src/simulator/hemodynamics/**': { lines: 95 },
            'src/simulator/probe/**': { lines: 90 },
            'src/simulator/renderer/**': { lines: 45 },
            'src/simulator/view-recognition/**': { lines: 90 },
            'src/simulator/windows/**': { lines: 90 },
          },
    },
  },
});
