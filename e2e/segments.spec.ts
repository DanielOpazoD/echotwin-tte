import { expect, test } from '@playwright/test';
import { waitForFrames, type EchoWindow } from './helpers';

/**
 * LV segments on the ultrasound image (decision 153): the button on the image colours the segments of the tissue in
 * the plane, and the pointer over one names it. The pointer is moved by the browser, as a learner's mouse would be,
 * to the middle of a segment found in the frame's own segment map.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('echotwin.prefs.v1', JSON.stringify({ tutorialDone: true })),
  );
});

test('the image button shows the LV segments and the pointer names the one under it', async ({
  page,
}) => {
  await page.goto('/');
  await waitForFrames(page, 3);
  await page.getByRole('button', { name: 'A4C', exact: true }).click();
  await page.waitForFunction(
    () => {
      const hud = (window as unknown as EchoWindow).__echotwin.useHudStore.getState().hud;
      const view = hud?.['view'] as { bestViewId?: string; score?: number } | undefined;
      return view?.bestViewId === 'a4c' && (view.score ?? 0) > 80;
    },
    undefined,
    { timeout: 60_000 },
  );
  const toggle = page.getByRole('button', { name: /Segmentos VI/ });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  // freeze, so the segment stays under the pointer while the heart would beat
  await page.getByRole('button', { name: 'Freeze' }).click();
  await page.waitForTimeout(500);
  // the overlay paints the myocardium: a translucent wash, not an opaque mask
  const washed = await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('canvas.overlay');
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return 0;
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i]! > 30 && d[i]! < 140) n++;
    return n;
  });
  expect(washed).toBeGreaterThan(2000);
  // the middle of segment 9 (mid inferoseptal) on screen, from the frame's segment map
  const at = await page.evaluate(() => {
    const hud = (window as unknown as EchoWindow).__echotwin.useHudStore.getState()
      .hud as unknown as {
      segment: Uint8Array;
      polar: { lines: number; samples: number; sectorRad: number; depthCm: number };
      sector: { apexX: number; apexY: number; pxPerCm: number; invertLR: boolean };
      width: number;
      height: number;
    };
    const { polar: p, sector: m } = hud;
    let sx = 0,
      sy = 0,
      n = 0;
    for (let i = 0; i < hud.segment.length; i++) {
      if (hud.segment[i] !== 9) continue;
      const li = Math.floor(i / p.samples),
        si = i % p.samples;
      const th = -p.sectorRad / 2 + ((li + 0.5) * p.sectorRad) / p.lines;
      const r = ((si + 0.5) * p.depthCm) / p.samples;
      sx += m.apexX + r * m.pxPerCm * Math.sin(th) * (m.invertLR ? -1 : 1);
      sy += m.apexY + r * m.pxPerCm * Math.cos(th);
      n++;
    }
    const rc = document.querySelector('canvas.overlay')!.getBoundingClientRect();
    return n
      ? {
          x: rc.left + ((sx / n) * rc.width) / hud.width,
          y: rc.top + ((sy / n) * rc.height) / hud.height,
        }
      : null;
  });
  expect(at).not.toBeNull();
  await page.mouse.move(at!.x, at!.y);
  const tip = page.locator('.display-wrap .seg-tip');
  await expect(tip).toBeVisible();
  await expect(tip).toContainText('9 · Medio inferoseptal');
  await expect(tip).toContainText('Mid inferoseptal');
  // off the heart the name goes away
  const img = await page.locator('canvas.overlay').boundingBox();
  await page.mouse.move(img!.x + 8, img!.y + img!.height - 8);
  await expect(tip).toBeHidden();
});

/**
 * The numbers hold still (decision 181): on the short axis, once a beat has passed with the probe at rest, the numbers
 * and the RV insertions the overlay draws stay on the same pixels through the following beats, while the heart beats.
 * They used to be re-placed three times a second on the moving wall.
 */
test('the segment numbers and the RV insertions hold still through the beat', async ({ page }) => {
  await page.goto('/');
  await waitForFrames(page, 3);
  await page
    .getByRole('button', { name: 'PSAX', exact: true })
    .filter({ hasText: 'papilar' })
    .click();
  await page.waitForFunction(
    () => {
      const hud = (window as unknown as EchoWindow).__echotwin.useHudStore.getState().hud;
      const view = hud?.['view'] as { bestViewId?: string; score?: number } | undefined;
      return view?.bestViewId === 'psax-pm' && (view.score ?? 0) > 80;
    },
    undefined,
    { timeout: 60_000 },
  );
  await page.getByRole('button', { name: /Segmentos VI/ }).click();
  const placed = () =>
    page.evaluate(
      () =>
        document.querySelector<HTMLCanvasElement>('canvas.overlay')?.dataset.segmentLabels ?? '',
    );
  // a beat to settle (the probe reaches its pose first), then two more beats
  await page.waitForTimeout(2500);
  const first = await placed();
  const parsed = JSON.parse(first) as {
    labels: [number, number, number][];
    insertions: [number, number][] | null;
  };
  expect(parsed.labels.map((l) => l[0]).sort((a, b) => a - b)).toEqual([7, 8, 9, 10, 11, 12]);
  expect(parsed.insertions).not.toBeNull();
  const frames = await page.evaluate(
    () => (window as unknown as EchoWindow).__echotwin.useHudStore.getState().hud?.['frameId'],
  );
  await page.waitForTimeout(2000);
  expect(
    await page.evaluate(
      () => (window as unknown as EchoWindow).__echotwin.useHudStore.getState().hud?.['frameId'],
    ),
  ).not.toBe(frames);
  expect(await placed()).toBe(first);
});
