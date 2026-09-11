/**
 * Clinical rules as versioned data (spec 39). A rule has a value, units, population, and the id
 * of the guideline it came from. Nothing here is a "magic constant" in UI code.
 *
 * IMPORTANT: values marked `confidence: 'recalled'` were entered from the implementer's
 * knowledge of the cited guideline and must be re-verified against the current document before
 * being used for any grading shown as authoritative (docs/REFERENCES.md tracks this).
 */
export interface ClinicalRule<T> {
  id: string;
  value: T;
  units?: string;
  population: string;
  referenceId: string;
  notes?: string;
  confidence: 'verified' | 'recalled';
}

export interface Range {
  lo: number;
  hi: number;
}

export const LV_RULES = {
  lvEddNormalMen: {
    id: 'lv-edd-normal-men',
    value: { lo: 4.2, hi: 5.8 } as Range,
    units: 'cm',
    population: 'adult men',
    referenceId: 'ase-eacvi-chamber-2015',
    confidence: 'recalled',
  } satisfies ClinicalRule<Range>,
  lvEddNormalWomen: {
    id: 'lv-edd-normal-women',
    value: { lo: 3.8, hi: 5.2 } as Range,
    units: 'cm',
    population: 'adult women',
    referenceId: 'ase-eacvi-chamber-2015',
    confidence: 'recalled',
  } satisfies ClinicalRule<Range>,
  ivsdNormal: {
    id: 'ivsd-normal',
    value: { lo: 0.6, hi: 1.0 } as Range,
    units: 'cm',
    population: 'adults (men 0.6–1.0; women 0.6–0.9)',
    referenceId: 'ase-eacvi-chamber-2015',
    confidence: 'recalled',
  } satisfies ClinicalRule<Range>,
  lvpwdNormal: {
    id: 'lvpwd-normal',
    value: { lo: 0.6, hi: 1.0 } as Range,
    units: 'cm',
    population: 'adults (men 0.6–1.0; women 0.6–0.9)',
    referenceId: 'ase-eacvi-chamber-2015',
    confidence: 'recalled',
  } satisfies ClinicalRule<Range>,
  lvefNormalLowerMen: {
    id: 'lvef-normal-lower-men',
    value: 52,
    units: '%',
    population: 'adult men',
    referenceId: 'ase-eacvi-chamber-2015',
    confidence: 'recalled',
  } satisfies ClinicalRule<number>,
  lvefNormalLowerWomen: {
    id: 'lvef-normal-lower-women',
    value: 54,
    units: '%',
    population: 'adult women',
    referenceId: 'ase-eacvi-chamber-2015',
    confidence: 'recalled',
  } satisfies ClinicalRule<number>,
  laviUpperNormal: {
    id: 'lavi-upper-normal',
    value: 34,
    units: 'mL/m²',
    population: 'adults',
    referenceId: 'ase-eacvi-chamber-2015',
    confidence: 'recalled',
  } satisfies ClinicalRule<number>,
} as const;

export const AORTIC_STENOSIS_RULES = {
  severeVmax: {
    id: 'as-severe-vmax',
    value: 4.0,
    units: 'm/s',
    population: 'adults, normal flow',
    referenceId: 'ase-eacvi-aortic-stenosis-2017',
    confidence: 'recalled',
    notes: 'Severe AS: Vmax ≥ 4.0 m/s',
  } satisfies ClinicalRule<number>,
  severeMeanGradient: {
    id: 'as-severe-mean-gradient',
    value: 40,
    units: 'mmHg',
    population: 'adults, normal flow',
    referenceId: 'ase-eacvi-aortic-stenosis-2017',
    confidence: 'recalled',
  } satisfies ClinicalRule<number>,
  severeAva: {
    id: 'as-severe-ava',
    value: 1.0,
    units: 'cm²',
    population: 'adults',
    referenceId: 'ase-eacvi-aortic-stenosis-2017',
    confidence: 'recalled',
    notes: 'Severe AS: AVA ≤ 1.0 cm² (indexed ≤ 0.6 cm²/m²)',
  } satisfies ClinicalRule<number>,
  moderateVmax: {
    id: 'as-moderate-vmax',
    value: { lo: 3.0, hi: 3.9 } as Range,
    units: 'm/s',
    population: 'adults',
    referenceId: 'ase-eacvi-aortic-stenosis-2017',
    confidence: 'recalled',
  } satisfies ClinicalRule<Range>,
  moderateMeanGradient: {
    id: 'as-moderate-mean-gradient',
    value: { lo: 20, hi: 39 } as Range,
    units: 'mmHg',
    population: 'adults',
    referenceId: 'ase-eacvi-aortic-stenosis-2017',
    confidence: 'recalled',
  } satisfies ClinicalRule<Range>,
  moderateAva: {
    id: 'as-moderate-ava',
    value: { lo: 1.0, hi: 1.5 } as Range,
    units: 'cm²',
    population: 'adults',
    referenceId: 'ase-eacvi-aortic-stenosis-2017',
    confidence: 'recalled',
  } satisfies ClinicalRule<Range>,
  severeVelocityRatio: {
    id: 'as-severe-velocity-ratio',
    value: 0.25,
    units: 'ratio',
    population: 'adults',
    referenceId: 'ase-eacvi-aortic-stenosis-2017',
    confidence: 'recalled',
    notes: 'Dimensionless index (LVOT VTI / AV VTI) < 0.25 supports severe AS',
  } satisfies ClinicalRule<number>,
} as const;

export const RIGHT_HEART_RULES = {
  tapseAbnormal: {
    id: 'tapse-abnormal',
    value: 1.7,
    units: 'cm',
    population: 'adults',
    referenceId: 'ase-right-heart-2025',
    confidence: 'recalled',
    notes: 'TAPSE < 17 mm suggests RV systolic dysfunction (2010/2015 cutoff; re-verify in 2025 update).',
  } satisfies ClinicalRule<number>,
  facAbnormal: {
    id: 'fac-abnormal',
    value: 35,
    units: '%',
    population: 'adults',
    referenceId: 'ase-right-heart-2025',
    confidence: 'recalled',
  } satisfies ClinicalRule<number>,
  sPrimeAbnormal: {
    id: 's-prime-abnormal',
    value: 9.5,
    units: 'cm/s',
    population: 'adults',
    referenceId: 'ase-right-heart-2025',
    confidence: 'recalled',
  } satisfies ClinicalRule<number>,
  rapFromIvc: {
    id: 'rap-from-ivc',
    value: {
      normal: { ivcMaxCm: 2.1, collapsePct: 50, rapMmHg: 3 },
      intermediate: { rapMmHg: 8 },
      high: { rapMmHg: 15 },
    },
    units: 'mmHg',
    population: 'adults, spontaneous breathing',
    referenceId: 'ase-right-heart-2025',
    confidence: 'recalled',
    notes:
      'IVC ≤ 2.1 cm with > 50% sniff collapse → RAP 3 (0–5); IVC > 2.1 cm with < 50% collapse → 15 (10–20); otherwise 8 (5–10). Re-verify in 2025 guideline.',
  } satisfies ClinicalRule<{
    normal: { ivcMaxCm: number; collapsePct: number; rapMmHg: number };
    intermediate: { rapMmHg: number };
    high: { rapMmHg: number };
  }>,
} as const;

export const DIASTOLIC_RULES = {
  averageEeAbnormal: {
    id: 'avg-e-over-e-prime-abnormal',
    value: 14,
    units: 'ratio',
    population: 'adults with normal LVEF',
    referenceId: 'ase-diastolic-2025',
    confidence: 'recalled',
    notes: 'Average E/e′ > 14 (2016 cutoff; 2025 update must be re-verified before grading).',
  } satisfies ClinicalRule<number>,
  septalEPrimeAbnormal: {
    id: 'septal-e-prime-abnormal',
    value: 7,
    units: 'cm/s',
    population: 'adults',
    referenceId: 'ase-diastolic-2025',
    confidence: 'recalled',
  } satisfies ClinicalRule<number>,
  lateralEPrimeAbnormal: {
    id: 'lateral-e-prime-abnormal',
    value: 10,
    units: 'cm/s',
    population: 'adults',
    referenceId: 'ase-diastolic-2025',
    confidence: 'recalled',
  } satisfies ClinicalRule<number>,
  trVelocityAbnormal: {
    id: 'tr-velocity-abnormal',
    value: 2.8,
    units: 'm/s',
    population: 'adults',
    referenceId: 'ase-diastolic-2025',
    confidence: 'recalled',
  } satisfies ClinicalRule<number>,
} as const;

/** Presentation precision per measurement family (spec 55). */
export const REPORT_PRECISION: Record<string, { decimals: number; units: string; referenceId: string }> = {
  linearCm: { decimals: 1, units: 'cm', referenceId: 'ase-reporting-2025' },
  linearMm: { decimals: 0, units: 'mm', referenceId: 'ase-reporting-2025' },
  velocityMps: { decimals: 2, units: 'm/s', referenceId: 'ase-reporting-2025' },
  velocityCmps: { decimals: 0, units: 'cm/s', referenceId: 'ase-reporting-2025' },
  gradientMmHg: { decimals: 0, units: 'mmHg', referenceId: 'ase-reporting-2025' },
  areaCm2: { decimals: 2, units: 'cm²', referenceId: 'ase-reporting-2025' },
  volumeMl: { decimals: 0, units: 'mL', referenceId: 'ase-reporting-2025' },
  percent: { decimals: 0, units: '%', referenceId: 'ase-reporting-2025' },
  timeMs: { decimals: 0, units: 'ms', referenceId: 'ase-reporting-2025' },
  vtiCm: { decimals: 1, units: 'cm', referenceId: 'ase-reporting-2025' },
  ratio: { decimals: 2, units: '', referenceId: 'ase-reporting-2025' },
};

export function formatClinical(value: number | null | undefined, family: keyof typeof REPORT_PRECISION): string {
  const p = REPORT_PRECISION[family];
  if (!p) throw new Error(`Unknown precision family ${family}`);
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value.toFixed(p.decimals)}${p.units ? ' ' + p.units : ''}`;
}
