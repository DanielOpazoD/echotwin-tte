// @tier fast
import { describe, expect, it } from 'vitest';
import { SimulatorCore } from './simulatorCore';
import { loadCaseById } from '@/cases';
import { baseInput } from './baseInput';
import { Structure } from '@/simulator/anatomy/tissue';

/**
 * The review-mode request (decision 134) names, for a polar point of the displayed frame, the structure the
 * tracer formed that pixel from: it must agree with the frame's own structure map and return the heart-frame
 * coordinates the anatomy code reasons in.
 */
describe('probePoint request', () => {
  it('agrees with the structure map of the frame and returns heart coordinates inside the heart', () => {
    const core = new SimulatorCore(
      loadCaseById('normal-excellent-window'),
      baseInput({ quality: 'low' }),
    );
    const out = core.step(0.02)!;
    const { lines, samples, sectorRad, depthCm } = out.polar;
    // the first run of LV cavity along the central line, taken at its middle
    const li = Math.floor(lines / 2);
    let s0 = -1,
      s1 = -1;
    for (let si = 0; si < samples; si++) {
      const st = out.structure[li * samples + si];
      if (st === Structure.LvCavity) {
        if (s0 < 0) s0 = si;
        s1 = si;
      } else if (s0 >= 0) break;
    }
    expect(s0).toBeGreaterThan(0);
    const si = Math.floor((s0 + s1) / 2);
    const rCm = ((si + 0.5) / samples) * depthCm;
    const thetaRad = ((li + 0.5) / lines - 0.5) * sectorRad;
    const res = core.request({ kind: 'probePoint', rCm, thetaRad });
    expect(res?.kind).toBe('probePoint');
    if (!res || res.kind !== 'probePoint') throw new Error('no probePoint response');
    const p = res.point;
    expect(p.inHeart).toBe(true);
    expect(p.structure).toBe(Structure.LvCavity);
    expect(p.phase).toBe(out.phase);
    expect(Number.isFinite(p.heart.x) && Number.isFinite(p.heart.z)).toBe(true);
    expect(p.levelFrac).not.toBeNull();
    expect(p.levelFrac!).toBeGreaterThanOrEqual(0);
    expect(p.levelFrac!).toBeLessThanOrEqual(1);
    expect(p.sdfCm).toBeLessThan(0);
    // beyond the sector there is no heart: the thorax answers
    const far = core.request({ kind: 'probePoint', rCm: depthCm + 5, thetaRad: 0 });
    if (!far || far.kind !== 'probePoint') throw new Error('no probePoint response');
    expect(far.point.inHeart).toBe(false);
    expect(far.point.levelFrac).toBeNull();
  });
});
