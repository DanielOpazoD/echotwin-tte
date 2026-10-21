// @tier slow
/**
 * What the calibrated apical image shows just outside the left atrium, against CAMUS Good (decision 333). Where the beam
 * crosses the atrial roof the band holds the atrial wall, the pericardium and the mediastinum behind it; the
 * pericardium's interface echo there faces fat, not lung, and read as a white line whose spread lifted the band 0.4–0.9
 * myocardial medians over CAMUS. The side borders, which run along the beam, are the control: they stay inside CAMUS.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { atrialSurroundings, type AtrialSurroundings } from '@/clinical/atrialSurroundings';
import { CAMUS_GOOD_ATRIAL_SURROUNDINGS } from '@/clinical/reference-values/camusAtrialSurroundings';
import { presentApical, renderApical } from './clinicalImage';

/** The cases whose atrial roof lies inside the sector in both apical views. */
const CASES = ['normal-excellent-window', 'pulmonary-hypertension-rv'] as const;
const VIEWS = [
  ['a4c', '4CH'],
  ['a2c', '2CH'],
] as const;

/**
 * How far over the CAMUS 75th percentile the roof band still reads, per case, view, phase and band (myocardial medians).
 * What is left after decision 333 is the pericardium's own backscatter seen across the beam (0.85, four times the
 * myocardium's), which in the two-chamber view sits 3–4 mm behind the roof: lowering it takes the pericardial line beside
 * the LV, along the beam, under CAMUS (lateral peak 121 → 100 at 0.3 in the four-chamber view at end-diastole).
 */
const KNOWN_LA_ROOF_EXCESS: Record<string, number> = {
  'normal-excellent-window a4c ES roofWall': 0.15,
  // decision 366: the volume fit pays the lateral wall with 3–4 % of the body's scale, and the roof sits lower in the band
  'normal-excellent-window a4c ES roofBeyond': 0.19,
  'normal-excellent-window a2c ES roofWall': 0.3,
  // 0.15 until decision 335, whose atrium meets its septal face beside the root
  'normal-excellent-window a2c ES roofBeyond': 0.29,
  'pulmonary-hypertension-rv a4c ES roofWall': 0.14,
  'pulmonary-hypertension-rv a2c ES roofWall': 0.41,
  'pulmonary-hypertension-rv a2c ES roofBeyond': 0.15,
};

/**
 * Side walls under the CAMUS 10th percentile, with the figure: since decision 366 the lateral wall of the left atrium stands
 * on the lateral hinge, running along the beam from the shelf over the groove, and in the pulmonary hypertension's
 * four-chamber view at end-diastole it reads 1.07 myocardial medians against a 10th percentile of 1.16 (a wall along the beam
 * returns little; before the decision the beam crossed the wedge of the flared base obliquely).
 */
const KNOWN_LA_SIDE_WALL_LOW: Record<string, number> = {
  'pulmonary-hypertension-rv a4c ED': 1.07,
};

const TOLERANCE = 0.05;
const STALE = 0.1;

describe('outside the left atrium, against CAMUS Good', () => {
  const measured: { key: string; v: AtrialSurroundings; ref: string }[] = [];
  beforeAll(() => {
    for (const id of CASES)
      for (const [view, ch] of VIEWS)
        for (const ed of [true, false])
          measured.push({
            key: `${id} ${view} ${ed ? 'ED' : 'ES'}`,
            v: atrialSurroundings(presentApical(renderApical(id, view, ed))),
            ref: `${ch}-${ed ? 'ED' : 'ES'}`,
          });
  });
  const ref = (m: (typeof measured)[number]) =>
    CAMUS_GOOD_ATRIAL_SURROUNDINGS[m.ref as keyof typeof CAMUS_GOOD_ATRIAL_SURROUNDINGS];

  it('keeps the roof band within CAMUS, or within the excess it declares', () => {
    const over: string[] = [];
    const stale: string[] = [];
    const seen = new Set<string>();
    for (const m of measured)
      for (const band of ['roofWall', 'roofBeyond'] as const) {
        const v = m.v[band];
        expect(Number.isFinite(v), `${m.key} ${band}: the roof is in the sector`).toBe(true);
        const key = `${m.key} ${band}`;
        const excess = v - ref(m)[band].p75;
        const declared = KNOWN_LA_ROOF_EXCESS[key];
        if (declared !== undefined) seen.add(key);
        if (excess > (declared ?? 0) + TOLERANCE)
          over.push(
            `${key}: ${v.toFixed(2)}, ${excess.toFixed(2)} over CAMUS p75 (declared ${declared ?? 0})`,
          );
        if (declared !== undefined && excess < declared - STALE)
          stale.push(`${key}: declared ${declared}, now ${excess.toFixed(2)}`);
      }
    expect(over).toEqual([]);
    expect(stale, 'shrink or drop these entries of KNOWN_LA_ROOF_EXCESS').toEqual([]);
    expect(
      Object.keys(KNOWN_LA_ROOF_EXCESS).filter((k) => !seen.has(k)),
      'entries of KNOWN_LA_ROOF_EXCESS for no measured band',
    ).toEqual([]);
  });

  it('keeps the side walls, which run along the beam, inside the CAMUS 10th–90th percentiles', () => {
    for (const m of measured) {
      const q = ref(m).sideWall;
      const declared = KNOWN_LA_SIDE_WALL_LOW[m.key];
      if (declared !== undefined) {
        // declared under the 10th percentile: not lower, and stale once back inside
        expect(m.v.sideWall, `${m.key} sideWall, declared ${declared}`).toBeGreaterThanOrEqual(
          declared - TOLERANCE,
        );
        expect(m.v.sideWall, `${m.key} sideWall is back inside: drop the entry`).toBeLessThan(
          q.p10,
        );
        continue;
      }
      expect(m.v.sideWall, `${m.key} sideWall`).toBeGreaterThanOrEqual(q.p10);
      expect(m.v.sideWall, `${m.key} sideWall`).toBeLessThanOrEqual(q.p90);
    }
    expect(
      Object.keys(KNOWN_LA_SIDE_WALL_LOW).filter((k) => !measured.some((m) => m.key === k)),
      'entries of KNOWN_LA_SIDE_WALL_LOW for no measured view',
    ).toEqual([]);
  });
});
