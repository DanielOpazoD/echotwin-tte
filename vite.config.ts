/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

/**
 * Test tiers (2026-09-14): the suite doubled since the 60 s timeout note below — tests that drive
 * SimulatorCore through several beats or render frames take 5–400 s each, and on a loaded machine
 * they flake on time alone (VALIDATION.md). `VITEST_TIER` selects: unset/`fast` = everything except
 * the files below (`npm test`, ~1 min); `slow` = only these files (`npm run test:slow`); `all` = the
 * whole suite (`npm run test:all`, used by `npm run check` and CI). Files are listed instead of a
 * rename because the docs and the fidelity method reference them by name.
 */
const SLOW_TEST_FILES = [
  // drive SimulatorCore through frames/beats
  'src/simulator/core/respiration.test.ts',
  'src/simulator/core/atrialFibrillation.test.ts',
  'src/simulator/core/gpuPath.test.ts',
  'src/simulator/core/measurementSupport.test.ts',
  'src/simulator/core/mmodeStrip.test.ts',
  'src/simulator/core/persistence.test.ts',
  'src/simulator/core/simulatorCore.test.ts',
  'src/simulator/doppler/color/colorDoppler.test.ts',
  'src/simulator/doppler/doppler.test.ts',
  'src/simulator/doppler/pulmonaryVein.test.ts',
  // render planes or Monte-Carlo the model
  'src/simulator/anatomy/aorticValve.test.ts',
  'src/simulator/anatomy/chestWall.test.ts',
  'src/simulator/anatomy/heartModel.test.ts',
  'src/simulator/anatomy/proportions.test.ts',
  'src/simulator/anatomy/valveAnatomy.test.ts',
  'src/simulator/renderer/acoustic/imageFormation.test.ts',
  'src/simulator/renderer/atlas/atlas.test.ts',
  'src/simulator/renderer/clinicalImage.test.ts',
  'src/simulator/renderer/procedural/boneShadow.test.ts',
  'src/simulator/renderer/procedural/elevationSpeckle.test.ts',
  'src/simulator/view-recognition/viewQuality.test.ts',
  'src/simulator/windows/viewContent.test.ts',
  'src/tests/goldens.test.ts',
];
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
