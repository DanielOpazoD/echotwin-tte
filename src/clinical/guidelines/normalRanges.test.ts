import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { computeGroundTruth } from '@/simulator/hemodynamics/groundTruth';
import { MEASUREMENT_SPECS } from '@/simulator/measurements/protocol';
import { expectedFindings } from '@/education/impression';
import { NORMAL_RANGES, rangeFlag, rangeText } from './normalRanges';
import { GUIDELINE_REFERENCES } from './references';

/**
 * Reference ranges by sex (decision 175): the report prints the range of the patient's sex beside each measurement and
 * the impression reads the same limits. The panel asked that an EDV index of 65 mL/m² mark a woman's ventricle as
 * dilated (61 is her upper limit, 74 a man's) and that an E/A above 2 alone not mark diastolic dysfunction.
 */
describe('normal ranges by sex (decision 175)', () => {
  it('belong to measurements of the protocol, with registered references and ordered bounds', () => {
    const ids = new Set(MEASUREMENT_SPECS.map((m) => m.id));
    const refs = new Set(GUIDELINE_REFERENCES.map((r) => r.id));
    for (const [id, bySex] of Object.entries(NORMAL_RANGES)) {
      expect(ids.has(id), id).toBe(true);
      for (const r of Object.values(bySex)) {
        expect(refs.has(r.referenceId), `${id}: ${r.referenceId}`).toBe(true);
        expect(r.low !== undefined || r.high !== undefined, id).toBe(true);
        if (r.low !== undefined && r.high !== undefined) expect(r.low).toBeLessThan(r.high);
      }
    }
  });

  it('flag a value against the range of the patient’s sex', () => {
    expect(rangeFlag('lv-edd', 'female', 5.5)).toBe('high');
    expect(rangeFlag('lv-edd', 'male', 5.5)).toBe('normal');
    expect(rangeFlag('tapse', 'male', 1.5)).toBe('low');
    expect(rangeFlag('lvot-diameter', 'male', 2)).toBeNull();
    expect(rangeText('lv-edd', 'female')).toBe('3,8–5,2');
    expect(rangeText('rv-basal', 'male')).toBe('≤ 4,1');
    expect(rangeText('tapse', 'female')).toBe('≥ 1,7');
  });

  it('dilate a woman’s ventricle at an EDV index a man’s keeps normal', () => {
    const t = computeGroundTruth(loadCaseById('normal-excellent-window'));
    const edv = 65 * t.bsaM2;
    const woman = { ...t, sex: 'female' as const, lv: { ...t.lv, edvMl: edv, eddCm: 4.8 } };
    const man = { ...woman, sex: 'male' as const };
    expect(expectedFindings(woman)).toContain('lv-dilated');
    expect(expectedFindings(man)).not.toContain('lv-dilated');
  });

  it('read an E/A above 2 as dysfunction only with another sign of raised filling pressure', () => {
    const t = computeGroundTruth(loadCaseById('normal-excellent-window'));
    const young = { ...t, mitral: { ...t.mitral, eOverA: 2.3 } };
    expect(expectedFindings(young)).not.toContain('diastolic-dysfunction');
    const withLa = { ...young, la: { ...young.la, volumeIndexMlM2: 40 } };
    expect(expectedFindings(withLa)).toContain('diastolic-dysfunction');
  });
});
