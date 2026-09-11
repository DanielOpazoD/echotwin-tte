import { describe, expect, it } from 'vitest';
import { SimulatorCore } from './simulatorCore';
import { loadCaseById } from '@/cases';
import type { SimInput } from './protocol';
import { DEFAULT_ACQUISITION } from '@/simulator/renderer/types';
import { DEFAULT_COLOR } from '@/simulator/doppler/color/colorDoppler';
import { DEFAULT_SPECTRAL } from '@/simulator/doppler/spectral/spectrum';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';

export function baseInput(over: Partial<SimInput> = {}): SimInput {
  return {
    probe: { u: 3.4, v: 0.4, rotationDeg: 25, tiltDeg: 6, rockDeg: -4, pressure: 0.55 },
    patient: { position: 'left-lateral', respiration: 'expiration', headElevationDeg: 0 },
    settings: { ...DEFAULT_ACQUISITION, tgcDb: [...DEFAULT_ACQUISITION.tgcDb] },
    modality: '2d',
    frozen: false,
    cineOffset: 0,
    color: { ...DEFAULT_COLOR },
    spectral: { ...DEFAULT_SPECTRAL },
    cursorThetaRad: 0,
    gateDepthCm: 9,
    quality: 'low',
    display: { width: 320, height: 260 },
    rendererBackend: 'procedural',
    artifactOverrides: null,
    ...over,
  };
}

describe('SimulatorCore smoke', () => {
  it('produces frames in 2D, colour, PW, CW and M-mode without throwing', { timeout: 30_000 }, () => {
    const c = loadCaseById('normal-excellent-window');
    const core = new SimulatorCore(c, baseInput());
    let frames = 0;
    for (let i = 0; i < 6; i++) if (core.step(1 / 30)) frames++;
    expect(frames).toBeGreaterThan(0);
    for (const modality of ['color', 'pw', 'cw', 'm-mode', 'tdi'] as const) {
      core.setInput(baseInput({ modality, rendererBackend: 'atlas' }));
      let got = 0;
      for (let i = 0; i < 8; i++) if (core.step(1 / 30)) got++;
      expect(got).toBeGreaterThan(0);
    }
    core.setInput(baseInput({ frozen: true, cineOffset: -2 }));
    const fz = core.step(1 / 30);
    expect(fz?.frozen).toBe(true);
    expect(fz?.cineLength).toBeGreaterThan(2);
  });
  it('canonical PLAX pose yields a PLAX analysis through the core', { timeout: 30_000 }, () => {
    const c = loadCaseById('normal-excellent-window');
    const core = new SimulatorCore(c, baseInput());
    const { heart, thorax } = core.models;
    core.setInput(baseInput({ probe: canonicalControl(getViewTarget('plax'), heart, thorax) }));
    for (let i = 0; i < 8; i++) core.step(1 / 30);
    expect(core.lastView?.bestViewId).toBe('plax');
    expect(core.lastView?.score ?? 0).toBeGreaterThan(60);
  });
});
