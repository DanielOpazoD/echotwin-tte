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

const MATRIX: [string, string[], number[]][] = [
  ['normal-excellent-window', ['plax', 'a4c', 'psax-av'], [0, 0.35]],
  ['aortic-stenosis-severe', ['plax', 'a4c', 'psax-av'], [0, 0.35]],
  // septal flattening (D-shape) and tamponade collapse/swing exercise the newest GLSL paths
  ['pulmonary-hypertension-rv', ['psax-pm', 'a4c'], [0.35]],
  ['pericardial-effusion-tamponade', ['plax', 'a4c'], [0.5]],
  ['hocm-sam', ['plax'], [0.35]],
];
for (const [caseId, views, phases] of MATRIX) {
  for (const viewId of views) {
    for (const phase of phases) {
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
