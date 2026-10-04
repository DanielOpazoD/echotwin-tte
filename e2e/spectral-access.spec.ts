import { expect, test } from '@playwright/test';
import { waitForFrames, type EchoWindow } from './helpers';
import { loadCaseById } from '../src/cases';
import { SimulatorCore } from '../src/simulator/core/simulatorCore';
import { baseInput } from '../src/simulator/core/baseInput';
import { heartLandmarks, heartToTorso } from '../src/simulator/anatomy/heartModel';
import { canonicalControl, getViewTarget } from '../src/simulator/windows/viewTargets';
import { beamFrameFromPose, controlAimingAt, poseFromControl } from '../src/simulator/probe/pose';
import { dot, sub } from '../src/core/vec3';
import type { SimOutput } from '../src/simulator/core/protocol';

type ObservedWindow = EchoWindow & {
  acousticAccess: { peak: number; count: number; startS: number | null; endS: number };
  stopAcousticAccess?: () => void;
  __echotwin: EchoWindow['__echotwin'] & {
    frameBus: { subscribe: (fn: (out: SimOutput) => void) => () => void };
  };
};

/** Derive controls from today's anatomy; the worker must acquire, lose and recover the same LVOT. */
for (const modality of ['pw', 'cw'] as const)
  test(`${modality.toUpperCase()} loses its spectrum behind lung and recovers after moving back`, async ({
    page,
  }) => {
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
        modality,
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
        const w = window as unknown as ObservedWindow;
        w.stopAcousticAccess?.();
        w.acousticAccess = { peak: 0, count: 0, startS: null, endS: 0 };
        // Observe every delivered column instead of polling the throttled HUD at intervals that
        // can repeatedly fall outside systole. Ignore frames still acquired at the previous pose.
        w.stopAcousticAccess = w.__echotwin.frameBus.subscribe((out) => {
          const a = out.acquisition;
          if (
            !a ||
            a.modality !== cfg.modality ||
            a.settings.frequencyMHz !== 1.5 ||
            out.strip.kind !== 'spectral'
          )
            return;
          if (
            Math.abs(a.gateDepthCm - cfg.depth) > 1e-6 ||
            Math.abs(a.cursorThetaRad - cfg.theta) > 1e-6 ||
            Object.entries(cfg.probe).some(
              ([key, value]) => Math.abs(a.probe[key as keyof typeof a.probe] - value) > 1e-6,
            )
          )
            return;
          const t = out.strip.headTimeS;
          if (t === undefined || !out.spectrumColumn) return;
          const observed = w.acousticAccess;
          observed.startS ??= t;
          observed.endS = t;
          observed.count++;
          observed.peak = Math.max(observed.peak, ...out.spectrumColumn);
        });
        const s = w.__echotwin.useSimStore.getState();
        (s['setSettings'] as (v: unknown) => void)({ depthCm: 20, frequencyMHz: 1.5 });
        (s['setModality'] as (v: string) => void)(cfg.modality);
        (s['setProbe'] as (v: unknown) => void)(cfg.probe);
        (s['setCursor'] as (t: number, d: number) => void)(cfg.theta, cfg.depth);
      }, settings[index]!);
    };
    const read = () =>
      page.evaluate(() => {
        const s = (window as unknown as ObservedWindow).acousticAccess;
        return { peak: s.peak, count: s.count, spanS: s.startS === null ? 0 : s.endS - s.startS };
      });
    await aim(0);
    await expect.poll(async () => (await read()).peak, { timeout: 20000 }).toBeGreaterThan(0.35);
    await aim(1);
    await expect
      .poll(async () => (await read()).spanS, { timeout: 20000 })
      .toBeGreaterThanOrEqual(2);
    await expect
      .poll(async () => (await read()).count, { timeout: 20000 })
      .toBeGreaterThanOrEqual(12);
    const blocked = await read();
    expect(blocked.count).toBeGreaterThanOrEqual(12);
    expect(Number.isFinite(blocked.peak)).toBe(true);
    expect(blocked.peak).toBeLessThan(0.15);
    await aim(0);
    await expect.poll(async () => (await read()).peak, { timeout: 20000 }).toBeGreaterThan(0.35);
    await page.evaluate(() => (window as unknown as ObservedWindow).stopAcousticAccess?.());
  });
