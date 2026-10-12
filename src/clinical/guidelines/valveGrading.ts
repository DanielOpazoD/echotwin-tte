import { AORTIC_STENOSIS_RULES } from '@/clinical/reference-values';
import { rangeFlag, type Sex } from './normalRanges';

/**
 * Integrative grading of the valve lesions the cases model (ASE/EACVI 2017: Baumgartner for aortic stenosis, Zoghbi for
 * native valvular regurgitation). The report and the expected findings each graded on their own, and on one criterion:
 * aortic stenosis was severe when any single sign was (an AVA of 1.0 alone made it severe whatever the gradient and the
 * flow), and mitral regurgitation followed the orifice alone, so a case with a 64 % regurgitant fraction read moderate.
 */

export type ValveGrade = 'none' | 'mild' | 'moderate' | 'severe';

export interface AorticStenosisInput {
  vmaxMps: number;
  meanGradientMmHg: number;
  /** Continuity-equation valve area (cm²). */
  avaCm2: number;
  /** Forward stroke volume index (mL/m²), the flow the gradients depend on. */
  strokeVolumeIndexMlM2: number;
  efPct: number;
  /** LVOT VTI / aortic VTI (dimensionless index); optional. */
  velocityRatio?: number;
}

export type AorticStenosisPattern =
  | 'high-gradient'
  | 'classic-low-flow-low-gradient'
  | 'paradoxical-low-flow-low-gradient'
  | 'normal-flow-low-gradient'
  | 'low-flow-moderate'
  | null;

export interface AorticStenosisGrade {
  grade: ValveGrade;
  pattern: AorticStenosisPattern;
  /** One sentence, in the report's Spanish, saying why. */
  rationale: string;
}

/** Below 35 mL/m² the flow is low and the gradients underestimate the stenosis (ASE/EACVI 2017). */
export const LOW_FLOW_SVI_ML_M2 = 35;

export function gradeAorticStenosis(a: AorticStenosisInput): AorticStenosisGrade {
  const R = AORTIC_STENOSIS_RULES;
  const highGradient =
    a.vmaxMps >= R.severeVmax.value || a.meanGradientMmHg >= R.severeMeanGradient.value;
  if (highGradient)
    return {
      grade: 'severe',
      pattern: 'high-gradient',
      rationale: `Estenosis aórtica severa de alto gradiente (Vmax ≥ ${R.severeVmax.value} m/s o gradiente medio ≥ ${R.severeMeanGradient.value} mmHg).`,
    };
  // discordant: a severe area with a gradient that is not — the flow decides how to read it
  if (a.avaCm2 <= R.severeAva.value) {
    if (a.strokeVolumeIndexMlM2 < LOW_FLOW_SVI_ML_M2) {
      const classic = a.efPct < 50;
      return {
        grade: 'severe',
        pattern: classic ? 'classic-low-flow-low-gradient' : 'paradoxical-low-flow-low-gradient',
        rationale: `AVA ≤ ${R.severeAva.value} cm² con gradiente bajo y bajo flujo (VSi < ${LOW_FLOW_SVI_ML_M2} mL/m²): estenosis severa de bajo flujo y bajo gradiente ${classic ? 'clásica (FEVI < 50 %); confirmar con ecocardiografía de estrés con dobutamina' : 'paradójica (FEVI conservada); confirmar con calcio valvular por TC'}.`,
      };
    }
    return {
      grade: 'moderate',
      pattern: 'normal-flow-low-gradient',
      rationale: `AVA ≤ ${R.severeAva.value} cm² con gradiente bajo y flujo normal: discordancia que suele ser moderada; revisar el diámetro del TSVI y la alineación del CW.`,
    };
  }
  // a moderate area (≤ 1.5 cm²) and index (≤ 0.5) whose gradients low flow keeps under the moderate band: the area and
  // the index are what the flow does not change, so it is moderate (ASE/EACVI 2017 integrates them when gradients and
  // area disagree)
  if (
    a.avaCm2 <= R.moderateAva.value.hi &&
    a.velocityRatio !== undefined &&
    a.velocityRatio <= 0.5 &&
    a.strokeVolumeIndexMlM2 < LOW_FLOW_SVI_ML_M2 &&
    a.vmaxMps < R.moderateVmax.value.lo
  )
    return {
      grade: 'moderate',
      pattern: 'low-flow-moderate',
      rationale: `Estenosis aórtica moderada con gradientes bajos por bajo flujo (AVA ≤ ${R.moderateAva.value.hi} cm², índice adimensional ≤ 0,5, VSi < ${LOW_FLOW_SVI_ML_M2} mL/m²).`,
    };
  if (a.vmaxMps >= R.moderateVmax.value.lo || a.meanGradientMmHg >= R.moderateMeanGradient.value.lo)
    return {
      grade: 'moderate',
      pattern: null,
      rationale: `Estenosis aórtica moderada (Vmax ${R.moderateVmax.value.lo}–${R.moderateVmax.value.hi} m/s o gradiente medio ${R.moderateMeanGradient.value.lo}–${R.moderateMeanGradient.value.hi} mmHg).`,
    };
  if (a.vmaxMps >= 2.0)
    return {
      grade: 'mild',
      pattern: null,
      rationale: 'Esclerosis aórtica / estenosis leve (Vmax 2–3 m/s).',
    };
  return { grade: 'none', pattern: null, rationale: 'Sin estenosis aórtica significativa.' };
}

export interface MitralRegurgitationInput {
  eroaCm2: number;
  regurgitantVolumeMl: number;
  regurgitantFractionPct: number;
}

/**
 * ASE/EACVI 2017 quantitative criteria: severe with ERO ≥ 0.40 cm², regurgitant volume ≥ 60 mL and fraction ≥ 50 %; mild
 * below 0.20 cm², 30 mL and 30 %. The grade is the one at least two of the three agree on, moderate otherwise; a jet below
 * 0.10 cm² is trace. The same thresholds serve primary and secondary regurgitation, as in the ASE document; the ESC 2021
 * lower secondary thresholds (0.20 cm², 30 mL) are not applied.
 */
export function gradeMitralRegurgitation(m: MitralRegurgitationInput): ValveGrade {
  if (m.eroaCm2 < 0.1) return 'none';
  const severe =
    Number(m.eroaCm2 >= 0.4) +
    Number(m.regurgitantVolumeMl >= 60) +
    Number(m.regurgitantFractionPct >= 50);
  const mild =
    Number(m.eroaCm2 < 0.2) +
    Number(m.regurgitantVolumeMl < 30) +
    Number(m.regurgitantFractionPct < 30);
  if (severe >= 2) return 'severe';
  if (mild >= 2) return 'mild';
  return 'moderate';
}

/** EF categories of ASE/EACVI 2015 chamber quantification, which put the lower normal limit at 52 % in men and 54 % in women. */
export function efCategory(efPct: number, sex: Sex): 'normal' | 'mild' | 'moderate' | 'severe' {
  if (efPct >= (sex === 'female' ? 54 : 52)) return 'normal';
  if (efPct >= 41) return 'mild';
  if (efPct >= 30) return 'moderate';
  return 'severe';
}

/** Septal or posterior wall above the sex's upper normal limit (ASE/EACVI 2015: 1.0 cm in men, 0.9 cm in women). */
export function wallThickened(ivsdCm: number, lvpwdCm: number, sex: Sex): boolean {
  return rangeFlag('ivsd', sex, ivsdCm) === 'high' || rangeFlag('lvpwd', sex, lvpwdCm) === 'high';
}
