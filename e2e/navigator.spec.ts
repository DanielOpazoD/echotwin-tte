import { expect, test } from '@playwright/test';
import { waitForFrames, type EchoWindow } from './helpers';

/**
 * The navigator is split in two (decisions 137 and 141): the WebGL torso with the probe above and, below it,
 * the cut map — the structures of the imaging plane drawn in colour from the frame's own structure map, on a
 * 2D canvas of its own. The captions name both and the layer toggle removes the second view.
 */
test('the navigator shows the torso above and the cut map below, and the second view can be switched off', async ({
  page,
}) => {
  await page.goto('/');
  await waitForFrames(page, 3);
  await expect(page.locator('.torso-caption.top')).toHaveText('Sonda y tórax');
  await expect(page.locator('.torso-caption.bottom')).toContainText('Corte ecográfico');
  await expect(page.locator('.torso-wrap.split')).toHaveCount(1);
  await expect(page.locator('.torso-3d canvas')).toHaveCount(1);
  await expect(page.locator('.cut-map canvas')).toHaveCount(1);
  // the map is painted from the frame: the sector holds the model's colours, not the empty canvas
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const c = document.querySelector<HTMLCanvasElement>('.cut-map canvas');
          const ctx = c?.getContext('2d');
          if (!c || !ctx) return 0;
          const d = ctx.getImageData(0, 0, c.width, c.height).data;
          let painted = 0;
          for (let i = 3; i < d.length; i += 4) if (d[i]! > 0) painted++;
          return painted / (c.width * c.height);
        }),
      { timeout: 20_000 },
    )
    .toBeGreaterThan(0.2);
  await page.evaluate(() => {
    const w = window as unknown as EchoWindow;
    (w.__echotwin.useSimStore.getState()['setUi'] as (u: unknown) => void)({ navSplit: false });
  });
  await expect(page.locator('.torso-caption.bottom')).toHaveCount(0);
  await expect(page.locator('.cut-map')).toHaveCount(0);
  await expect(page.locator('.torso-wrap.split')).toHaveCount(0);
  // the preference survives a reload
  await page.reload();
  await waitForFrames(page, 2);
  await expect(page.locator('.torso-wrap.split')).toHaveCount(0);
});
