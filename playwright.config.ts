import { defineConfig, devices } from '@playwright/test';

// This machine runs the own GitLab runner (its E2E job serves its checkout on 4173) and keeps stale previews of
// old worktrees on other ports; a local run that reused whatever answered on its port tested another build and
// reported failures that had nothing to do with the working tree. The preview is therefore never reused, and
// the local port is an unusual one (E2E_PORT overrides it); CI keeps 4173.
const PORT = process.env['CI'] ? 4173 : Number(process.env['E2E_PORT'] ?? 4190);

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  fullyParallel: false,
  // one worker: the GPU-equivalence comparisons render on SwiftShader and starve parallel browsers
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: `npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
