// @tier slow
import { describe, expect, it } from 'vitest';
import { CASE_INPUTS, loadCaseById } from '@/cases';
import { buildCaseModels, REST_PATIENT } from '@/simulator/anatomy/caseModels';
import { canonicalControl, getViewTarget } from './viewTargets';
import { windowFromSkin } from '@/simulator/view-recognition/viewQuality';
import { SimulatorCore } from '@/simulator/core/simulatorCore';
import { baseInput } from '@/simulator/core/baseInput';
import { Structure } from '@/simulator/anatomy/tissue';

describe('suprasternal acquisition', () => {
  it('stays within the notch and attainable controls in every case, without intercostal snapping', () => {
    for (const { id } of CASE_INPUTS) {
      const { heart, thorax } = buildCaseModels(loadCaseById(id), REST_PATIENT);
      const p = canonicalControl(getViewTarget('suprasternal-arch'), heart, thorax);
      expect(Math.abs(p.u), id).toBeLessThanOrEqual(1.5);
      expect(p.v, id).toBeGreaterThanOrEqual(10);
      expect(p.v, id).toBeLessThanOrEqual(11);
      expect(Math.abs(p.tiltDeg), id).toBeLessThanOrEqual(70);
      expect(Math.abs(p.rockDeg), id).toBeLessThanOrEqual(60);
      expect(windowFromSkin(p.u, p.v)).toBe('suprasternal');
    }
    expect(windowFromSkin(8, 10)).toBe('none');
    expect(windowFromSkin(0, 8.5)).toBe('none');
  });
  for (const position of ['left-lateral', 'supine'] as const)
    it(`the real core samples arch and descending aorta in ${position}; a lateral move loses that acquisition`, () => {
      const c = loadCaseById('normal-excellent-window'),
        { heart, thorax } = buildCaseModels(c, { ...REST_PATIENT, position });
      const probe = canonicalControl(getViewTarget('suprasternal-arch'), heart, thorax);
      const input = baseInput({ probe, quality: 'medium', patient: { ...REST_PATIENT, position } });
      const core = new SimulatorCore(c, input);
      const first = core.step(0)!;
      const counts = () => {
        const ids = core.lastFrame!.structure;
        return {
          arch: ids.filter((s) => s === Structure.AorticArch).length,
          descending: ids.filter((s) => s === Structure.DescendingAorta).length,
        };
      };
      const ideal = counts();
      expect(ideal.arch).toBeGreaterThan(500);
      expect(ideal.descending).toBeGreaterThan(60);
      expect(first.view!.window).toBe('suprasternal');
      if (position === 'left-lateral') expect(first.view!.heartCoverage).toBeGreaterThan(0.1);
      expect(first.view!.shadowFraction).toBeLessThan(0.1);
      expect(first.view!.components.geometry).toBeGreaterThan(0.95);
      core.recycle(first.rgba);
      const sizes = [];
      for (const offset of [0.2, 0.4, 0.8, 1, 2, 4, 6]) {
        core.setInput({ ...input, probe: { ...probe, u: probe.u + offset } });
        const out = core.step(0.1)!;
        sizes.push(counts().arch);
        core.recycle(out.rgba);
      }
      expect(new Set(sizes).size).toBeGreaterThan(2);
      expect(sizes.at(-1)).toBeLessThan(ideal.arch * 0.1);
    });
});
