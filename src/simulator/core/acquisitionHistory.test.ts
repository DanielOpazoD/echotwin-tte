// @tier slow
import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { SimulatorCore } from './simulatorCore';
import { baseInput } from './baseInput';

describe('acquisition history through the headless core', () => {
  it('returns the identity, time and beat of the selected cine frame', () => {
    const input = baseInput();
    const core = new SimulatorCore(loadCaseById('normal-excellent-window'), input);
    try {
      const first = core.step(0)!;
      for (let i = 0; i < 12; i++) {
        const out = core.step(0.1);
        if (out) core.recycle(out.rgba);
      }
      core.setInput({ ...input, frozen: true, cineOffset: -999 });
      const old = core.step(0)!;
      expect(old.frameId).toBe(first.frameId);
      expect(old.timeS).toBe(first.timeS);
      expect(old.beatIndex).toBe(first.beatIndex);
      expect(old.rrS).toBe(first.rrS);
      expect(old.cineWindow.frameS).toBe(old.timeS);
      expect(old.structure).toEqual(first.structure);
    } finally {
      core.dispose();
    }
  });

  it('keeps frozen sweep calibration, then starts a fresh strip on resume', () => {
    const input = baseInput({ modality: 'pw' });
    const core = new SimulatorCore(loadCaseById('normal-excellent-window'), input);
    try {
      for (let i = 0; i < 5; i++) core.step(0.1);
      const before = core.lastStripInfo!;
      const head = core.spectralStrip.head;
      const changed = { ...input, spectral: { ...input.spectral, sweepSpeedMmPerS: 100 } };
      core.setInput({ ...changed, frozen: true });
      const frozen = core.step(0)!;
      expect(frozen.strip.secondsPerColumn).toBe(before.secondsPerColumn);
      core.setInput(changed);
      const resumed = core.step(0.02)!;
      expect(core.spectralStrip.head).toBeLessThan(head);
      expect(resumed.strip.secondsPerColumn).toBeCloseTo(before.secondsPerColumn / 2, 10);
    } finally {
      core.dispose();
    }
  });

  it('enforces depth constraints for clients that bypass the UI', () => {
    const input = baseInput({ modality: 'pw', gateDepthCm: 20 });
    input.settings.depthCm = 20;
    input.spectral.scaleMps = 5;
    const core = new SimulatorCore(loadCaseById('normal-excellent-window'), input);
    try {
      const out = core.step(0.02)!;
      expect(out.spectralRange.vMax).toBeLessThan(0.6);
      core.setInput({ ...input, modality: 'cw' });
      expect(core.step(0.02)!.spectralRange.vMax).toBe(5);
    } finally {
      core.dispose();
    }
  });
});
