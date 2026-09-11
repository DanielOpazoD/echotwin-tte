import type { Measurement } from '@/simulator/measurements/types';
import type { StructuredEchoTruth } from '@/simulator/hemodynamics/groundTruth';
import { AORTIC_STENOSIS_RULES, formatClinical } from '../reference-values';

/**
 * Educational report assembly (spec 26). Deterministic; compares user measurements with the model
 * truth only when allowed (never in exam mode). Style differences are not penalised.
 */
export interface ReportRow {
  id: string;
  label: string;
  value: string;
  modality: string;
  view: string | null;
  viewScore: number | null;
  truth: string | null;
  deviation: string | null;
}

export interface EducationalReport {
  studyQuality: string;
  rows: ReportRow[];
  impression: string[];
}

export function buildEducationalReport(measurements: Measurement[], truth: StructuredEchoTruth | null, hideTruth: boolean): EducationalReport {
  const rows: ReportRow[] = measurements.map((m) => {
    let truthVal: string | null = null;
    let dev: string | null = null;
    if (truth && !hideTruth) {
      const ref = matchTruth(m, truth);
      if (ref !== null) {
        truthVal = ref.text;
        const d = ((m.value - ref.value) / ref.value) * 100;
        dev = `${d >= 0 ? '+' : ''}${d.toFixed(0)} %`;
      }
    }
    return {
      id: m.id,
      label: m.label,
      value: `${m.value.toFixed(m.kind === 'time' ? 0 : 2)} ${m.units}`,
      modality: m.modality,
      view: m.sourceViewId,
      viewScore: m.viewScore,
      truth: truthVal,
      deviation: dev,
    };
  });
  const lowQuality = measurements.filter((m) => (m.viewScore ?? 100) < 50).length;
  const studyQuality = measurements.length === 0 ? 'Sin mediciones registradas.' : lowQuality ? `${lowQuality} de ${measurements.length} mediciones se tomaron con calidad de vista < 50/100; su validez es limitada.` : 'Mediciones obtenidas con calidad de vista adecuada.';
  const impression: string[] = [];
  if (hideTruth) impression.push('Redacta tu impresión diagnóstica a partir de tus propias mediciones; la comparación se entrega al finalizar el examen.');
  else if (truth) {
    impression.push(`FEVI del modelo ${formatClinical(truth.lv.efPct, 'percent')}; ${truth.lv.efPct >= 52 ? 'función sistólica conservada' : 'función sistólica reducida'}.`);
    const R = AORTIC_STENOSIS_RULES;
    const av = truth.aorticValve;
    if (av.vmaxMps >= R.severeVmax.value || av.meanGradientMmHg >= R.severeMeanGradient.value || av.continuityAvaCm2 <= R.severeAva.value)
      impression.push(`Criterios hemodinámicos de estenosis aórtica severa (Vmax ≥ ${R.severeVmax.value} m/s, gradiente medio ≥ ${R.severeMeanGradient.value} mmHg o AVA ≤ ${R.severeAva.value} cm²; ${R.severeVmax.referenceId}).`);
    else if (av.vmaxMps >= R.moderateVmax.value.lo) impression.push(`Criterios hemodinámicos de estenosis aórtica moderada (${R.moderateVmax.referenceId}).`);
    else impression.push('Sin estenosis aórtica significativa.');
  }
  return { studyQuality, rows, impression };
}

function matchTruth(m: Measurement, t: StructuredEchoTruth): { value: number; text: string } | null {
  // Heuristic mapping by kind + modality; explicit labels can be attached by the measurement tools later.
  if (m.kind === 'velocity' && (m.modality === 'cw' || m.modality === 'pw')) {
    // choose the closest plausible source: AV Vmax, LVOT Vmax, E, TR
    const candidates = [t.aorticValve.vmaxMps, t.lvot.vmaxMps, t.mitral.ePeakMps, t.rightHeart.trVmaxMps ?? 0].filter((v) => v > 0);
    const best = candidates.reduce((a, b) => (Math.abs(b - m.value) < Math.abs(a - m.value) ? b : a));
    return { value: best, text: formatClinical(best, 'velocityMps') };
  }
  if (m.kind === 'vti') {
    const candidates = [t.aorticValve.vtiCm, t.lvot.vtiCm];
    const best = candidates.reduce((a, b) => (Math.abs(b - m.value) < Math.abs(a - m.value) ? b : a));
    return { value: best, text: formatClinical(best, 'vtiCm') };
  }
  if (m.kind === 'linear') {
    const candidates = [t.lv.eddCm, t.lvot.diameterCm, t.lv.ivsdCm, t.la.apDiameterCm, t.aorta.sinusCm];
    const best = candidates.reduce((a, b) => (Math.abs(b - m.value) < Math.abs(a - m.value) ? b : a));
    return { value: best, text: formatClinical(best, 'linearCm') };
  }
  return null;
}
