/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

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
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['e2e/**', 'node_modules/**'],
    // Many unit tests render frames or step the simulator core; on a shared CI runner some took over the 5 s default
    // (the LVOT auto-trace failed CI at 2c6cc27 in 5.9 s). A minute keeps them from failing on time alone while a hang
    // still fails; the heaviest tests declare longer limits of their own (external audit F11, decision 88).
    testTimeout: 60_000,
    coverage: { provider: 'v8', reporter: ['text', 'html'], include: ['src/**'] },
  },
});
