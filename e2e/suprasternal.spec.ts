import { expect, test } from '@playwright/test';
import { waitForFrames, type EchoWindow } from './helpers';
import type { SimOutput } from '../src/simulator/core/protocol';
import { Structure } from '../src/simulator/anatomy/tissue';

for (const position of ['left-lateral', 'supine'] as const)
  test(`SSN in ${position} moves the physical probe through intermediate acquisitions and leaves manual control available`, async ({
    page,
  }) => {
    await page.addInitScript(() =>
      localStorage.setItem('echotwin.prefs.v1', JSON.stringify({ tutorialDone: true })),
    );
    await page.goto('/');
    await waitForFrames(page);
    await page.getByLabel('Posición del paciente').selectOption(position);
    await page.evaluate(() => {
      const w = window as unknown as EchoWindow & {
        __echotwin: { frameBus: { subscribe: (f: (out: SimOutput) => void) => () => void } };
      };
      const samples: number[] = [];
      (window as unknown as { ssnSamples: number[] }).ssnSamples = samples;
      w.__echotwin.frameBus.subscribe((out) => {
        if (out.acquisition) {
          samples.push(out.acquisition.probe.v);
          (window as unknown as { ssnOutput: SimOutput }).ssnOutput = out;
        }
      });
    });
    await page.getByRole('button', { name: 'SSN', exact: true }).click();
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const h = (window as unknown as EchoWindow).__echotwin.useHudStore.getState().hud;
            return (h?.['view'] as { window?: string } | undefined)?.window;
          }),
        { timeout: 30000 },
      )
      .toBe('suprasternal');
    await page.waitForFunction(
      () =>
        (window as unknown as EchoWindow).__echotwin.useSimStore.getState()['presetAnim'] === null,
    );
    await expect
      .poll(() =>
        page.evaluate(() => {
          const w = window as unknown as EchoWindow & {
            __echotwin: { frameBus: { latest: SimOutput } };
          };
          const control = w.__echotwin.useSimStore.getState()['probe'] as { v: number };
          return Math.abs(
            ((window as unknown as { ssnOutput?: SimOutput }).ssnOutput?.acquisition?.probe.v ??
              -99) - control.v,
          );
        }),
      )
      .toBeLessThan(0.001);
    const acquired = await page.evaluate(
      ([archId, descendingId]) => {
        const out = (window as unknown as { ssnOutput: SimOutput }).ssnOutput;
        return {
          probe: out.acquisition?.probe,
          patientPosition: out.acquisition?.patient.position,
          arch: Array.from(out.structure).filter((s) => s === archId).length,
          descending: Array.from(out.structure).filter((s) => s === descendingId).length,
          intermediate: (window as unknown as { ssnSamples: number[] }).ssnSamples.filter(
            (v) => v > 3 && v < 9,
          ).length,
        };
      },
      [Structure.AorticArch, Structure.DescendingAorta],
    );
    expect(acquired.patientPosition).toBe(position);
    expect(acquired.probe?.v).toBeGreaterThanOrEqual(10);
    expect(acquired.arch).toBeGreaterThan(500);
    expect(acquired.descending).toBeGreaterThan(60);
    expect(acquired.intermediate).toBeGreaterThan(0);
    await page.keyboard.press('ArrowRight');
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as EchoWindow).__echotwin.useSimStore.getState()['probe'],
        ),
      )
      .not.toEqual(acquired.probe);
  });
