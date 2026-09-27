// @tier slow
import { describe, expect, it } from 'vitest';
import type { SimOutput } from '@/simulator/core/protocol';
import { loadCaseById } from '@/cases';
import { SimulatorCore } from '@/simulator/core/simulatorCore';
import { baseInput } from '@/simulator/core/baseInput';
import { ecgSample } from '@/simulator/cardiac-cycle/ecg';
import { ecgLayoutOf, ecgPoint } from './ecgTrace';

/**
 * With a Doppler or M-mode strip on screen the ECG is written on the strip's own sweep (decision 231). It used to scroll
 * 3 s over the strip's 2 s sweep, so a wave sat over columns written half a second away: the E wave of a mitral inflow
 * showed 80 ms before the R that precedes it by 480 ms. Through the core: every R drawn on the strip falls over the column
 * the strip wrote at the R's phase, with the sweep head at a tenth, half and nine tenths of the width.
 */
describe('the ECG is written on the strip it lies on (decision 231)', () => {
  for (const mode of ['pw', 'm-mode'] as const)
    it(
      `${mode}: every R falls over the column written at its instant, wherever the sweep head stands`,
      { timeout: 240_000 },
      () => {
        const c = loadCaseById('normal-excellent-window');
        const core = new SimulatorCore(c, baseInput({ modality: mode, quality: 'low' }));
        const rr = core.models.tables.rrS;
        // the phase of the R: the peak of the ECG within its beat, which starts at the QRS onset (phase 0)
        let tR = 0;
        for (let tb = 0; tb < 0.15; tb += 0.0005)
          if (ecgSample(tb, rr, c.rhythm) > ecgSample(tR, rr, c.rhythm)) tR = tb;
        const phaseR = tR / rr;
        const problems: string[] = [];
        let elapsed = 0,
          checked = 0;
        let out: SimOutput | null = null;
        for (const until of [2.2, 3.0, 3.8]) {
          while (elapsed < until) {
            out = core.step(0.02) ?? out;
            elapsed += 0.02;
          }
          const hud = out!;
          const l = ecgLayoutOf(hud, mode);
          const strip = mode === 'pw' ? core.spectralStrip : core.mmodeStrip!;
          const colW = l.width / strip.cols;
          const e = hud.ecg;
          for (let i = 2; i + 3 < e.length; i += 2) {
            const t = e[i]!,
              v = e[i + 1]!;
            // an R: a local maximum of the QRS, inside the last sweep and away from its ends
            if (v < 0.8 || v < e[i - 1]! || v < e[i + 3]!) continue;
            if (hud.ecgHead - t < 0.05 || hud.ecgHead - t > 2 - 0.05) continue;
            const xR = ecgPoint({ t, v }, l)?.x;
            if (xR === undefined) {
              problems.push(`${mode} at ${until} s: an R of the last sweep is not drawn`);
              continue;
            }
            let best = Infinity;
            for (let col = 0; col < strip.cols; col++) {
              const d = Math.abs(strip.phase[col]! - phaseR);
              if (Math.min(d, 1 - d) > 0.008) continue;
              best = Math.min(best, Math.abs(l.x0 + (col + 0.5) * colW - xR));
            }
            checked++;
            if (best > 2 * colW)
              problems.push(
                `${mode}, head at ${Math.round(((strip.head % strip.cols) / strip.cols) * 100)} %: R drawn ${best.toFixed(0)} px from the columns written at its phase`,
              );
          }
        }
        expect(checked).toBeGreaterThanOrEqual(4);
        expect(problems).toEqual([]);
      },
    );
});
