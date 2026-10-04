import { expect, test } from '@playwright/test';
import { waitForFrames, type EchoWindow } from './helpers';
import { loadCaseById } from '../src/cases';
import { SimulatorCore } from '../src/simulator/core/simulatorCore';
import { baseInput } from '../src/simulator/core/baseInput';
import { heartLandmarks, heartToTorso } from '../src/simulator/anatomy/heartModel';
import { canonicalControl, getViewTarget } from '../src/simulator/windows/viewTargets';
import { beamFrameFromPose, controlAimingAt, poseFromControl } from '../src/simulator/probe/pose';
import { dot, sub } from '../src/core/vec3';

/** Derive controls from today's anatomy; the worker must acquire, lose and recover the same LVOT. */
test('PW loses its spectrum behind lung and recovers after moving back', async ({ page }) => {
  const core = new SimulatorCore(loadCaseById('normal-excellent-window'), baseInput());
  const { heart, thorax } = core.models;
  const ref = canonicalControl(getViewTarget('a5c'), heart, thorax);
  const refBeam = beamFrameFromPose(poseFromControl(thorax, ref));
  const p = heartToTorso(heart.frame, heartLandmarks(heart).find((l) => l.id === 'lvot')!.p);
  const settings = [0, 4].map((du) => {
    const probe = controlAimingAt(thorax, ref.u + du, ref.v, p, refBeam.lateral);
    const beam = beamFrameFromPose(poseFromControl(thorax, probe));
    const d = sub(p, beam.origin);
    return {
      probe,
      depth: Math.hypot(dot(d, beam.forward), dot(d, beam.lateral)),
      theta: Math.atan2(dot(d, beam.lateral), dot(d, beam.forward)),
    };
  });
  core.dispose();
  await page.goto('/');
  await waitForFrames(page);
  const aim = async (index: number) => {
    await page.evaluate((cfg) => {
      const s = (window as unknown as EchoWindow).__echotwin.useSimStore.getState();
      (s['setSettings'] as (v: unknown) => void)({ depthCm: 20, frequencyMHz: 1.5 });
      (s['setModality'] as (v: string) => void)('pw');
      (s['setProbe'] as (v: unknown) => void)(cfg.probe);
      (s['setCursor'] as (t: number, d: number) => void)(cfg.theta, cfg.depth);
    }, settings[index]!);
  };
  const read = () =>
    page.evaluate(() => {
      const h = (window as unknown as EchoWindow).__echotwin.useHudStore.getState().hud;
      return {
        frame: Number(h?.['frameId'] ?? 0),
        peak: Math.max(...Array.from((h?.['spectrumColumn'] as Float32Array) ?? [])),
      };
    });
  await aim(0);
  await expect.poll(async () => (await read()).peak, { timeout: 20000 }).toBeGreaterThan(0.35);
  await aim(1);
  const start = (await read()).frame;
  await waitForFrames(page, start + 3);
  for (let i = 0; i < 12; i++) {
    const sample = await read();
    expect(Number.isFinite(sample.peak)).toBe(true);
    expect(sample.peak).toBeLessThan(0.15);
    await waitForFrames(page, sample.frame + 1);
  }
  await aim(0);
  await expect.poll(async () => (await read()).peak, { timeout: 20000 }).toBeGreaterThan(0.35);
});
