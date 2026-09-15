import { describe, expect, it } from 'vitest';
import { expectedFindings, FINDINGS, getFinding, scoreImpression } from './impression';
import { loadCaseById } from '@/cases';
import { computeGroundTruth } from '@/simulator/hemodynamics/groundTruth';

describe('structured impression', () => {
  it('derives the expected findings of each case from its truth', () => {
    const f = (id: string) => expectedFindings(computeGroundTruth(loadCaseById(id)));
    expect(f('normal-excellent-window')).toEqual(
      expect.arrayContaining(['normal-study', 'ef-normal', 'as-none', 'mr-none']),
    );
    expect(f('hfref-severe-mr')).toEqual(
      expect.arrayContaining([
        'ef-severe',
        'lv-dilated',
        'mr-moderate',
        'la-dilated',
        'diastolic-dysfunction',
      ]),
    );
    expect(f('hfref-severe-mr')).not.toContain('normal-study');
    expect(f('inferior-rwma')).toContain('rwma');
    expect(f('aortic-stenosis-moderate')).toContain('as-moderate');
    expect(f('aortic-stenosis-severe')).toContain('as-severe');
    expect(f('hocm-sam')).toEqual(
      expect.arrayContaining(['asymmetric-septal-hypertrophy', 'lvot-obstruction']),
    );
    expect(f('mvp-primary-mr')).toContain('mr-severe');
    expect(f('pulmonary-hypertension-rv')).toEqual(
      expect.arrayContaining(['rv-dilated', 'rv-dysfunction', 'ph-probable', 'tr-significant']),
    );
    expect(f('pericardial-effusion-tamponade')).toEqual(
      expect.arrayContaining(['effusion', 'tamponade']),
    );
    expect(f('af-diastolic')).toEqual(
      expect.arrayContaining(['af', 'la-dilated', 'diastolic-dysfunction']),
    );
    expect(f('artifact-challenge')).toContain('as-mild');
  });
  it('every expected finding id exists in the catalogue and exclusive groups never co-occur', () => {
    for (const id of [
      'normal-excellent-window',
      'hfref-severe-mr',
      'hocm-sam',
      'pulmonary-hypertension-rv',
    ]) {
      const exp = expectedFindings(computeGroundTruth(loadCaseById(id)));
      const groups = new Map<string, number>();
      for (const e of exp) {
        const fd = getFinding(e);
        expect(fd, e).toBeDefined();
        if (fd!.exclusive) groups.set(fd!.exclusive, (groups.get(fd!.exclusive) ?? 0) + 1);
      }
      for (const [, n] of groups) expect(n).toBe(1);
    }
    expect(new Set(FINDINGS.map((f) => f.id)).size).toBe(FINDINGS.length);
  });
  it('scores selections by F1 with explicit correct/missed/wrong lists', () => {
    const exp = ['ef-severe', 'lv-dilated', 'mr-moderate'];
    expect(scoreImpression(exp, exp).score).toBe(100);
    const partial = scoreImpression(['ef-severe', 'as-severe'], exp);
    expect(partial.correct).toEqual(['ef-severe']);
    expect(partial.wrong).toEqual(['as-severe']);
    expect(partial.missed).toEqual(['lv-dilated', 'mr-moderate']);
    expect(partial.score).toBe(40); // P 0.5, R 0.33 → F1 0.4
    expect(scoreImpression([], exp).score).toBe(0);
  });
});
