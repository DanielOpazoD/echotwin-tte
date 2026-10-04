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
  await expect
    .poll(() =>
      page.evaluate(() => {
        const hud = (window as unknown as EchoWindow).__echotwin.useHudStore.getState().hud;
        return (hud?.['spectralRange'] as { vMax: number } | undefined)?.vMax ?? 99;
      }),
    )
    .toBeLessThan(0.6);
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
