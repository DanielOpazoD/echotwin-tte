import { expect, test } from '@playwright/test';
import { waitForFrames, type EchoWindow } from './helpers';

test('PW console and worker share the depth limit; CW keeps a wide scale', async ({ page }) => {
  await page.goto('/');
  await waitForFrames(page);
  await page.evaluate(() => {
    const s = (window as unknown as EchoWindow).__echotwin.useSimStore.getState();
    (s['setSettings'] as (v: unknown) => void)({ depthCm: 20, frequencyMHz: 2.5 });
    (s['setModality'] as (v: string) => void)('pw');
    (s['setCursor'] as (t: number, d: number) => void)(0, 20);
    (s['setSpectral'] as (v: unknown) => void)({ scaleMps: 5 });
  });
  const scale = page.getByRole('slider', { name: 'Escala', exact: true });
  await expect(scale).toBeVisible();
  expect(Number(await scale.inputValue())).toBeLessThan(0.6);
  expect(Number(await scale.getAttribute('max'))).toBeLessThan(0.6);
  await expect(page.getByText(/PRF .* kHz/)).toBeVisible();
  // Console state changes synchronously; the old B frame is not a PW acquisition.
  // Use the same worker-start deadline as waitForFrames, then check the physical limit
  // on that acquired mode. This does not assert interactive latency (profile it separately).
  await page.waitForFunction(
    () => {
      const h = (window as unknown as EchoWindow).__echotwin.useHudStore.getState().hud;
      return (h?.['acquisition'] as { modality: string } | undefined)?.modality === 'pw';
    },
    undefined,
    { timeout: 30_000 },
  );
  const acquiredRange = await page.evaluate(() => {
    const hud = (window as unknown as EchoWindow).__echotwin.useHudStore.getState().hud;
    return (hud?.['spectralRange'] as { vMax: number } | undefined)?.vMax ?? 99;
  });
  expect(acquiredRange).toBeLessThan(0.6);
  await page.getByRole('button', { name: 'CW', exact: true }).click();
  await expect(scale).toHaveValue('6');
  await expect(page.getByText(/PRF .* kHz/)).toHaveCount(0);
});

test('camera shortcuts preserve the acoustic probe position', async ({ page }) => {
  await page.goto('/');
  await waitForFrames(page);
  const probe = () =>
    page.evaluate(
      () => (window as unknown as EchoWindow).__echotwin.useSimStore.getState()['probe'],
    );
  const before = await probe();
  await page.getByRole('button', { name: 'Mirar perpendicular al plano ecográfico' }).click();
  expect(await probe()).toEqual(before);
  await page.getByRole('button', { name: 'Restablecer vista global del tórax' }).click();
  expect(await probe()).toEqual(before);
  await expect(page.locator('.torso-3d canvas')).toBeVisible();
});

test('frozen Doppler retains its acquired axes across console changes and resize', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await waitForFrames(page);
  await page.getByRole('button', { name: 'CW', exact: true }).click();
  const hud = () =>
    page.evaluate(() => {
      const h = (window as unknown as EchoWindow).__echotwin.useHudStore.getState().hud;
      return {
        frozen: h?.['frozen'],
        range: h?.['spectralRange'],
        strip: h?.['strip'] as
          | {
              topValue: number;
              bottomValue: number;
              width: number;
              secondsPerColumn: number;
            }
          | undefined,
      };
    });
  await expect.poll(async () => (await hud()).strip?.topValue).toBe(6);
  await page.evaluate(() => {
    const s = (window as unknown as EchoWindow).__echotwin.useSimStore.getState();
    (s['toggleFreeze'] as () => void)();
  });
  await expect.poll(async () => (await hud()).frozen).toBe(true);
  await expect(page.getByText(/Tira congelada: los ajustes de adquisición/)).toBeVisible();
  const before = await hud();
  await page.evaluate(() => {
    const s = (window as unknown as EchoWindow).__echotwin.useSimStore.getState();
    (s['setSpectral'] as (v: unknown) => void)({
      scaleMps: 3,
      baselineShiftMps: 1,
      gainDb: 20,
      wallFilterMps: 0.6,
      sweepSpeedMmPerS: 100,
    });
  });
  await expect(page.getByRole('slider', { name: 'Escala', exact: true })).toHaveValue('3');
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect.poll(async () => (await hud()).strip?.width).not.toBe(before.strip!.width);
  const resized = await hud();
  expect(resized.range).toEqual(before.range);
  expect(resized.strip!.topValue).toBe(before.strip!.topValue);
  expect(resized.strip!.secondsPerColumn * resized.strip!.width).toBeCloseTo(
    before.strip!.secondsPerColumn * before.strip!.width,
    10,
  );
  await page.evaluate(() => {
    const s = (window as unknown as EchoWindow).__echotwin.useSimStore.getState();
    (s['toggleFreeze'] as () => void)();
  });
  await expect.poll(async () => (await hud()).strip?.topValue).toBe(4);
});
