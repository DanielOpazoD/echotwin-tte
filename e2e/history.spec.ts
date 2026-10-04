import { expect, test } from '@playwright/test';
import { waitForFrames, type EchoWindow } from './helpers';
import type { FrameAcquisition } from '../src/simulator/core/protocol';

test('frozen image and measurements keep their acquisition when pending controls change', async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem('echotwin.prefs.v1', JSON.stringify({ tutorialDone: true })),
  );
  await page.goto('/');
  await waitForFrames(page);
  await page.getByRole('button', { name: 'A4C', exact: true }).click();
  await page.waitForFunction(
    () =>
      (window as unknown as EchoWindow).__echotwin.useSimStore.getState()['presetAnim'] === null,
  );
  await page.getByRole('button', { name: 'Color', exact: true }).click();
  await page.evaluate(() => {
    const s = (window as unknown as EchoWindow).__echotwin.useSimStore.getState();
    (s['setColor'] as (v: unknown) => void)({
      gainDb: 15,
      boxRMinCm: 1,
      boxRMaxCm: 18,
      boxThetaMinRad: -0.6,
      boxThetaMaxRad: 0.6,
    });
  });
  const read = () =>
    page.evaluate(() => {
      const h = (window as unknown as EchoWindow).__echotwin.useHudStore.getState().hud;
      const canvas = document.querySelector<HTMLCanvasElement>(
        'canvas[aria-label="Imagen ecográfica simulada"]',
      )!;
      const d = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      let hash = 2166136261,
        colored = 0;
      for (let i = 0; i < d.length; i++) hash = Math.imul(hash ^ d[i]!, 16777619) >>> 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] !== d[i + 1]) colored++;
      return {
        hash,
        colored,
        frozen: h?.['frozen'],
        frameId: h?.['frameId'],
        timeS: h?.['timeS'],
        acquisition: h?.['acquisition'] as FrameAcquisition | undefined,
      };
    });
  await expect.poll(async () => (await read()).colored, { timeout: 20000 }).toBeGreaterThan(20);
  await page.keyboard.press('Space');
  await expect.poll(async () => (await read()).frozen).toBe(true);
  const before = await read();
  expect(before.colored).toBeGreaterThan(20);
  await page.evaluate(() => {
    const s = (window as unknown as EchoWindow).__echotwin.useSimStore.getState();
    (s['setColor'] as (v: unknown) => void)({ scaleMps: 0.2, showVariance: false });
    (s['setProbe'] as (v: unknown) => void)({ u: 4, v: 2 });
    (s['setPatient'] as (v: unknown) => void)({ position: 'supine' });
  });
  await expect(page.getByText(/Imagen congelada: los ajustes/)).toBeVisible();
  await expect(page.getByText(/Sonda de la adquisición congelada/)).toBeVisible();
  await expect.poll(async () => (await read()).hash).toBe(before.hash);
  const after = await read();
  expect(after.acquisition).toEqual(before.acquisition);
  expect(after.frameId).toBe(before.frameId);
  await page.getByRole('tab', { name: 'Medir' }).click();
  await page.getByRole('button', { name: 'Caliper', exact: true }).click();
  const canvas = page.locator('canvas.overlay');
  const box = (await canvas.boundingBox())!;
  await canvas.click({ position: { x: box.width * 0.5, y: box.height * 0.35 } });
  await canvas.click({ position: { x: box.width * 0.5, y: box.height * 0.42 } });
  const measurement = await page.evaluate(() => {
    const s = (window as unknown as EchoWindow).__echotwin.useSimStore.getState();
    return (
      s['measurements'] as { acquisition?: FrameAcquisition; frameId: number; timeS: number }[]
    ).at(-1);
  });
  expect(measurement?.acquisition).toEqual(before.acquisition);
  expect(measurement?.frameId).toBe(before.frameId);
  expect(measurement?.timeS).toBe(before.timeS);
});
