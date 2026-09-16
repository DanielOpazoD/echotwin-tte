// @tier slow
import { describe, expect, it, vi } from 'vitest';
import { AtlasRenderer } from '@/simulator/renderer/atlas/atlasRenderer';
import { ProceduralSliceRenderer } from '@/simulator/renderer/procedural/sliceRenderer';
import type { SimOutput } from './protocol';
import { SimulatorCore } from './simulatorCore';
import { loadCaseById } from '@/cases';
import { baseInput } from './baseInput';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';

describe('SimulatorCore acquisition controls', () => {
  it('updates the focus metadata without reallocating pixels or mutating old acquisition specs', () => {
    const inp = baseInput();
    const core = new SimulatorCore(loadCaseById('normal-excellent-window'), inp);
    const first = core.step(0)!;
    const frame = core.lastFrame!;
    const oldSpec = frame.spec;
    core.recycle(first.rgba);
    core.setInput({ ...inp, settings: { ...inp.settings, focusCm: 4 } });
    const changed = core.step(0.1)!;
    expect(changed).not.toBeNull();
    expect(core.lastFrame).toBe(frame);
    expect(core.lastFrame!.spec.focusCm).toBe(4);
    expect(oldSpec.focusCm).toBe(9);
    core.recycle(changed.rgba);
  });

  it(
    'reacquires frequency changes through the real core after the atlas cine fills',
    { timeout: 120_000 },
    () => {
      const render = AtlasRenderer.prototype.render;
      const scheduling = vi.spyOn(AtlasRenderer.prototype, 'render').mockImplementation(function (
        this: AtlasRenderer,
        sc,
        beam,
        spec,
        phase,
        out,
        hints,
      ) {
        return render.call(this, sc, beam, spec, phase, out, {
          ...hints,
          stationary: true,
          budgetMs: 0,
        });
      });
      const source = vi.spyOn(ProceduralSliceRenderer.prototype, 'render');
      try {
        const inp = baseInput({ rendererBackend: 'atlas' });
        inp.settings.persistence = 0;
        const core = new SimulatorCore(loadCaseById('normal-excellent-window'), inp);
        inp.probe = canonicalControl(getViewTarget('plax'), core.models.heart, core.models.thorax);
        core.setInput(inp);
        let full: SimOutput | null = null;
        for (let i = 0; i < 160; i++) {
          const out = core.step(core.models.tables.rrS / 32);
          if (!out) continue;
          core.recycle(out.rgba);
          if (out.stats['cineFill'] === '32/32') {
            full = out;
            break;
          }
        }
        expect(
          full,
          'the actual core must exercise a full cache, not just the direct path',
        ).not.toBeNull();
        const cached = core.step(0.1)!;
        expect(cached.stats['served']).toBe('cache');
        core.recycle(cached.rgba);
        const before = source.mock.calls.length;
        core.setInput({ ...inp, settings: { ...inp.settings, frequencyMHz: 4 } });
        const changed = core.step(0.1)!;
        expect(changed.stats['served']).toBe('direct');
        expect(source.mock.calls.length).toBe(before + 1);
        expect(source.mock.lastCall![0].physics.frequencyMHz).toBe(4);
        core.recycle(changed.rgba);
      } finally {
        source.mockRestore();
        scheduling.mockRestore();
      }
    },
  );
});

describe('SimulatorCore smoke', () => {
  it(
    'produces frames in 2D, colour, PW, CW and M-mode without throwing',
    { timeout: 30_000 },
    () => {
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
    },
  );
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
