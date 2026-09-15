import { expect, test } from '@playwright/test';
import { getStore, waitForFrames } from './helpers';

interface StoreView {
  activeTool: string;
  activeMeasurementId: string | null;
  measurements: {
    measurementId: string | null;
    label: string;
    technique: { score: number; findings: { code: string; level: string }[] } | null;
  }[];
}
const store = async (page: Parameters<typeof getStore>[0]): Promise<StoreView> =>
  (await getStore(page)) as unknown as StoreView;

/**
 * Measurement protocol with technique evaluation (spec 16, 28): a semantic measurement selected
 * from the panel arms its tool, is captured with provenance, graded for technique and reported
 * with explanations and derived calculations.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('echotwin.prefs.v1', JSON.stringify({ tutorialDone: true })),
  );
  await page.goto('/');
  await waitForFrames(page, 3);
});

test('LVOT diameter from the protocol panel is captured with a technique grade and reported', async ({
  page,
}) => {
  // move to PLAX with the preset (guided mode) and wait for the motion to end
  await page.getByRole('button', { name: 'PLAX' }).click();
  await page.waitForFunction(
    () =>
      (
        window as unknown as {
          __echotwin: { useSimStore: { getState: () => { presetAnim: unknown } } };
        }
      ).__echotwin.useSimStore.getState().presetAnim === null,
    null,
    { timeout: 15000 },
  );
  await waitForFrames(page, 3);
  await page.getByRole('button', { name: 'Medir Diámetro del TSVI' }).click();
  const st = await store(page);
  expect(st.activeTool).toBe('caliper');
  expect(st.activeMeasurementId).toBe('lvot-diameter');
  await expect(page.getByRole('status')).toContainText('Diámetro del TSVI');
  // freeze and click two points inside the sector
  await page.keyboard.press('Space');
  await waitForFrames(page, 1);
  const canvas = page.locator('canvas.overlay');
  const box = (await canvas.boundingBox())!;
  await canvas.click({ position: { x: box.width * 0.5, y: box.height * 0.35 } });
  await canvas.click({ position: { x: box.width * 0.5, y: box.height * 0.42 } });
  const after = await store(page);
  expect(after.measurements.length).toBe(1);
  const m = after.measurements[0]!;
  expect(m.measurementId).toBe('lvot-diameter');
  expect(m.label).toBe('Diámetro del TSVI');
  expect(m.technique).not.toBeNull();
  expect(m.technique!.findings.length).toBeGreaterThan(3);
  expect(m.technique!.findings.map((f) => f.code)).toEqual(
    expect.arrayContaining(['modality', 'phase', 'placement']),
  );
  expect(m.technique!.score).toBeGreaterThan(0);
  expect(m.technique!.score).toBeLessThanOrEqual(1);
  // the panel shows the value and a technique pill; the tool is disarmed after capture
  expect(after.activeMeasurementId).toBeNull();
  await expect(page.locator('[data-measurement="lvot-diameter"] .pill')).toHaveCount(1);
  // report: technique column with the grade and derived LVOT area
  await page.getByRole('button', { name: 'Informe' }).click();
  await expect(page.locator('tr[data-technique]')).toHaveCount(1);
  await expect(page.locator('tr[data-technique] .pill')).toContainText('/100');
  await expect(page.locator('tr[data-derived="lvot-area"]')).toHaveCount(1);
});

test('free tools stay available and record measurements without a protocol id', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Caliper', exact: true }).click();
  await page.keyboard.press('Space');
  await waitForFrames(page, 1);
  const canvas = page.locator('canvas.overlay');
  const box = (await canvas.boundingBox())!;
  await canvas.click({ position: { x: box.width * 0.45, y: box.height * 0.3 } });
  await canvas.click({ position: { x: box.width * 0.55, y: box.height * 0.4 } });
  const st = await store(page);
  expect(st.measurements.length).toBe(1);
  expect(st.measurements[0]!.measurementId).toBeNull();
  expect(st.measurements[0]!.technique).toBeNull();
});
