import { expect, test } from '@playwright/test';
import { getStore, waitForFrames, type EchoWindow } from './helpers';

/**
 * Review mode (decision 134): a click on the image places a numbered marker that names the structure the
 * model holds there; the report copies as text with the exact state and loads back from that text.
 */
test('a marker names the structure under the click and the report round-trips through the panel', async ({
  page,
}) => {
  await page.goto('/');
  await waitForFrames(page, 3);
  await page.evaluate(() => {
    const w = window as unknown as EchoWindow;
    (w.__echotwin.useSimStore.getState()['setUi'] as (u: unknown) => void)({
      reviewMode: true,
      consoleTab: 'revisar',
    });
  });
  await expect(page.getByRole('tab', { name: 'Revisar' })).toBeVisible();
  const canvas = page.locator('canvas.overlay');
  const box = (await canvas.boundingBox())!;
  await canvas.click({ position: { x: box.width * 0.5, y: box.height * 0.4 } });
  // the worker's classification arrives asynchronously
  await page.waitForFunction(() => {
    const w = window as unknown as EchoWindow;
    const markers = w.__echotwin.useSimStore.getState()['reviewMarkers'] as { point: unknown }[];
    return markers.length === 1 && markers[0]!.point !== null;
  });
  const item = page.locator('.review-item');
  await expect(item).toHaveCount(1);
  const place = await item.locator('.review-place').textContent();
  expect(place).toMatch(/cm · -?\d+°/);
  expect(place).toContain('corazón (');
  await item.getByLabel('Nota del marcador 1').fill('aquí la pared se ve doble');

  await page.getByRole('button', { name: 'Copiar informe' }).click();
  const preview = page.getByLabel('Informe de revisión en texto');
  await expect(preview).toBeVisible();
  const text = await preview.inputValue();
  expect(text).toContain('## Informe de revisión EchoTwin');
  expect(text).toContain('Caso: normal-excellent-window');
  expect(text).toContain('1. [Anatomía / forma]');
  expect(text).toContain('«aquí la pared se ve doble»');
  expect(text).toContain('```json');

  // clearing and loading the same text restores the marker and its note
  await page.getByRole('button', { name: 'Borrar marcadores y nota' }).click();
  await expect(item).toHaveCount(0);
  await page.getByLabel('Texto del informe a cargar').fill(text);
  await page.getByRole('button', { name: 'Cargar informe' }).click();
  await expect(item).toHaveCount(1);
  await expect(item.getByLabel('Nota del marcador 1')).toHaveValue('aquí la pared se ve doble');
  const store = await getStore(page);
  expect((store['ui'] as { reviewMode: boolean }).reviewMode).toBe(true);
});
