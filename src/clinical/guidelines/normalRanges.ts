/**
 * Normal ranges of the protocol's measurements by sex (decision 175), for the report and the impression. Values from the
 * chamber quantification recommendations (`ase-eacvi-chamber-2015`: 2D linear LV dimensions, wall thickness, biplane
 * volumes, LA diameter, sinus of Valsalva, RV basal diameter) and the diastolic and right-heart ones
 * (`ase-diastolic-2025`, `ase-right-heart-2025`: e′, TR velocity, TAPSE, IVC). A bound left out is not a criterion.
 */
export type Sex = 'male' | 'female';

export interface NormalRange {
  low?: number;
  high?: number;
  referenceId: string;
}

const same = (r: NormalRange): Record<Sex, NormalRange> => ({ male: r, female: r });
const CHAMBER = 'ase-eacvi-chamber-2015';

export const NORMAL_RANGES: Readonly<Record<string, Record<Sex, NormalRange>>> = {
  'lv-edd': {
    male: { low: 4.2, high: 5.8, referenceId: CHAMBER },
    female: { low: 3.8, high: 5.2, referenceId: CHAMBER },
  },
  'lv-esd': {
    male: { low: 2.5, high: 4.0, referenceId: CHAMBER },
    female: { low: 2.2, high: 3.5, referenceId: CHAMBER },
  },
  ivsd: {
    male: { low: 0.6, high: 1.0, referenceId: CHAMBER },
    female: { low: 0.6, high: 0.9, referenceId: CHAMBER },
  },
  lvpwd: {
    male: { low: 0.6, high: 1.0, referenceId: CHAMBER },
    female: { low: 0.6, high: 0.9, referenceId: CHAMBER },
  },
  'la-ap': {
    male: { low: 3.0, high: 4.0, referenceId: CHAMBER },
    female: { low: 2.7, high: 3.8, referenceId: CHAMBER },
  },
  'lv-edv-simpson': {
    male: { low: 62, high: 150, referenceId: CHAMBER },
    female: { low: 46, high: 106, referenceId: CHAMBER },
  },
  'lv-esv-simpson': {
    male: { low: 21, high: 61, referenceId: CHAMBER },
    female: { low: 14, high: 42, referenceId: CHAMBER },
  },
  // mean + 2 SD of the sinus of Valsalva (3.4 ± 0.3 cm in men, 3.0 ± 0.3 cm in women)
  'aortic-root': {
    male: { high: 4.0, referenceId: CHAMBER },
    female: { high: 3.6, referenceId: CHAMBER },
  },
  'rv-basal': same({ high: 4.1, referenceId: CHAMBER }),
  tapse: same({ low: 1.7, referenceId: 'ase-right-heart-2025' }),
  'ivc-diameter': same({ high: 2.1, referenceId: 'ase-right-heart-2025' }),
  'e-prime-septal': same({ low: 7, referenceId: 'ase-diastolic-2025' }),
  'e-prime-lateral': same({ low: 10, referenceId: 'ase-diastolic-2025' }),
  'tr-vmax': same({ high: 2.8, referenceId: 'ase-diastolic-2025' }),
};

/** Where a value sits against the normal range of a measurement for a sex; null when the measurement has none. */
export function rangeFlag(id: string, sex: Sex, value: number): 'low' | 'normal' | 'high' | null {
  const r = NORMAL_RANGES[id]?.[sex];
  if (!r) return null;
  if (r.low !== undefined && value < r.low) return 'low';
  if (r.high !== undefined && value > r.high) return 'high';
  return 'normal';
}

/** The range as the report prints it: «3,8–5,2», «≤ 4,1», «≥ 1,7»; null without a range. */
export function rangeText(id: string, sex: Sex): string | null {
  const r = NORMAL_RANGES[id]?.[sex];
  if (!r) return null;
  const f = (v: number) => v.toLocaleString('es-ES', { maximumFractionDigits: 2 });
  if (r.low !== undefined && r.high !== undefined) return `${f(r.low)}–${f(r.high)}`;
  return r.high !== undefined ? `≤ ${f(r.high)}` : `≥ ${f(r.low!)}`;
}
