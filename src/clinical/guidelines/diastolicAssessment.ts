import { annularRelaxationLimits } from './normalRanges';

/** Available measurements and applicability, not a diagnosis inferred from a case identifier. */
export interface DiastolicInputs {
  ageYears?: number;
  rhythm: string;
  eMps: number;
  eOverA: number | null;
  septalEPrimeCmps: number;
  lateralEPrimeCmps: number;
  laviMlM2: number;
  laSizeReliable: boolean;
  trMps: number | null;
  paspMmHg: number | null;
  decelerationTimeMs: number;
  pulmonaryVeinSd: number;
  bmiKgM2?: number;
  laReservoirStrainPct?: number;
}
export type FillingPressureAssessment = 'elevated' | 'normal' | 'indeterminate' | 'not-assessed';

/**
 * ASE 2025 DOI 10.1016/j.echo.2025.03.011: Figure 2 (dysfunction), Figure 8 (AF LAP).
 * Table 6 strict age-specific e′ limits are used. DD and elevated LAP are separate conclusions.
 * AF requires representative averages across beats clinically; synthetic inputs are nominal case values.
 */
export function assessDiastolic(input: DiastolicInputs) {
  const required = [
    input.eMps,
    input.septalEPrimeCmps,
    input.lateralEPrimeCmps,
    input.decelerationTimeMs,
  ];
  if (required.some((v) => !Number.isFinite(v) || v <= 0))
    throw new RangeError('Diastolic assessment requires finite positive Doppler measurements');
  const valid = (v: number | null | undefined): v is number =>
    v != null && Number.isFinite(v) && v >= 0;
  const cut = annularRelaxationLimits(input.ageYears);
  const avgPrime = (input.septalEPrimeCmps + input.lateralEPrimeCmps) / 2;
  const ee = (100 * input.eMps) / avgPrime;
  const septalEe = (100 * input.eMps) / input.septalEPrimeCmps;
  const reduced =
    input.septalEPrimeCmps < cut.septal ||
    input.lateralEPrimeCmps < cut.lateral ||
    avgPrime < cut.average;
  const markers: string[] = [];
  if (ee > 14) markers.push('average-e-over-e-prime');
  if (valid(input.eOverA) && (input.eOverA <= 0.8 || input.eOverA >= 2))
    markers.push('mitral-e-over-a');
  if (input.laSizeReliable && valid(input.laviMlM2) && input.laviMlM2 > 34)
    markers.push('la-volume');
  if (valid(input.laReservoirStrainPct) && input.laReservoirStrainPct <= 18)
    markers.push('la-reservoir-strain');
  const dysfunctionPresent = markers.length >= (reduced ? 1 : 2);
  const pressureEvidence: string[] = [];
  let fillingPressure: FillingPressureAssessment = 'not-assessed';
  if (input.rhythm === 'atrial-fibrillation') {
    if (input.eMps >= 1) pressureEvidence.push('mitral-e');
    if (septalEe > 11) pressureEvidence.push('septal-e-over-e-prime');
    if ((valid(input.trMps) && input.trMps > 2.8) || (valid(input.paspMmHg) && input.paspMmHg > 35))
      pressureEvidence.push('tr-or-pasp');
    if (input.decelerationTimeMs <= 160) pressureEvidence.push('deceleration-time');
    const pulmonaryAvailable = [input.trMps, input.paspMmHg].some(valid);
    if (pressureEvidence.length >= 3) fillingPressure = 'elevated';
    else if (!pulmonaryAvailable) fillingPressure = 'indeterminate';
    else if (pressureEvidence.length <= 1) fillingPressure = 'normal';
    else {
      const additional = [
        valid(input.laReservoirStrainPct) ? input.laReservoirStrainPct < 18 : null,
        valid(input.pulmonaryVeinSd) ? input.pulmonaryVeinSd < 1 : null,
        valid(input.bmiKgM2) ? input.bmiKgM2 > 30 : null,
      ];
      fillingPressure =
        additional.filter((v) => v === true).length >= 2
          ? 'elevated'
          : additional.every((v) => v === false)
            ? 'normal'
            : 'indeterminate';
    }
  }
  // General sinus-rhythm LAP requires clinical exclusions not represented in the current case schema.
  // Do not infer elevated LAP from the presence of dysfunction alone.
  return {
    dysfunctionPresent,
    reducedRelaxation: reduced,
    dysfunctionMarkers: markers,
    fillingPressure,
    pressureEvidence,
    referenceId: 'ase-diastolic-2025',
  };
}
