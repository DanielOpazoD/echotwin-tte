import { describe, expect, it } from 'vitest';
import { SimulatorCore } from './simulatorCore';
import { loadCaseById } from '@/cases';
import { baseInput } from './baseInput';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';

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
