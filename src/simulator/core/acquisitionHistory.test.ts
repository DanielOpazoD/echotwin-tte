// @tier slow
import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { SimulatorCore } from './simulatorCore';
import { baseInput } from './baseInput';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import { summarizeEnvelope } from '@/simulator/measurements/vti';

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

describe('stored strip calibration', () => {
  it('preserves velocities, VTI, gradient and pixels when frozen controls change', () => {
    const input = baseInput({ modality: 'cw' });
    const core = new SimulatorCore(loadCaseById('normal-excellent-window'), input);
    try {
      input.probe = canonicalControl(getViewTarget('a5c'), core.models.heart, core.models.thorax);
      core.setInput(input);
      for (let i = 0; i < 30; i++) core.step(0.04);
      core.setInput({ ...input, frozen: true });
      const before = core.step(0)!;
      const trace = core.request({ kind: 'autoTrace', x0: 0, x1: 299 });
      if (trace?.kind !== 'autoTrace') throw new Error('missing spectral acquisition');
      const summary = summarizeEnvelope(trace.velocitiesMps, trace.secondsPerColumn);
      expect(summary.vmaxMps).toBeGreaterThan(0.3); // not an empty-strip invariant
      core.setInput({
        ...input,
        frozen: true,
        spectral: {
          ...input.spectral,
          scaleMps: 3,
          baselineShiftMps: 1,
          wallFilterMps: 0.6,
          gainDb: 20,
          invert: true,
          sweepSpeedMmPerS: 100,
        },
      });
      const after = core.step(0)!;
      const newTrace = core.request({ kind: 'autoTrace', x0: 0, x1: 299 });
      expect(after.spectralRange).toEqual(before.spectralRange);
      expect(after.strip).toEqual(before.strip);
      expect(newTrace).toEqual(trace);
      // Display changes cannot create new samples or change the measured envelope.
      core.setInput({ ...input, frozen: true, display: { width: 640, height: 260 } });
      const resized = core.step(0)!;
      const resizedTrace = core.request({ kind: 'autoTrace', x0: 0, x1: 599 });
      if (resizedTrace?.kind !== 'autoTrace') throw new Error('missing resized trace');
      expect(resizedTrace.velocitiesMps).toEqual(trace.velocitiesMps);
      expect(summarizeEnvelope(resizedTrace.velocitiesMps, resizedTrace.secondsPerColumn)).toEqual(
        summary,
      );
      expect(resizedTrace.pixelsPerColumn).toBe(2);
      expect(resized.strip.secondsPerColumn).toBe(before.strip.secondsPerColumn / 2);
      expect(new Uint8Array(after.rgba)).toEqual(new Uint8Array(before.rgba));
    } finally {
      core.dispose();
    }
  });

  it.each(['m-mode', 'cmm'] as const)(
    'preserves %s and its full time span across a frozen viewport resize',
    (modality) => {
      const input = baseInput({ modality });
      const core = new SimulatorCore(loadCaseById('normal-excellent-window'), input);
      try {
        for (let i = 0; i < 5; i++) core.step(0.1);
        core.setInput({ ...input, frozen: true });
        const before = core.step(0)!;
        expect(before.strip.kind).toBe('m-mode');
        core.setInput({
          ...input,
          frozen: true,
          color: { ...input.color, invert: true, scaleMps: 0.1 },
          display: { width: 640, height: 260 },
        });
        const after = core.step(0)!;
        expect(after.strip.kind).toBe('m-mode');
        expect(after.strip.secondsPerColumn * after.strip.columns).toBeCloseTo(
          before.strip.secondsPerColumn * before.strip.columns,
          10,
        );
        expect(after.strip.headColumn).toBe(before.strip.headColumn * 2);
        expect(after.strip.bottomValue).toBe(before.strip.bottomValue);
        const a = new Uint8Array(before.rgba),
          b = new Uint8Array(after.rgba);
        for (let y = before.strip.y; y < before.strip.y + before.strip.height; y++)
          for (let x = 0; x < before.width; x++) {
            if (x === before.strip.headColumn) continue;
            expect(b[(y * after.width + x * 2) * 4]).toBe(a[(y * before.width + x) * 4]);
          }
      } finally {
        core.dispose();
      }
    },
  );
});
