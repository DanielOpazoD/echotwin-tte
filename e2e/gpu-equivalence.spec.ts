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
  await page.addInitScript(() =>
    localStorage.setItem('echotwin.prefs.v1', JSON.stringify({ tutorialDone: true })),
  );
  await page.goto('/');
  await page.waitForFunction(() =>
    Boolean(
      (window as unknown as { __echotwin?: { compareBackends?: unknown } }).__echotwin
        ?.compareBackends,
    ),
  );
});

const MATRIX: [string, string[], number[], ('low' | 'medium' | 'high')?, number?][] = [
  ['normal-excellent-window', ['plax', 'a4c', 'psax-av'], [0, 0.35]],
  ['aortic-stenosis-severe', ['plax', 'a4c', 'psax-av'], [0, 0.35]],
  // septal flattening (D-shape) and tamponade collapse/swing exercise the newest GLSL paths; the dilated pulmonary
  // trunk widens from the root radius above the sinuses (decision 109), which no other case draws
  ['pulmonary-hypertension-rv', ['psax-pm', 'a4c', 'psax-av'], [0.35]],
  ['pericardial-effusion-tamponade', ['plax', 'a4c'], [0.5]],
  ['hocm-sam', ['plax'], [0.35]],
  // subcostal window: liver dome, diaphragm, venae cavae and the clipped atria in GLSL
  ['normal-excellent-window', ['subcostal-4c', 'subcostal-ivc'], [0]],
  // high tier: slice-thickness averaging (three elevation samples) on both backends
  ['normal-excellent-window', ['plax', 'a4c'], [0.35], 'high'],
  // the probe on a rib (1.4 cm off the apical preset): bone attenuation integrated over distance on both backends (decision 89)
  ['normal-excellent-window', ['a4c'], [0.1], 'medium', 1.4],
];
for (const [caseId, views, phases, tier, offsetV] of MATRIX) {
  for (const viewId of views) {
    for (const phase of phases) {
      test(`${caseId} ${viewId} @${phase}${tier ? ` (${tier})` : ''}${offsetV ? ` probe v${offsetV > 0 ? '+' : ''}${offsetV}` : ''}: GPU frame matches the CPU reference`, async ({
        page,
      }) => {
        const r = (await page.evaluate(
          ([v, p, c, t, o]) =>
            (
              window as unknown as {
                __echotwin: {
                  compareBackends: (
                    v: string,
                    p: number,
                    c: string,
                    t?: string,
                    o?: number,
                  ) => Comparison;
                };
              }
            ).__echotwin.compareBackends(
              v as string,
              p as number,
              c as string,
              t as string | undefined,
              o as number,
            ),
          [viewId, phase, caseId, tier ?? 'medium', offsetV ?? 0] as const,
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

/**
 * GPU image chain (decision 54): a four-frame chain formed on the GPU, GPU, CPU and GPU against the CPU console on
 * every frame (persistence within the GPU and across both switches), and the present pass (scan conversion +
 * colour overlay) against the CPU scan conversion and colour overlay of the same display.
 */
interface ChainComparison {
  error?: string;
  lines: number;
  framePaths: string[];
  displayMeanAbsDiff: number[];
  displayMaxDiff: number[];
  displayFracOver1: number[];
  idsAgreement: number;
  transMaxRelErr: number;
  presentMaxDiff: number;
  presentFracOver1: number;
  presentColorPixels: number;
  presentColourFlips: number;
}
const CHAIN: [string, string, number, 'medium' | 'high', Record<string, unknown>][] = [
  ['normal-excellent-window', 'plax', 0.35, 'medium', {}],
  [
    'normal-excellent-window',
    'a4c',
    0,
    'high',
    {
      grayMap: 'high-contrast',
      edgeEnhance: 0.6,
      persistence: 0.6,
      gainDb: 6,
      tgcDb: [0, 2, 4, 6, 6, 4, 2, 0],
      dynamicRangeDb: 45,
    },
  ],
  [
    'aortic-stenosis-severe',
    'psax-av',
    0.2,
    'medium',
    { grayMap: 'linear', edgeEnhance: 0, persistence: 0, gainDb: -8, depthCm: 20 },
  ],
];
for (const [caseId, viewId, phase, tier, overrides] of CHAIN) {
  test(`${caseId} ${viewId} @${phase} (${tier}): GPU console and present pass match the CPU image chain`, async ({
    page,
  }) => {
    const r = (await page.evaluate(
      ([v, p, c, t, o]) =>
        (
          window as unknown as {
            __echotwin: {
              compareImageChain: (
                v: string,
                p: number,
                c: string,
                t: string,
                o: unknown,
              ) => ChainComparison;
            };
          }
        ).__echotwin.compareImageChain(v as string, p as number, c as string, t as string, o),
      [viewId, phase, caseId, tier, overrides] as const,
    )) as ChainComparison;
    expect(r.error, 'WebGL2 must be available in the test browser').toBeUndefined();
    expect(r.lines).toBeGreaterThan(60);
    expect(r.framePaths).toEqual(['gpu', 'gpu', 'cpu', 'gpu']);
    for (let f = 0; f < r.framePaths.length; f++) {
      const label = `frame ${f} (${r.framePaths[f]})`;
      expect(r.displayMeanAbsDiff[f], `${label} mean grey difference`).toBeLessThan(0.05);
      expect(r.displayMaxDiff[f], `${label} largest grey difference`).toBeLessThanOrEqual(2);
      expect(
        r.displayFracOver1[f],
        `${label} samples differing by more than one grey level`,
      ).toBeLessThan(0.001);
    }
    expect(r.idsAgreement).toBe(1);
    expect(r.transMaxRelErr).toBeLessThan(0.02);
    expect(r.presentMaxDiff, 'largest RGB difference of the present pass').toBeLessThanOrEqual(2);
    expect(r.presentFracOver1, 'sector pixels differing by more than one level').toBe(0);
    expect(r.presentColourFlips, 'pixels coloured on one side only').toBe(0);
    expect(r.presentColorPixels).toBeGreaterThan(1000);
  });
}
