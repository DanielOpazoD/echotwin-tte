import { expect, test } from '@playwright/test';
import { waitForFrames, type EchoWindow } from './helpers';

type AudioProbe = Window & { audioFrequencies: number[]; audioGains: number[] };

test('Doppler audio follows acquired frequency and stops on freeze', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('echotwin.prefs.v1', JSON.stringify({ tutorialDone: true }));
    const w = window as unknown as AudioProbe;
    w.audioFrequencies = [];
    w.audioGains = [];
    // eslint-disable-next-line @typescript-eslint/unbound-method -- invoked with the owning context below
    const oscillator = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () {
      const node = oscillator.call(this);
      const index = w.audioFrequencies.push(0) - 1;
      const set = node.frequency.setTargetAtTime.bind(node.frequency);
      node.frequency.setTargetAtTime = (value, start, constant) => {
        w.audioFrequencies[index] = value;
        return set(value, start, constant);
      };
      return node;
    };
    // eslint-disable-next-line @typescript-eslint/unbound-method -- invoked with the owning context below
    const gain = AudioContext.prototype.createGain;
    AudioContext.prototype.createGain = function () {
      const node = gain.call(this);
      const index = w.audioGains.push(0) - 1;
      const set = node.gain.setTargetAtTime.bind(node.gain);
      node.gain.setTargetAtTime = (value, start, constant) => {
        w.audioGains[index] = value;
        return set(value, start, constant);
      };
      return node;
    };
  });
  await page.goto('/');
  await waitForFrames(page);
  await page.getByRole('button', { name: 'CW', exact: true }).click();
  await page.getByRole('button', { name: 'Audio Doppler' }).click();
  const read = () =>
    page.evaluate(() => {
      const w = window as unknown as AudioProbe;
      const h = (window as unknown as EchoWindow).__echotwin.useHudStore.getState().hud;
      return {
        frequency: w.audioFrequencies[10],
        gains: w.audioGains,
        strip: h?.['strip'] as { frequencyMHz?: number },
        frozen: h?.['frozen'],
      };
    });
  await expect.poll(async () => (await read()).gains.some((g) => g > 0)).toBe(true);
  for (const frequencyMHz of [2.5, 5]) {
    await page.evaluate((frequencyMHz) => {
      const s = (window as unknown as EchoWindow).__echotwin.useSimStore.getState();
      (s['setSettings'] as (v: unknown) => void)({ frequencyMHz });
    }, frequencyMHz);
    await expect.poll(async () => (await read()).strip.frequencyMHz).toBe(frequencyMHz);
    const shiftHz = (2 * frequencyMHz * 1e6 * (5.5 / 24) * 6) / 1540;
    await expect.poll(async () => Math.abs((await read()).frequency! - shiftHz)).toBeLessThan(0.01);
  }
  await page.keyboard.press('Space');
  await expect.poll(async () => (await read()).frozen).toBe(true);
  await expect.poll(async () => (await read()).gains.every((g) => g === 0)).toBe(true);
});
