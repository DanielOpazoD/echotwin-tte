import { expect, test, type Page } from '@playwright/test';
import type { SectorMapping } from '../src/simulator/renderer/scanConvert';
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
  await page.getByRole('tab', { name: 'Medir' }).click();
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
  await page.getByRole('tab', { name: 'Medir' }).click();
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

interface CaliperWindow {
  __echotwin: {
    useHudStore: {
      getState: () => {
        hud: { sector: SectorMapping; width: number; height: number; frozen: boolean };
      };
    };
    useSimStore: {
      getState: () => {
        measurements: {
          value: number;
          geometry: { x: number; y: number }[];
          captureSector?: SectorMapping;
        }[];
      };
    };
  };
}

async function spatialState(page: Page) {
  return page.evaluate(() => {
    const api = (window as unknown as CaliperWindow).__echotwin;
    return {
      sector: api.useHudStore.getState().hud.sector,
      measurement: api.useSimStore.getState().measurements[0]!,
    };
  });
}

async function clickSectorPoint(page: Page, xCm: number, yCm: number) {
  const hud = await page.evaluate(() => {
    const h = (window as unknown as CaliperWindow).__echotwin.useHudStore.getState().hud;
    return { sector: h.sector, width: h.width, height: h.height };
  });
  const canvas = page.locator('canvas.overlay');
  const box = (await canvas.boundingBox())!;
  await canvas.click({
    position: {
      x:
        ((hud.sector.apexX + xCm * hud.sector.pxPerCm * (hud.sector.invertLR ? -1 : 1)) *
          box.width) /
        hud.width,
      y: ((hud.sector.apexY + yCm * hud.sector.pxPerCm) * box.height) / hud.height,
    },
  });
}

async function zoomTwice(page: Page, scale: number) {
  await page.getByRole('tab', { name: 'Imagen' }).click();
  const zoom = page.locator('input[aria-label="Zoom"]');
  await zoom.press('Home');
  for (let i = 0; i < 10; i++) await zoom.press('ArrowRight');
  await page.waitForFunction(
    (s) =>
      (window as unknown as CaliperWindow).__echotwin.useHudStore.getState().hud.sector.pxPerCm >
      s * 1.99,
    scale,
  );
}

async function assertProjectedCaliper(
  page: Page,
  original: Awaited<ReturnType<typeof spatialState>>,
) {
  const current = await spatialState(page);
  expect(current.measurement.value).toBe(original.measurement.value);
  expect(current.measurement.geometry).toEqual(original.measurement.geometry);
  expect(current.measurement.captureSector).toEqual(original.measurement.captureSector);
  const hits = await page.evaluate(
    ({ points, from }) => {
      const m = (window as unknown as CaliperWindow).__echotwin.useHudStore.getState().hud.sector;
      const ctx = document.querySelector<HTMLCanvasElement>('canvas.overlay')!.getContext('2d')!;
      return points.map((p) => {
        const x =
          m.apexX +
          ((p.x - from.apexX) / from.pxPerCm) * m.pxPerCm * (from.invertLR !== m.invertLR ? -1 : 1);
        const y = m.apexY + ((p.y - from.apexY) / from.pxPerCm) * m.pxPerCm;
        const rgba = ctx.getImageData(Math.round(x) - 3, Math.round(y) - 3, 7, 7).data;
        let n = 0;
        for (let i = 0; i < rgba.length; i += 4)
          if (rgba[i]! > 180 && rgba[i + 1]! > 100 && rgba[i + 2]! < 140 && rgba[i + 3]! > 100) n++;
        return n;
      });
    },
    { points: original.measurement.geometry, from: original.sector },
  );
  for (const n of hits)
    expect(n, 'crosshair must be drawn at its physically reprojected position').toBeGreaterThan(0);
}

test('sector calipers follow zoom, inversion and resize without changing the measured value', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Freeze', exact: true }).click();
  await page.waitForFunction(
    () => (window as unknown as CaliperWindow).__echotwin.useHudStore.getState().hud.frozen,
  );
  await page.getByRole('tab', { name: 'Medir' }).click();
  await page.getByRole('button', { name: 'Caliper', exact: true }).click();
  await clickSectorPoint(page, -1.5, 3.5);
  await clickSectorPoint(page, 0.5, 5);
  const original = await spatialState(page);
  expect(original.measurement.captureSector).toEqual(original.sector);
  const [a, b] = original.measurement.geometry;
  expect(original.measurement.value).toBeCloseTo(
    Math.hypot(a!.x - b!.x, a!.y - b!.y) / original.sector.pxPerCm,
    10,
  );
  await assertProjectedCaliper(page, original);
  await zoomTwice(page, original.sector.pxPerCm);
  await assertProjectedCaliper(page, original);
  await page.locator('.row').filter({ hasText: 'Invertir izq/der' }).getByRole('button').click();
  await page.waitForFunction(
    () =>
      (window as unknown as CaliperWindow).__echotwin.useHudStore.getState().hud.sector.invertLR,
  );
  await assertProjectedCaliper(page, original);
  const width = (await spatialState(page)).sector.width;
  const viewport = page.viewportSize()!;
  await page.setViewportSize({ ...viewport, width: viewport.width - 180 });
  await page.waitForFunction(
    (w) =>
      (window as unknown as CaliperWindow).__echotwin.useHudStore.getState().hud.sector.width !== w,
    width,
  );
  await assertProjectedCaliper(page, original);
});

test('zoom between the first and second caliper clicks preserves physical calibration', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Freeze', exact: true }).click();
  await page.waitForFunction(
    () => (window as unknown as CaliperWindow).__echotwin.useHudStore.getState().hud.frozen,
  );
  await page.getByRole('tab', { name: 'Medir' }).click();
  await page.getByRole('button', { name: 'Caliper', exact: true }).click();
  const original = await spatialState(page);
  await clickSectorPoint(page, -1.5, 3.5);
  await zoomTwice(page, original.sector.pxPerCm);
  await clickSectorPoint(page, 0.5, 5);
  const after = await spatialState(page);
  expect(Math.abs(after.measurement.value - 2.5)).toBeLessThanOrEqual(
    (2 * Math.SQRT2) / original.sector.pxPerCm,
  );
  expect(after.measurement.captureSector).toEqual(after.sector);
  await assertProjectedCaliper(page, after);
});
