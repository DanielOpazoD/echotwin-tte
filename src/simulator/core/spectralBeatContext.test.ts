// @tier slow
import { describe, expect, it, vi } from 'vitest';
import { loadCaseById } from '@/cases';
import { SimulatorCore } from './simulatorCore';
import { baseInput } from './baseInput';
import { CardiacClock } from '@/simulator/cardiac-cycle/clock';
import { StripEngine, type StripCtx } from './stripEngine';
import type { BeatTables } from '@/simulator/cardiac-cycle/cycleModel';
import type { BeamFrame } from '@/simulator/probe/pose';
import type { PolarFrameSpec } from '@/simulator/renderer/types';

// Observe the actual estimator boundary, preserving its implementation and acquired signal.
type Estimator = {
  sampleSpectralColumn: (
    beam: BeamFrame,
    spec: PolarFrameSpec,
    phase: number,
    index: number,
    timeS: number,
    ctx: StripCtx,
  ) => { column: Float32Array; display: Float32Array };
};
describe('spectral samples retain their beat across a worker step containing QRS', () => {
  it.each(['af-diastolic', 'normal-excellent-window'])(
    '%s uses the tables and phase of each sampled instant',
    (id) => {
      const c = loadCaseById(id),
        input = baseInput({
          modality: 'pw',
          quality: 'low',
          display: { width: 1024, height: 260 },
        });
      if (id === 'normal-excellent-window') input.patient.respiration = 'free-breathing';
      const core = new SimulatorCore(c, input),
        clock = new CardiacClock(c.rhythm, c.seed);
      const beats = [{ start: 0, rr: clock.current.rrS, index: 0, tables: core.models.tables }];
      const captured: { timeS: number; phase: number; tables: BeatTables }[] = [];
      const proto = StripEngine.prototype as unknown as Estimator;
      const original = proto.sampleSpectralColumn;
      const spy = vi.spyOn(proto, 'sampleSpectralColumn').mockImplementation(function (
        this: StripEngine,
        beam,
        spec,
        phase,
        index,
        timeS,
        ctx,
      ) {
        captured.push({ timeS, phase, tables: ctx.tables });
        return original.call(this, beam, spec, phase, index, timeS, ctx);
      });
      let retrospective = 0;
      try {
        for (let k = 0; k < 40; k++) {
          const clockState = clock.advance(0.05),
            first = captured.length;
          const out = core.step(0.05);
          if (out) core.recycle(out.rgba);
          if (clockState.beatIndex !== beats.at(-1)!.index)
            beats.push({
              start: clockState.timeS - clockState.timeInBeatS,
              rr: clockState.rrS,
              index: clockState.beatIndex,
              tables: core.models.tables,
            });
          for (const s of captured.slice(first)) {
            const beat = beats.findLast((b) => b.start <= s.timeS + 1e-10)!;
            expect(s.phase, `t=${s.timeS}`).toBeCloseTo((s.timeS - beat.start) / beat.rr, 10);
            expect(s.tables === beat.tables, `original tables at t=${s.timeS}`).toBe(true);
            if (beat.index !== clockState.beatIndex) retrospective++;
          }
        }
        expect(retrospective).toBeGreaterThan(5);
      } finally {
        spy.mockRestore();
        core.dispose();
      }
    },
  );
});
