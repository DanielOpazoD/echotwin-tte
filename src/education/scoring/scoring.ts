import type { Measurement } from '@/simulator/measurements/types';
import type { StructuredEchoTruth } from '@/simulator/hemodynamics/groundTruth';
import type { CaseDefinition } from '@/cases/schema';

/**
 * Transparent, modular scoring (spec 28). Acquisition scores come from the ViewQualityEngine
 * (best score reached per required view during the session); measurement scores compare each
 * user measurement with the model truth using per-measurement tolerances and penalise technique
 * (low view quality) even when the number happens to be right. Deterministic and auditable.
 */
export interface ViewProgress {
  [viewId: string]: number; // best score 0..100 reached in the session
}

export interface AcquisitionScore {
  total: number; // 0..100
  perView: { viewId: string; required: number; achieved: number; ok: boolean }[];
}

export function scoreAcquisition(caseDef: CaseDefinition, progress: ViewProgress): AcquisitionScore {
  const perView = caseDef.requiredViews.map((rv) => {
    const achieved = progress[rv.viewId] ?? 0;
    return { viewId: rv.viewId, required: rv.minScore, achieved, ok: achieved >= rv.minScore };
  });
  if (perView.length === 0) return { total: 100, perView };
  const total = perView.reduce((s, v) => s + Math.min(100, (v.achieved / Math.max(1, v.required)) * 100), 0) / perView.length;
  return { total: Math.round(Math.min(100, total)), perView };
}

/** Map a required measurement id to the truth value and the measurement kind that can capture it. */
export function truthFor(id: string, t: StructuredEchoTruth): { value: number; units: string; kind: Measurement['kind']; label: string } | null {
  switch (id) {
    case 'lvot-diameter':
      return { value: t.lvot.diameterCm, units: 'cm', kind: 'linear', label: 'Diámetro TSVI' };
    case 'lv-edd':
      return { value: t.lv.eddCm, units: 'cm', kind: 'linear', label: 'DTDVI' };
    case 'ivsd':
      return { value: t.lv.ivsdCm, units: 'cm', kind: 'linear', label: 'SIV diastólico' };
    case 'lvot-vti':
      return { value: t.lvot.vtiCm, units: 'cm', kind: 'vti', label: 'VTI TSVI' };
    case 'av-vti':
      return { value: t.aorticValve.vtiCm, units: 'cm', kind: 'vti', label: 'VTI aórtico' };
    case 'av-vmax':
      return { value: t.aorticValve.vmaxMps, units: 'm/s', kind: 'velocity', label: 'Vmax aórtica' };
    case 'mitral-e':
      return { value: t.mitral.ePeakMps, units: 'm/s', kind: 'velocity', label: 'Onda E mitral' };
    case 'tr-vmax':
      return t.rightHeart.trVmaxMps ? { value: t.rightHeart.trVmaxMps, units: 'm/s', kind: 'velocity', label: 'Vmax IT' } : null;
    default:
      return null;
  }
}

export interface MeasurementScoreRow {
  measurementId: string;
  label: string;
  truth: number;
  units: string;
  measured: number | null;
  errorPct: number | null;
  tolerancePct: number;
  viewScore: number | null;
  technicallyValid: boolean;
  points: number; // 0..100
  comment: string;
}

export interface MeasurementScore {
  total: number;
  rows: MeasurementScoreRow[];
}

const MIN_VIEW_SCORE_FOR_VALID = 50;

/** Best matching user measurement (closest to the truth) of the right kind. */
function bestMatch(kind: Measurement['kind'], truth: number, ms: Measurement[]): Measurement | null {
  let best: Measurement | null = null;
  for (const m of ms) {
    if (m.kind !== kind) continue;
    if (!best || Math.abs(m.value - truth) < Math.abs(best.value - truth)) best = m;
  }
  return best;
}

export function scoreMeasurements(caseDef: CaseDefinition, truth: StructuredEchoTruth, measurements: Measurement[]): MeasurementScore {
  const rows: MeasurementScoreRow[] = [];
  for (const req of caseDef.requiredMeasurements) {
    const t = truthFor(req.measurementId, truth);
    if (!t) continue;
    const m = bestMatch(t.kind, t.value, measurements);
    if (!m) {
      rows.push({ measurementId: req.measurementId, label: t.label, truth: t.value, units: t.units, measured: null, errorPct: null, tolerancePct: req.tolerancePct, viewScore: null, technicallyValid: false, points: 0, comment: 'No medida.' });
      continue;
    }
    const errorPct = (Math.abs(m.value - t.value) / t.value) * 100;
    const technicallyValid = (m.viewScore ?? 0) >= MIN_VIEW_SCORE_FOR_VALID;
    let points = errorPct <= req.tolerancePct ? 100 : Math.max(0, 100 - (errorPct - req.tolerancePct) * 3);
    let comment = errorPct <= req.tolerancePct ? 'Dentro de tolerancia.' : `Error ${errorPct.toFixed(0)} % (tolerancia ${req.tolerancePct} %).`;
    if (!technicallyValid) {
      points *= 0.4;
      comment += ' Medición tomada con una vista de baja calidad: técnicamente inválida aunque el número coincida.';
    }
    rows.push({ measurementId: req.measurementId, label: t.label, truth: t.value, units: t.units, measured: m.value, errorPct, tolerancePct: req.tolerancePct, viewScore: m.viewScore, technicallyValid, points: Math.round(points), comment });
  }
  const total = rows.length ? Math.round(rows.reduce((s, r) => s + r.points, 0) / rows.length) : 100;
  return { total, rows };
}

export interface ExamSummary {
  total: number;
  acquisition: AcquisitionScore;
  measurements: MeasurementScore;
  strengths: string[];
  mainErrors: string[];
  omittedViews: string[];
  invalidMeasurements: string[];
  recommendations: string[];
}

export function buildExamSummary(caseDef: CaseDefinition, truth: StructuredEchoTruth, progress: ViewProgress, measurements: Measurement[]): ExamSummary {
  const acquisition = scoreAcquisition(caseDef, progress);
  const ms = scoreMeasurements(caseDef, truth, measurements);
  const total = Math.round(acquisition.total * 0.5 + ms.total * 0.5);
  const strengths: string[] = [];
  const mainErrors: string[] = [];
  const recommendations: string[] = [];
  for (const v of acquisition.perView) {
    if (v.ok) strengths.push(`Vista ${v.viewId.toUpperCase()} adquirida con ${v.achieved}/100.`);
    else if (v.achieved > 0) mainErrors.push(`Vista ${v.viewId.toUpperCase()} incompleta (${v.achieved}/${v.required}).`);
  }
  const omittedViews = acquisition.perView.filter((v) => v.achieved === 0).map((v) => v.viewId);
  if (omittedViews.length) recommendations.push(`Practica la adquisición de: ${omittedViews.map((v) => v.toUpperCase()).join(', ')}.`);
  const invalidMeasurements = ms.rows.filter((r) => r.measured !== null && !r.technicallyValid).map((r) => r.label);
  if (invalidMeasurements.length) recommendations.push('Optimiza la vista (score ≥ 50) antes de medir: una medición sobre un plano oblicuo no es válida aunque el número parezca correcto.');
  for (const r of ms.rows) {
    if (r.measured === null) mainErrors.push(`${r.label} no fue medida.`);
    else if (r.points >= 90) strengths.push(`${r.label} dentro de tolerancia.`);
    else mainErrors.push(`${r.label}: ${r.comment}`);
  }
  if (ms.rows.some((r) => r.measured === null)) recommendations.push('Completa las mediciones requeridas por el caso antes de cerrar el informe.');
  return { total, acquisition, measurements: ms, strengths, mainErrors, omittedViews, invalidMeasurements, recommendations };
}
