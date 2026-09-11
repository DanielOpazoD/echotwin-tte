import { expect, test } from '@playwright/test';
import { getHud, getStore, imageMean, waitForFrames } from './helpers';

test.describe('EchoTwin TTE core flow', () => {
  test.beforeEach(async ({ page }) => {
    // the controls tutorial is skipped for the flow tests (it has its own test below)
    await page.addInitScript(() => {
      if (!localStorage.getItem('echotwin.prefs.v1')) localStorage.setItem('echotwin.prefs.v1', JSON.stringify({ tutorialDone: true }));
    });
    await page.goto('/');
    await waitForFrames(page, 3);
  });

  test('loads the normal case, shows the disclaimer and renders a non-black image', async ({ page }) => {
    await expect(page.getByText('Simulador educacional con pacientes sintéticos', { exact: false }).first()).toBeVisible();
    await expect(page.getByText('Normal — ventana excelente', { exact: false }).first()).toBeVisible();
    const mean = await imageMean(page);
    expect(mean).toBeGreaterThan(4);
    const hud = await getHud(page);
    expect(hud?.['view']).toBeTruthy();
  });

  test('moving the probe with the keyboard changes the pose and the recognised view score', async ({ page }) => {
    const before = await getStore(page);
    const probeBefore = before['probe'] as { rotationDeg: number; u: number };
    await page.keyboard.press('e');
    await page.keyboard.press('e');
    await page.keyboard.press('ArrowRight');
    const after = await getStore(page);
    const probeAfter = after['probe'] as { rotationDeg: number; u: number };
    expect(probeAfter.rotationDeg).toBeCloseTo(probeBefore.rotationDeg + 6, 5);
    expect(probeAfter.u).toBeCloseTo(probeBefore.u + 0.2, 5);
    // rotate a lot: the view analysis must react (score/plane error change)
    const hud0 = await getHud(page);
    for (let i = 0; i < 6; i++) await page.keyboard.press('Shift+E');
    await page.waitForTimeout(1500);
    const hud1 = await getHud(page);
    const v0 = hud0?.['view'] as { score: number; inPlaneRotationDeg: number } | null;
    const v1 = hud1?.['view'] as { score: number; inPlaneRotationDeg: number } | null;
    expect(v0 && v1 && (v0.score !== v1.score || Math.abs(v0.inPlaneRotationDeg - v1.inPlaneRotationDeg) > 5)).toBeTruthy();
  });

  test('colour Doppler can be enabled and its scale changed', async ({ page }) => {
    await page.getByRole('button', { name: 'Color', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Color', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const scale = page.getByRole('slider', { name: 'Escala (Nyquist)' });
    await scale.fill('0.3');
    const s = await getStore(page);
    expect((s['color'] as { scaleMps: number }).scaleMps).toBeCloseTo(0.3, 5);
    await page.waitForTimeout(1500);
    const hud = await getHud(page);
    expect((hud?.['colorFps'] as number) ?? 0).toBeGreaterThan(0);
  });

  test('freeze, cine and a linear caliper measurement', async ({ page }) => {
    await page.keyboard.press('Space');
    await expect(page.getByText('FREEZE')).toBeVisible();
    await expect(page.getByRole('slider', { name: 'Cine' })).toBeVisible();
    await page.getByRole('button', { name: 'Caliper' }).click();
    const overlay = page.getByLabel('Superposiciones y herramientas de medición');
    const box = await overlay.boundingBox();
    expect(box).toBeTruthy();
    await overlay.click({ position: { x: box!.width * 0.5, y: box!.height * 0.3 } });
    await overlay.click({ position: { x: box!.width * 0.5, y: box!.height * 0.5 } });
    const s = await getStore(page);
    const ms = s['measurements'] as { kind: string; value: number; units: string }[];
    expect(ms.length).toBe(1);
    expect(ms[0]!.kind).toBe('linear');
    expect(ms[0]!.units).toBe('cm');
    expect(ms[0]!.value).toBeGreaterThan(0.5);
  });

  test('PW Doppler shows a spectral strip and M-mode a trace', async ({ page }) => {
    await page.getByRole('button', { name: 'PW', exact: true }).click();
    await page.waitForTimeout(2000);
    let hud = await getHud(page);
    expect((hud?.['strip'] as { kind: string }).kind).toBe('spectral');
    expect(hud?.['spectrumColumn']).toBeTruthy();
    await page.getByRole('button', { name: 'M', exact: true }).click();
    await page.waitForTimeout(1500);
    hud = await getHud(page);
    expect((hud?.['strip'] as { kind: string }).kind).toBe('m-mode');
  });

  test('exam mode hides hints, physics and dev panel', async ({ page }) => {
    await page.getByRole('combobox', { name: 'Modo del producto' }).selectOption('exam');
    await expect(page.getByText('Modo examen: sin ayudas', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Dev' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Física' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Referencias' })).toBeDisabled();
  });

  test('reload preserves only allowed preferences (torso visibility)', async ({ page }) => {
    await page.getByRole('button', { name: 'Torso 3D' }).click();
    await page.reload();
    await waitForFrames(page, 2);
    const s = await getStore(page);
    expect((s['ui'] as { showTorso: boolean }).showTorso).toBe(false);
    // measurements and pose are not persisted
    expect((s['measurements'] as unknown[]).length).toBe(0);
  });
});

test('a preset view moves the probe continuously and reaches the target view', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('echotwin.prefs.v1', JSON.stringify({ tutorialDone: true })));
  await page.goto('/');
  await waitForFrames(page, 3);
  const before = (await getStore(page))['probe'] as { u: number; v: number; rotationDeg: number };
  await page.getByRole('button', { name: 'A4C', exact: true }).click();
  await page.waitForTimeout(400);
  const mid = (await getStore(page))['probe'] as { u: number; v: number; rotationDeg: number };
  // still travelling: between the start and the apical window
  expect(Math.hypot(mid.u - before.u, mid.v - before.v)).toBeGreaterThan(0.1);
  await page.waitForFunction(() => {
    const w = window as unknown as { __echotwin: { useSimStore: { getState: () => { presetAnim: unknown } } } };
    return w.__echotwin.useSimStore.getState().presetAnim === null;
  }, undefined, { timeout: 8000 });
  await page.waitForTimeout(1500);
  const hud = await getHud(page);
  const view = hud?.['view'] as { bestViewId: string; score: number };
  expect(view.bestViewId).toBe('a4c');
  expect(view.score).toBeGreaterThan(55);
  // the probe remains manipulable afterwards
  await page.keyboard.press('e');
  const after = (await getStore(page))['probe'] as { rotationDeg: number };
  expect(after.rotationDeg).not.toBe(mid.rotationDeg);
});

test('the controls tutorial appears on a fresh profile and can be skipped', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('dialog', { name: 'Tutorial de controles' })).toBeVisible();
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(page.getByText('2 · Marcador y rotación')).toBeVisible();
  await page.getByRole('button', { name: 'Saltar' }).click();
  await expect(page.getByRole('dialog', { name: 'Tutorial de controles' })).toHaveCount(0);
  await page.reload();
  await waitForFrames(page, 2);
  await expect(page.getByRole('dialog', { name: 'Tutorial de controles' })).toHaveCount(0);
});
