// @tier fast
import { describe, expect, it } from 'vitest';
import { CASE_INPUTS, loadCaseById } from '@/cases';
import { buildCaseModels, REST_PATIENT } from '@/simulator/anatomy/caseModels';
import { cycleStateAt } from './cycleModel';
import { measureFlowPeaks } from './flowPeaks';
import { buildFlowParams } from '@/simulator/doppler/flow-primitives/flowField';

describe('explicit beat extrema snapshot', () => {
  it('preserves every cycle state exactly across all cases and their sampled phases', () => {
    for (const { id } of CASE_INPUTS) {
      const { tables } = buildCaseModels(loadCaseById(id), REST_PATIENT);
      const peaks = measureFlowPeaks(tables);
      for (let i = 0; i < tables.n; i++) {
        const phase = (i + 0.5) / tables.n;
        expect(cycleStateAt(tables, phase, peaks), `${id} ${phase}`).toEqual(
          cycleStateAt(tables, phase),
        );
      }
    }
  });
  it('ordinary mutable-table callers observe edits, and a rebuilt flow gets a fresh snapshot', () => {
    const c = loadCaseById('normal-excellent-window');
    const { heart, thorax, tables } = buildCaseModels(c, REST_PATIENT);
    const before = buildFlowParams(c, heart, tables, thorax);
    const phase = (tables.timings.mitralOpenS + tables.timings.eAccelS) / tables.rrS;
    const opening = cycleStateAt(tables, phase).mvOpen;
    tables.mitralFlowMlps[0] = before.flowPeaks.mitral * 10;
    expect(cycleStateAt(tables, phase).mvOpen).toBeLessThan(opening * 0.9);
    const after = buildFlowParams(c, heart, tables, thorax);
    expect(after.flowPeaks.mitral).toBeGreaterThan(before.flowPeaks.mitral * 9);
    expect(cycleStateAt(tables, phase, after.flowPeaks)).toEqual(cycleStateAt(tables, phase));
  });
});
