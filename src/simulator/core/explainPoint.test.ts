// @tier slow
/**
 * Where the echo at a point comes from (decision 340), on the frozen PLAX of the normal case: in the blood of a chamber
 * the brightness is the near-field clutter's, not the blood's; in the septum it is the myocardium's own; behind the
 * pleura the image is the pleura's reverberation; the costal cartilage the parasternal window crosses is the steepest loss
 * down the line. Each pass of the wedge keeps the scatterers, so a share is the source and not the speckle.
 */
import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { Structure } from '@/simulator/anatomy/tissue';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import { SimulatorCore } from './simulatorCore';
import { baseInput } from './baseInput';
import type { PointExplanation, SimOutput } from './protocol';
import { beamTowards } from './explainPoint';

/** The frozen frame of the normal case: the canonical PLAX, or the app's opening probe (its parasternal window crosses a rib). */
function frozenPlax(canonical = true): { core: SimulatorCore; out: SimOutput } {
  const input = baseInput();
  const core = new SimulatorCore(loadCaseById('normal-excellent-window'), input);
  if (canonical)
    input.probe = canonicalControl(getViewTarget('plax'), core.models.heart, core.models.thorax);
  core.setInput(input);
  for (let i = 0; i < 8; i++) core.step(0.05);
  core.setInput({ ...input, frozen: true });
  return { core, out: core.step(0)! };
}

/**
 * The middle of the first run of a structure (from the middle lines outwards, then down the line) past a depth fraction:
 * away from its interfaces, whose echo the PSF spreads a few millimetres.
 */
function pointOf(out: SimOutput, id: number, minFrac = 0): { rCm: number; thetaRad: number } {
  const p = out.polar;
  for (let k = 0; k < p.lines; k++) {
    const li = (p.lines >> 1) + (k % 2 ? (k + 1) >> 1 : -(k >> 1));
    for (let si = Math.floor(minFrac * p.samples); si < p.samples; si++) {
      if (out.structure[li * p.samples + si] !== id) continue;
      let end = si;
      while (end + 1 < p.samples && out.structure[li * p.samples + end + 1] === id) end++;
      const mid = (si + end) >> 1;
      return {
        rCm: ((mid + 0.5) / p.samples) * p.depthCm,
        thetaRad: ((li + 0.5) / p.lines - 0.5) * p.sectorRad,
      };
    }
  }
  throw new Error(`no structure ${id} in the frame`);
}

const explain = (core: SimulatorCore, q: { rCm: number; thetaRad: number }): PointExplanation => {
  const r = core.request({ kind: 'explainPoint', ...q });
  if (!r || r.kind !== 'explainPoint') throw new Error('no explanation');
  return r.explain;
};
const share = (e: PointExplanation, id: string): number =>
  e.sources.find((x) => x.id === id)?.share ?? 0;

describe('where the echo at a point comes from (decision 340)', () => {
  it('turns the beam in its own plane', () => {
    const b = {
      origin: { x: 0, y: 0, z: 0 },
      forward: { x: 0, y: 0, z: 1 },
      lateral: { x: 1, y: 0, z: 0 },
      normal: { x: 0, y: 1, z: 0 },
      contact: 1,
    };
    const t = beamTowards(b, Math.PI / 2);
    expect(t.forward.x).toBeCloseTo(1, 9);
    expect(t.lateral.z).toBeCloseTo(-1, 9);
    expect(t.normal).toEqual(b.normal);
  });

  it('reads blood, myocardium and lung in the canonical PLAX', () => {
    const { core, out } = frozenPlax();
    try {
      const blood = explain(core, pointOf(out, Structure.LaCavity));
      expect(blood.structure).toBe(Structure.LaCavity);
      // the chamber's brightness is the clutter's: without it most of the energy goes, more than the blood's own
      expect(share(blood, 'clutter')).toBeGreaterThan(0.5);
      expect(share(blood, 'clutter')).toBeGreaterThan(blood.ownShare);
      expect(blood.behindPleura).toBe(false);

      const septum = explain(core, pointOf(out, Structure.LvWallSeptal));
      expect(septum.ownShare).toBeGreaterThan(0.8);
      expect(share(septum, 'clutter')).toBeLessThan(0.1);

      const lung = explain(core, pointOf(out, Structure.Lung, 0.3));
      expect(lung.behindPleura).toBe(true);
    } finally {
      core.dispose();
    }
  });

  it('names the rib the opening parasternal window crosses as the steepest loss under it', () => {
    const { core, out } = frozenPlax(false);
    try {
      // under a rib of the frame, 2 cm past it on the same line, the rib is the steepest loss down the line
      const p = out.polar;
      let under: { rCm: number; thetaRad: number } | null = null;
      for (let li = 0; li < p.lines && !under; li++)
        for (let si = 0; si < p.samples; si++)
          if (out.structure[li * p.samples + si] === Structure.Rib) {
            let end = si;
            while (end + 1 < p.samples && out.structure[li * p.samples + end + 1] === Structure.Rib)
              end++;
            under = {
              rCm: ((end + 0.5) / p.samples) * p.depthCm + 2,
              thetaRad: ((li + 0.5) / p.lines - 0.5) * p.sectorRad,
            };
            break;
          }
      expect(under, 'a line of the PLAX crosses a rib').not.toBeNull();
      const shadowed = explain(core, under!);
      expect(shadowed.shadow?.structure).toBe(Structure.Rib);
      expect(shadowed.shadow!.atCm).toBeLessThan(under!.rCm - 1.5);
      expect(shadowed.shadow!.dropDb).toBeGreaterThan(3);
    } finally {
      core.dispose();
    }
  });
});
