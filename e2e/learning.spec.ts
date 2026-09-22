import { expect, test } from '@playwright/test';
import { getStore, waitForFrames } from './helpers';

/**
 * Instructional layer (proposal 7): curriculum tasks complete automatically from the learner's
 * state, progress persists locally and can be reset, causal explanations accompany hints, and the
 * structured impression is scored against the case truth in the report.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('echotwin.prefs.v1', JSON.stringify({ tutorialDone: true }));
    // start each test with empty progress, but keep it across reloads within the test
    if (!sessionStorage.getItem('e2e-progress-reset')) {
      localStorage.removeItem('echotwin.progress.v1');
      sessionStorage.setItem('e2e-progress-reset', '1');
    }
  });
  await page.goto('/');
  await waitForFrames(page, 3);
});

test('a curriculum task completes when the PLAX preset reaches its score and the progress persists across reloads', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'PLAX' }).click();
  await page.waitForFunction(
    () =>
      (
        window as unknown as {
          __echotwin: { useSimStore: { getState: () => { presetAnim: unknown } } };
        }
      ).__echotwin.useSimStore.getState().presetAnim === null,
    null,
    { timeout: 20000 },
  );
  await page.waitForFunction(
    () =>
      Boolean(
        (
          window as unknown as {
            __echotwin: {
              useSimStore: {
                getState: () => { progress: { completedTasks: Record<string, number> } };
              };
            };
          }
        ).__echotwin.useSimStore.getState().progress.completedTasks['plax-70'],
      ),
    null,
    { timeout: 20000 },
  );
  await page.getByRole('button', { name: 'Currículo' }).click();
  await expect(page.locator('[data-task="plax-70"]')).toHaveAttribute('data-done', '1');
  await expect(page.locator('[data-task="a4c-70"]')).toHaveAttribute('data-done', '0');
  await page.reload();
  await waitForFrames(page, 2);
  const st = (await getStore(page)) as unknown as {
    progress: { completedTasks: Record<string, number>; events: { kind: string }[] };
  };
  expect(st.progress.completedTasks['plax-70']).toBeTruthy();
  expect(st.progress.events.some((e) => e.kind === 'view')).toBe(true);
  await page.getByRole('button', { name: 'Progreso' }).click();
  await expect(page.locator('[data-progress-view="plax"] td').nth(1)).not.toHaveText('—');
});

test('the guidance panel explains causes and the report scores a structured impression', async ({
  page,
}) => {
  // the guide is hidden until asked for (decision 141); an imperfect pose (start probe) yields at least one
  // causal explanation
  await expect(page.locator('.guidance')).toHaveCount(0);
  await page.getByRole('button', { name: 'Guía de la vista' }).click();
  await expect(page.locator('.guidance .causes')).toHaveCount(1);
  await page.getByRole('button', { name: 'Informe' }).click();
  await page.locator('[data-finding="ef-normal"] input').check();
  await page.locator('[data-finding="as-none"] input').check();
  await page.locator('[data-finding="mr-none"] input').check();
  await page.locator('[data-finding="normal-study"] input').check();
  await expect(page.locator('[data-impression-result]')).toContainText('100/100');
  await page.locator('[data-finding="as-severe"] input').check(); // exclusive group: replaces as-none
  const st = (await getStore(page)) as unknown as { impressionSelection: string[] };
  expect(st.impressionSelection).toContain('as-severe');
  expect(st.impressionSelection).not.toContain('as-none');
  await expect(page.locator('[data-impression-result]')).not.toContainText('100/100');
});
