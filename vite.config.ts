/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Test tiers. Tests that drive SimulatorCore through several beats or render frames take seconds to minutes
 * each and, on a loaded machine, flake on time alone (VALIDATION.md). A test file opts into the slow tier with
 * a `// @tier slow` marker on its first line; `VITEST_TIER` selects: unset/`fast` = everything else
 * (`npm test`, ~1 min); `slow` = only the marked files (`npm run test:slow`); `all` = the whole suite
 * (`npm run test:all`, used by `npm run check` and CI). The marker lives in the file, not in a list here, so a
 * new heavy test cannot land in the fast tier by omission; `src/tests/testTiers.test.ts` makes files that
 * import the heavy modules declare a tier explicitly.
 */
function testFilesWithMarker(marker: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.test\.tsx?$/.test(name) && readFileSync(p, 'utf8').startsWith(marker))
        out.push(p.slice(process.cwd().length + 1));
    }
  };
  walk(join(process.cwd(), 'src'));
  return out;
}
const SLOW_TEST_FILES = testFilesWithMarker('// @tier slow');
const testTier = process.env['VITEST_TIER'] ?? 'fast';
// CI runs the suite in shards that emit blob reports; a merge job applies the thresholds once.
// A shard's coverage map is partial and would always fail the per-area floors, so collection-only
// runs skip them (see .github/workflows/ci.yml).
const coverageShard = process.env['VITEST_COVERAGE_SHARD'] === '1';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: { three: ['three'], react: ['react', 'react-dom'] },
      },
    },
  },
  worker: { format: 'es' },
  test: {
    environment: 'node',
    include: testTier === 'slow' ? SLOW_TEST_FILES : ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['e2e/**', 'node_modules/**', ...(testTier === 'fast' ? SLOW_TEST_FILES : [])],
    // Many unit tests render frames or step the simulator core; on a shared CI runner some took over the 5 s default
    // (the LVOT auto-trace failed CI at 2c6cc27 in 5.9 s). A minute keeps them from failing on time alone while a hang
    // still fails; the heaviest tests declare longer limits of their own (external audit F11, decision 88).
    testTimeout: 60_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: ['src/**'],
      exclude: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/tests/goldens/**'],
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
