// @tier slow
import { describe, expect, it, vi } from 'vitest';
import { loadCaseById } from '@/cases';
import { SimulatorCore } from './simulatorCore';
import { baseInput } from './baseInput';
import { DUPLEX_BMODE_SHARE } from '@/simulator/renderer/frameRate';
import type { ImagingModality } from '@/simulator/renderer/types';

/**
 * The 2D image shares the transmit time with a spectral Doppler strip (decision 212). Before, the scanner kept its full 2D
 * rate beside a gapless spectrum (68.6 Hz with the default console in PW, CW and TDI alike), and the core formed a 2D frame
 * at every step of a spectral run: three quarters of the time of the tests that follow the Doppler through the core went
 * to images nobody read.
 */
const rate = vi.hoisted(() => ({ fullDuplex: false }));
vi.mock(import('@/simulator/renderer/frameRate'), async (importOriginal) => {
  const mod = await importOriginal();
  return {
    ...mod,
    // `fullDuplex` restores the old behaviour, to compare the spectrum at both 2D rates
    acquisitionFrameRate: (...args: Parameters<typeof mod.acquisitionFrameRate>) =>
      mod.acquisitionFrameRate(args[0], args[1], rate.fullDuplex ? false : args[2]),
  };
});

const SPECTRAL: readonly ImagingModality[] = ['pw', 'cw', 'tdi'];

function run(modality: ImagingModality, seconds: number) {
  const core = new SimulatorCore(
    loadCaseById('normal-excellent-window'),
    baseInput({ modality, quality: 'low' }),
  );
  const render = vi.spyOn(core as unknown as { renderFrame: () => void }, 'renderFrame');
  let hud = 0;
  for (let t = 0; t < seconds; t += 0.02) {
    const out = core.step(0.02);
    if (out) {
      hud = out.simulatedFps;
      core.recycle(out.rgba);
    }
  }
  return { core, hud, frames: render.mock.calls.length };
}

describe('the 2D image shares the transmit time with a spectral strip (decision 212)', () => {
  // Each test steps the core for a few simulated seconds: 7-13 s on a quiet machine, 42 and 140 s under coverage on the CI
  // runner of PR #23 (the second past the 60 s default before its runs were cut from 2 s to 1 s)
  it(
    'in PW, CW and TDI the scanner shows and the core forms a quarter of the 2D frame rate',
    { timeout: 300_000 },
    () => {
      const plain = run('2d', 1);
      for (const modality of SPECTRAL) {
        const r = run(modality, 1);
        expect(r.hud, modality).toBeCloseTo(DUPLEX_BMODE_SHARE * plain.hud, 6);
        // one second of steps: at most the scanner's rate, plus the first frame
        expect(r.frames, modality).toBeLessThanOrEqual(Math.ceil(r.hud) + 1);
        expect(r.frames, modality).toBeGreaterThanOrEqual(Math.floor(r.hud) - 1);
      }
      expect(plain.frames).toBeGreaterThan(2 * run('pw', 1).frames);
    },
  );

  it('the spectrum does not depend on how often the 2D image forms', { timeout: 300_000 }, () => {
    for (const modality of SPECTRAL) {
      rate.fullDuplex = true;
      const full = run(modality, 1);
      rate.fullDuplex = false;
      const shared = run(modality, 1);
      expect(full.frames, modality).toBeGreaterThan(2 * shared.frames);
      const a = full.core.spectralStrip,
        b = shared.core.spectralStrip;
      expect(b.head, modality).toBe(a.head);
      expect(b.head, modality).toBeGreaterThan(100);
      expect(Array.from(b.data!), modality).toEqual(Array.from(a.data!));
      expect(Array.from(b.display!), modality).toEqual(Array.from(a.display!));
      expect(Array.from(b.phase), modality).toEqual(Array.from(a.phase));
    }
  });
});
