import { expect, test, type Page } from '@playwright/test';
import { waitForFrames } from './helpers';

/**
 * The real GPU image chain (decisions 54 and 55): console and present passes, the ImageBitmap transferred from
 * the worker and the display's drawImage. It needs hardware WebGL2, which Playwright's full Chromium gets in
 * headless mode on a machine with a GPU (`channel: 'chromium'`). On a software rasteriser the simulator uses the
 * CPU tracer, so these tests are skipped there (CI without a GPU).
 */
test.use({ channel: 'chromium' });

interface FrameLike {
  bitmap?: unknown;
  frozen: boolean;
  phase: number;
  cineFramePhase: number;
  cineOffset: number;
  stats: Record<string, unknown>;
}
interface GpuWindow {
  __echotwin: {
    useSimStore: {
      getState: () => {
        frozen: boolean;
        setModality: (m: string) => void;
        toggleFreeze: () => void;
        setCineOffset: (o: number) => void;
        setArtifactLab: (
          v: { sideLobe: number; mirror: number; beamWidth: number; clutter: number } | null,
        ) => void;
        setUi: (u: { screen: string }) => void;
      };
    };
    frameBus: { subscribe: (fn: (o: FrameLike) => void) => () => void };
  };
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('echotwin.prefs.v1', JSON.stringify({ tutorialDone: true })),
  );
  await page.goto('/');
  const renderer = await page.evaluate(() => {
    const gl = new OffscreenCanvas(4, 4).getContext('webgl2');
    if (!gl) return '';
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    return String(
      dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    );
  });
  test.skip(
    !renderer || /swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer),
    `no hardware WebGL2 (${renderer || 'none'})`,
  );
  await waitForFrames(page, 5, 60_000);
});

interface LiveVsCine {
  live: number;
  liveOnGpu: number;
  matched: number;
  maxDiff: number;
  pixelsOver1: number;
  colourPixels: number;
}

/** Capture live frames (drawn from GPU bitmaps), freeze, and compare each with the cine frame of the same phase (CPU composite). */
async function liveVersusCine(page: Page, modality: '2d' | 'color'): Promise<LiveVsCine> {
  return page.evaluate(async (mod) => {
    const eb = (window as unknown as GpuWindow).__echotwin;
    const store = eb.useSimStore;
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const canvas = document.querySelector<HTMLCanvasElement>(
      'canvas[aria-label="Imagen ecográfica simulada"]',
    )!;
    const ctx = canvas.getContext('2d')!;
    if (store.getState().frozen) store.getState().toggleFreeze();
    store.getState().setModality(mod);
    await wait(1500);
    const live: { phase: number; gpu: boolean; px: Uint8ClampedArray }[] = [];
    await new Promise<void>((resolve) => {
      const un = eb.frameBus.subscribe((o) => {
        if (o.frozen) return;
        live.push({
          phase: o.phase,
          gpu: Boolean(o.bitmap) && o.stats['present'] === 'gpu',
          px: ctx.getImageData(0, 0, canvas.width, canvas.height).data,
        });
        if (live.length >= 8) {
          un();
          resolve();
        }
      });
    });
    store.getState().toggleFreeze();
    await wait(500);
    const cine: { phase: number; px: Uint8ClampedArray }[] = [];
    for (let k = 0; k >= -16; k--) {
      store.getState().setCineOffset(k);
      cine.push(
        await new Promise((resolve) => {
          const un = eb.frameBus.subscribe((o) => {
            if (!o.frozen || o.cineOffset !== k) return;
            un();
            resolve({
              phase: o.cineFramePhase,
              px: ctx.getImageData(0, 0, canvas.width, canvas.height).data,
            });
          });
        }),
      );
    }
    store.getState().toggleFreeze();
    let matched = 0,
      maxDiff = 0,
      pixelsOver1 = 0,
      colourPixels = 0;
    for (const l of live) {
      const c = cine.find((x) => x.phase === l.phase);
      if (!c || c.px.length !== l.px.length) continue;
      matched++;
      for (let i = 0; i < l.px.length; i += 4) {
        let d = 0;
        for (let ch = 0; ch < 3; ch++) d = Math.max(d, Math.abs(l.px[i + ch]! - c.px[i + ch]!));
        maxDiff = Math.max(maxDiff, d);
        if (d > 1) pixelsOver1++;
        if (l.px[i] !== l.px[i + 1] || l.px[i + 1] !== l.px[i + 2]) colourPixels++;
      }
    }
    return {
      live: live.length,
      liveOnGpu: live.filter((l) => l.gpu).length,
      matched,
      maxDiff,
      pixelsOver1,
      colourPixels,
    };
  }, modality);
}

for (const modality of ['2d', 'color'] as const) {
  test(`live ${modality} frames arrive as GPU bitmaps and equal the CPU composite of the same frame`, async ({
    page,
  }) => {
    const r = await liveVersusCine(page, modality);
    test.info().annotations.push({ type: 'comparison', description: JSON.stringify(r) });
    expect(r.liveOnGpu).toBe(r.live);
    expect(r.matched).toBeGreaterThanOrEqual(4);
    expect(r.maxDiff).toBeLessThanOrEqual(1);
    expect(r.pixelsOver1).toBe(0);
  });
}

test('strips, cine review and console artifacts use the CPU composite, and live frames return to the GPU', async ({
  page,
}) => {
  const r = await page.evaluate(async () => {
    const eb = (window as unknown as GpuWindow).__echotwin;
    const store = eb.useSimStore;
    const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));
    const sample = async () => {
      const frames: { bitmap: boolean; console: string; present: string }[] = [];
      const un = eb.frameBus.subscribe((o) =>
        frames.push({
          bitmap: Boolean(o.bitmap),
          console: String(o.stats['console']),
          present: String(o.stats['present']),
        }),
      );
      await wait(1200);
      un();
      return {
        n: frames.length,
        bitmaps: frames.filter((f) => f.bitmap).length,
        console: [...new Set(frames.map((f) => f.console))],
        present: [...new Set(frames.map((f) => f.present))],
      };
    };
    const s = store.getState();
    s.setModality('2d');
    await wait(700);
    const live = await sample();
    s.setModality('pw');
    await wait(900);
    const pw = await sample();
    s.setModality('2d');
    await wait(700);
    s.toggleFreeze();
    await wait(500);
    const frozen = await sample();
    s.toggleFreeze();
    await wait(500);
    s.setArtifactLab({ sideLobe: 0, mirror: 0.6, beamWidth: 0, clutter: 0 });
    await wait(700);
    const mirror = await sample();
    s.setArtifactLab(null);
    await wait(700);
    const back = await sample();
    return { live, pw, frozen, mirror, back };
  });
  test.info().annotations.push({ type: 'paths', description: JSON.stringify(r) });
  expect(r.live.n).toBeGreaterThan(5);
  expect(r.live.bitmaps).toBe(r.live.n);
  expect(r.pw.n).toBeGreaterThan(3);
  expect(r.pw.bitmaps).toBe(0);
  expect(r.pw.console).toEqual(['gpu']);
  expect(r.frozen.n).toBeGreaterThan(3);
  expect(r.frozen.bitmaps).toBe(0);
  expect(r.mirror.n).toBeGreaterThan(3);
  expect(r.mirror.bitmaps).toBe(0);
  expect(r.mirror.console).toEqual(['cpu']);
  expect(r.back.bitmaps).toBeGreaterThan(3);
});

// A frame goes through the CPU console only when the atlas serves it from its cache, which it does while the GPU is over
// the frame budget for several frames in a row, as on a loaded machine (decision 179): the frames it forms directly
// must all be GPU bitmaps. Asking for every frame to be a bitmap failed with the load of the CI runner.
test('GPU frames keep arriving after visiting another screen', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const eb = (window as unknown as GpuWindow).__echotwin;
    const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));
    eb.useSimStore.getState().setUi({ screen: 'references' });
    await wait(2000);
    eb.useSimStore.getState().setUi({ screen: 'simulator' });
    await wait(800);
    let n = 0,
      directOnCpu = 0;
    const un = eb.frameBus.subscribe((o) => {
      n++;
      if (!o.bitmap && o.stats['mode'] !== 'cache') directOnCpu++;
    });
    await wait(1500);
    un();
    return { n, directOnCpu };
  });
  expect(r.n).toBeGreaterThan(5);
  expect(r.directOnCpu).toBe(0);
});
