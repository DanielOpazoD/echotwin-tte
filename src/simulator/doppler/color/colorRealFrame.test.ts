// @tier slow
import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { buildCaseModels, REST_PATIENT } from '@/simulator/anatomy/caseModels';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import { SimulatorCore } from '@/simulator/core/simulatorCore';
import { baseInput } from '@/simulator/core/baseInput';
import { Structure } from '@/simulator/anatomy/tissue';
import { DEFAULT_COLOR } from './colorDoppler';

/**
 * The colour of a real frame of the simulator, over a beat of the normal case (decision 304). The Kasai estimate of
 * decision 300 was tested on a uniform field at the transmission soft tissue leaves; on the core's frames it painted the
 * slow blood of the LV cavity with confetti — weak, incoherent samples of high variance — in 16.9 % of the coloured
 * cavity of the long axis and 9.1 % of the four-chamber view, where the estimate before it painted none.
 */
describe('colour Doppler on the simulator frames', () => {
  for (const view of ['plax', 'a4c'] as const)
    it(`${view}: the LV cavity carries flow, not confetti`, () => {
      const c = loadCaseById('normal-excellent-window');
      const { heart, thorax } = buildCaseModels(c, REST_PATIENT);
      const probe = canonicalControl(getViewTarget(view), heart, thorax);
      const core = new SimulatorCore(c, baseInput({ probe, quality: 'medium', modality: 'color' }));
      const rr = 60 / c.rhythm.heartRateBpm;
      let cavity = 0,
        coloured = 0,
        confetti = 0;
      for (let k = 0; k < 60; k++) {
        const out = core.step(k === 0 ? 0 : rr / 30);
        if (!out) continue;
        const f = core.lastColorField.field;
        const ids = core.lastFrame!.structure;
        if (f)
          for (let i = 0; i < ids.length; i++) {
            if (ids[i] !== Structure.LvCavity) continue;
            cavity++;
            const v = f.vel[i]!;
            if (Number.isNaN(v)) continue;
            coloured++;
            if (f.variance[i]! > 0.4 && Math.abs(v) < 0.4 * DEFAULT_COLOR.scaleMps) confetti++;
          }
        core.recycle(out.rgba);
      }
      const report = `coloured ${((coloured / cavity) * 100).toFixed(1)} % of the cavity, confetti ${((confetti / coloured) * 100).toFixed(1)} % of the colour`;
      expect(coloured / cavity, report).toBeGreaterThan(0.1);
      expect(confetti / coloured, report).toBeLessThan(0.06);
    });
});
