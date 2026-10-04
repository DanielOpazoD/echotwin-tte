// @tier slow
import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { SimulatorCore } from './simulatorCore';
import { baseInput } from './baseInput';

describe('right-heart balance across acquired beats', () => {
  it.each(['af-diastolic', 'pulmonary-hypertension-rv'])(
    '%s ejects the previous right filling minus quantified TR',
    (id) => {
      const c = loadCaseById(id),
        input = baseInput();
      if (id === 'pulmonary-hypertension-rv') input.patient.respiration = 'free-breathing';
      const core = new SimulatorCore(c, input);
      const nominalSv = c.physiology.edvMl - c.physiology.esvMl;
      let prior = core.models.tables,
        transitions = 0;
      try {
        for (let i = 0; i < 100 && transitions < 4; i++) {
          const out = core.step(0.1);
          if (out) core.recycle(out.rgba);
          const now = core.models.tables;
          if (now === prior) continue;
          // Integrate the actual prior waveforms rather than trusting its summary fields.
          const dt = prior.rrS / prior.n;
          const fill = prior.tricuspidFlowMlps.reduce((s, q) => s + q * dt, 0);
          const regurg = prior.trFlowMlps.reduce((s, q) => s + q * dt, 0);
          const expected = Math.min(1.2 * nominalSv, Math.max(0.2 * nominalSv, fill - regurg));
          const actual = now.pulmonaryFlowMlps.reduce((s, q) => s + (q * now.rrS) / now.n, 0);
          expect(Math.abs(actual - expected)).toBeLessThan(0.001);
          transitions++;
          prior = now;
        }
        expect(transitions).toBe(4);
      } finally {
        core.dispose();
      }
    },
  );
});
