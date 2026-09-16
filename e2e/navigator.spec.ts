import { expect, test } from '@playwright/test';
import { waitForFrames, type EchoWindow } from './helpers';

/**
 * The navigator is split in two (decision 137): the torso with the probe above and the heart cut face-on
 * below, on one canvas. The captions name both, the layer toggle removes the second view, and the cut
 * view's labels come from the navigator model's landmarks.
 */
test('the navigator shows the torso above and the cut face below, and the second view can be switched off', async ({
  page,
}) => {
  await page.goto('/');
  await waitForFrames(page, 3);
  await expect(page.locator('.torso-caption.top')).toHaveText('Sonda y tórax');
  await expect(page.locator('.torso-caption.bottom')).toContainText('Corte ecográfico');
  await expect(page.locator('.torso-wrap.split')).toHaveCount(1);
  await page.evaluate(() => {
    const w = window as unknown as EchoWindow;
    (w.__echotwin.useSimStore.getState()['setUi'] as (u: unknown) => void)({ navSplit: false });
  });
  await expect(page.locator('.torso-caption.bottom')).toHaveCount(0);
  await expect(page.locator('.torso-wrap.split')).toHaveCount(0);
  // the preference survives a reload
  await page.reload();
  await waitForFrames(page, 2);
  await expect(page.locator('.torso-wrap.split')).toHaveCount(0);
});
