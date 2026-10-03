// @tier slow
import { describe, expect, it } from 'vitest';
import { CASE_INPUTS, loadCaseById } from '@/cases';
import { SimulatorCore } from '@/simulator/core/simulatorCore';
import { baseInput } from '@/simulator/core/baseInput';
import { computeHeartPose } from '@/simulator/anatomy/heartModel';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';

/**
 * The right ventricle of tamponade collapses in early diastole (decision 269), when its pressure is lowest, after the
 * semilunar valves close and before it fills; the right atrium in late diastole and early systole. The ventricle's
 * window was fixed at 0.5 of the cycle, which the tamponade's stretched systole (ending at 0.57) put inside the
 * ejection: the free wall collapsed most (0.80) with the aortic valve open, and refilled as diastole began.
 */
describe('tamponade collapse follows the cycle (decision 269)', () => {
  it('the right ventricle collapses after the aortic valve closes and not while it ejects', () => {
    const problems: string[] = [];
    for (const { id } of CASE_INPUTS) {
      const { heart, tables } = new SimulatorCore(loadCaseById(id), baseInput()).models;
      let duringEjection = 0,
        afterClosure = 0;
      for (let i = 0; i < 100; i++) {
        const state = cycleStateAt(tables, i / 100);
        const collapse = computeHeartPose(heart, state).rvCollapse;
        if (state.avOpen >= 0.5) duringEjection = Math.max(duringEjection, collapse);
        else if (state.avOpen === 0 && state.contraction > 0.5)
          afterClosure = Math.max(afterClosure, collapse);
      }
      const severity = heart.anatomy.pericardium.tamponade;
      if (duringEjection > 0.05)
        problems.push(
          `${id}: ${duringEjection.toFixed(2)} of collapse while the aortic valve ejects`,
        );
      if (severity > 0 && afterClosure < 0.5 * severity)
        problems.push(
          `${id}: only ${afterClosure.toFixed(2)} after closure for a tamponade of ${severity}`,
        );
    }
    expect(problems).toEqual([]);
  });
});
