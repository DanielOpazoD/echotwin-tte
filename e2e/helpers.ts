import type { Page } from '@playwright/test';

export interface EchoWindow {
  __echotwin: {
    useSimStore: { getState: () => Record<string, unknown> & { [k: string]: unknown } };
    useHudStore: { getState: () => { hud: Record<string, unknown> | null } };
  };
}

export async function waitForFrames(page: Page, minFrames = 3, timeoutMs = 30_000): Promise<void> {
  await page.waitForFunction(
    (min) => {
      const w = window as unknown as EchoWindow;
      const hud = w.__echotwin?.useHudStore.getState().hud;
      return !!hud && (hud['frameId'] as number) >= min;
    },
    minFrames,
    { timeout: timeoutMs },
  );
}

/** Light, serialisable view of the HUD (the frame buffer is transferred/detached and cannot be cloned). */
export async function getHud(page: Page): Promise<Record<string, unknown> | null> {
  return page.evaluate(() => {
    const hud = (window as unknown as EchoWindow).__echotwin.useHudStore.getState().hud;
    if (!hud) return null;
    const h = hud as Record<string, unknown>;
    return {
      frameId: h['frameId'],
      timeS: h['timeS'],
      view: h['view'],
      strip: h['strip'],
      colorFps: h['colorFps'],
      simulatedFps: h['simulatedFps'],
      spectrumColumn: h['spectrumColumn'] ? Array.from(h['spectrumColumn'] as Float32Array) : null,
      cineLength: h['cineLength'],
      frozen: h['frozen'],
      stats: h['stats'],
    };
  });
}

export async function getStore(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const s = (window as unknown as EchoWindow).__echotwin.useSimStore.getState();
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(s)) if (typeof v !== 'function') out[k] = v;
    return out;
  });
}

/** Mean intensity of the ultrasound image canvas (0..255). */
export async function imageMean(page: Page): Promise<number> {
  return page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>(
      'canvas[aria-label="Imagen ecográfica simulada"]',
    );
    if (!c) return -1;
    const ctx = c.getContext('2d')!;
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 16) s += d[i]!;
    return s / (d.length / 16);
  });
}
