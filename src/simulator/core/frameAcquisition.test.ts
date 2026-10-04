// @tier slow
import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { SimulatorCore } from './simulatorCore';
import { baseInput } from './baseInput';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';

function setup(modality: 'pw' | 'color' | '2d') {
  const input = baseInput({ modality });
  const core = new SimulatorCore(loadCaseById('normal-excellent-window'), input);
  input.probe = canonicalControl(getViewTarget('a4c'), core.models.heart, core.models.thorax);
  core.setInput(input);
  return { core, input };
}

describe('one acquired frame owns its interpretation', () => {
  it('keeps anatomical review and gate bound to the frozen scene and beam', () => {
    const { core, input } = setup('pw');
    try {
      for (let i = 0; i < 12; i++) core.step(0.05);
      core.setInput({ ...input, frozen: true });
      const before = core.step(0)!;
      const point = core.request({ kind: 'probePoint', rCm: 8, thetaRad: 0 });
      core.setInput({
        ...input,
        frozen: true,
        probe: { ...input.probe, u: input.probe.u + 3 },
        patient: { ...input.patient, position: 'supine' },
        cursorThetaRad: 0.3,
        gateDepthCm: 4,
      });
      const after = core.step(0)!;
      expect(after.frameId).toBe(before.frameId);
      expect(after.gate).toEqual(before.gate);
      expect(core.request({ kind: 'probePoint', rCm: 8, thetaRad: 0 })).toEqual(point);
    } finally {
      core.dispose();
    }
  });
  it('keeps the colour pixels calibrated with the field that produced them', () => {
    const { core, input } = setup('color');
    input.color = {
      ...input.color,
      scaleMps: 0.6,
      gainDb: 15,
      persistence: 0,
      boxRMinCm: 1,
      boxRMaxCm: 18,
      boxThetaMinRad: -0.6,
      boxThetaMaxRad: 0.6,
    };
    core.setInput(input);
    try {
      for (let i = 0; i < 12; i++) core.step(0.05);
      core.setInput({ ...input, frozen: true });
      const before = core.step(0)!;
      const pixels = new Uint8Array(before.rgba);
      let colored = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i] !== pixels[i + 1]) colored++;
      expect(colored).toBeGreaterThan(20);
      core.setInput({
        ...input,
        frozen: true,
        color: { ...input.color, scaleMps: 0.2, showVariance: !input.color.showVariance },
      });
      const after = core.step(0)!;
      expect(new Uint8Array(after.rgba)).toEqual(pixels);
    } finally {
      core.dispose();
    }
  });
});

describe('frame and strip histories have distinct identities', () => {
  it('does not relabel a retained B-mode frame with a later strip update time', () => {
    const { core } = setup('pw');
    try {
      const first = core.step(0)!;
      const later = core.step(0.005)!;
      expect(later.frameId).toBe(first.frameId);
      expect(later.timeS).toBe(first.timeS);
      expect(later.phase).toBe(first.phase);
      expect(later.ecgHead).toBeGreaterThan(first.ecgHead);
    } finally {
      core.dispose();
    }
  });
  it('defers a frozen mode change and never substitutes another acquisition strip for old cine', () => {
    const { core, input } = setup('pw');
    try {
      for (let i = 0; i < 6; i++) core.step(0.05);
      core.setInput({ ...input, frozen: true });
      const before = core.step(0)!;
      expect(before.strip.kind).toBe('spectral');
      const pending = { ...input, modality: 'cw' as const, frozen: true };
      core.setInput(pending);
      const unchanged = core.step(0)!;
      expect(unchanged.acquisition?.modality).toBe('pw');
      expect(unchanged.strip).toEqual(before.strip);
      core.setInput({ ...pending, frozen: false });
      for (let i = 0; i < 6; i++) core.step(0.05);
      core.setInput({ ...pending, cineOffset: -999 });
      const historical = core.step(0)!;
      expect(historical.acquisition?.modality).toBe('pw');
      expect(historical.strip.kind).toBeNull();
      expect(core.request({ kind: 'autoTrace', x0: 0, x1: 100 })).toBeNull();
    } finally {
      core.dispose();
    }
  });
});
