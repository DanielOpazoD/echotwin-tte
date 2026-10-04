import { expect, test } from '@playwright/test';
import { waitForFrames, type EchoWindow } from './helpers';

test.use({ hasTouch: true });

test('390 px keeps the image usable, exposes both panels and preserves physical calipers on resize', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem('echotwin.prefs.v1', JSON.stringify({ tutorialDone: true }));
    const w = window as unknown as { meshBuilds: number };
    w.meshBuilds = 0;
    window.Worker = class extends Worker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        if (String(url).includes('heartMesh.worker')) w.meshBuilds++;
      }
    };
  });
  await page.goto('/');
  await waitForFrames(page);
  const overlay = page.getByLabel('Superposiciones y herramientas de medición');
  const bounds = (await overlay.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.width).toBeGreaterThan(350);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: 'Navegación', exact: true }).click();
  const probe = () =>
    page.evaluate(
      () => (window as unknown as EchoWindow).__echotwin.useSimStore.getState()['probe'],
    );
  const before = await probe();
  const meshBuilds = () =>
    page.evaluate(() => (window as unknown as { meshBuilds: number }).meshBuilds);
  const buildsBeforeFreeze = await meshBuilds();
  expect(buildsBeforeFreeze).toBe(1);
  await page.getByRole('button', { name: 'Mirar perpendicular al plano ecográfico' }).click();
  await page.getByRole('button', { name: 'Restablecer vista global del tórax' }).click();
  expect(await probe()).toEqual(before);
  const torso = page.locator('.torso-3d canvas');
  await expect(torso).toBeVisible();
  await page.getByLabel('Acción al arrastrar en el navegador').selectOption('camera');
  await torso.scrollIntoViewIfNeeded();
  const tb = (await torso.boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const touch = { x: tb.x + tb.width * 0.5, y: tb.y + tb.height * 0.6 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch] });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ ...touch, x: touch.x + 50 }],
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
  expect(await probe()).toEqual(before);
  await page.getByRole('button', { name: 'Consola', exact: true }).click();
  await page.getByRole('button', { name: 'Congelar', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'Cine', exact: true })).toBeVisible();
  await page.waitForFunction(
    () =>
      (window as unknown as EchoWindow).__echotwin.useHudStore.getState().hud?.['frozen'] === true,
  );
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  expect(await meshBuilds()).toBe(buildsBeforeFreeze);
  await page.getByRole('tab', { name: 'Medir' }).click();
  await page.getByRole('button', { name: 'Caliper', exact: true }).click();
  const box = (await overlay.boundingBox())!;
  await overlay.click({ position: { x: box.width * 0.5, y: box.height * 0.4 } });
  await overlay.click({ position: { x: box.width * 0.5, y: box.height * 0.6 } });
  const measurements = () =>
    page.evaluate(
      () =>
        (window as unknown as EchoWindow).__echotwin.useSimStore.getState()['measurements'] as {
          value: number;
          units: string;
        }[],
    );
  const recorded = await measurements();
  expect(recorded).toHaveLength(1);
  expect(recorded[0]!.value).toBeGreaterThan(0.5);
  expect(recorded[0]!.units).toBe('cm');
  await page.getByRole('button', { name: 'Consola', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Medir' })).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.getByRole('tab', { name: 'Medir' })).toBeVisible();
  expect(await measurements()).toEqual(recorded);
  expect(await probe()).toEqual(before);
});
