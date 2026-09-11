import { expect, test } from '@playwright/test';

/**
 * WebGL2 renderer equivalence (spec 0.7): the GPU port of the procedural renderer must reproduce the
 * CPU reference frame by frame. Runs on the main thread through window.__echotwin.compareBackends
 * (Chromium's SwiftShader provides WebGL2 when no GPU is present).
 */
interface Comparison {
  error?: string;
  structureAgreement: number;
  tissueAgreement: number;
  ampRelDiff: number;
  transDiff: number;
  cpuMs: number;
  gpuMs: number;
  lines: number;
  samples: number;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('echotwin.prefs.v1', JSON.stringify({ tutorialDone: true })));
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as unknown as { __echotwin?: { compareBackends?: unknown } }).__echotwin?.compareBackends));
});

for (const caseId of ['normal-excellent-window', 'aortic-stenosis-severe']) {
  for (const viewId of ['plax', 'a4c', 'psax-av']) {
    for (const phase of [0, 0.35]) {
      test(`${caseId} ${viewId} @${phase}: GPU frame matches the CPU reference`, async ({ page }) => {
        const r = (await page.evaluate(
          ([v, p, c]) => (window as unknown as { __echotwin: { compareBackends: (v: string, p: number, c: string) => Comparison } }).__echotwin.compareBackends(v as string, p as number, c as string),
          [viewId, phase, caseId] as const,
        )) as Comparison;
        expect(r.error, 'WebGL2 must be available in the test browser').toBeUndefined();
        expect(r.lines).toBeGreaterThan(60);
        expect(r.structureAgreement).toBeGreaterThan(0.995);
        expect(r.tissueAgreement).toBeGreaterThan(0.995);
        expect(r.ampRelDiff).toBeLessThan(0.01);
        expect(r.transDiff).toBeLessThan(0.001);
      });
    }
  }
}
