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

test('markers move by dragging, delete with a key, come back with undo, and can be put on the 3D model', async ({
  page,
}) => {
  await page.goto('/');
  await waitForFrames(page, 3);
  await page.evaluate(() => {
    const w = window as unknown as EchoWindow;
    (w.__echotwin.useSimStore.getState()['setUi'] as (u: unknown) => void)({
      reviewMode: true,
      consoleTab: 'revisar',
      tutorialDone: true,
    });
  });
  const canvas = page.locator('canvas.overlay');
  const box = (await canvas.boundingBox())!;
  const at = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.4 };
  await page.mouse.click(at.x, at.y);
  const markers = () =>
    page.evaluate(() => {
      const w = window as unknown as EchoWindow;
      return (
        w.__echotwin.useSimStore.getState()['reviewMarkers'] as {
          id: string;
          space: string;
          rCm: number | null;
          point: { structure: number; offPlaneCm: number } | null;
        }[]
      ).map((m) => ({ id: m.id, space: m.space, rCm: m.rCm, point: m.point }));
    });
  await expect.poll(async () => (await markers())[0]?.point !== null).toBe(true);
  const before = (await markers())[0]!;
  // the first marker on a live image froze it (decision 135)
  expect((await getStore(page))['frozen'] as boolean).toBe(true);

  // drag the marker 40 px deeper: its polar position changes and the worker answers again
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x, at.y + 20, { steps: 4 });
  await page.mouse.move(at.x, at.y + 40, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await markers())[0]?.point !== null).toBe(true);
  const after = (await markers())[0]!;
  expect(after.id).toBe(before.id);
  expect(after.rCm!).toBeGreaterThan(before.rCm! + 0.5);

  // the click selected it: Delete removes it, undo brings it back
  await expect(page.locator('.review-item.on')).toHaveCount(1);
  await page.keyboard.press('Delete');
  await expect(page.locator('.review-item')).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.review-item')).toHaveCount(1);

  // a click without drag on the 3D navigator marks the surface it hits (skin, bone or heart)
  const torso = page.locator('.torso-wrap canvas');
  const tb = (await torso.boundingBox())!;
  await expect
    .poll(
      async () => {
        await page.mouse.click(tb.x + tb.width * 0.5, tb.y + tb.height * 0.45);
        return (await markers()).some((m) => m.space === 'model');
      },
      { timeout: 30_000, intervals: [1000] },
    )
    .toBe(true);
  await expect(page.locator('.review-chip')).toHaveCount(1);
  await expect
    .poll(async () => (await markers()).find((m) => m.space === 'model')?.point !== null)
    .toBe(true);
  const model = (await markers()).find((m) => m.space === 'model')!;
  expect(Number.isFinite(model.point!.offPlaneCm)).toBe(true);
  await expect(page.locator('.review-item').last().locator('.review-place')).toContainText('3D ·');
});
