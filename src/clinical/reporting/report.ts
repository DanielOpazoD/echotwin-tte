import type { Measurement } from '@/simulator/measurements/types';
import type { StructuredEchoTruth } from '@/simulator/hemodynamics/groundTruth';
import { AORTIC_STENOSIS_RULES, formatClinical } from '../reference-values';
import { getMeasurementSpec } from '@/simulator/measurements/protocol';

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
  /** technique grade (0..100) and its non-ok findings; null for free measurements */
  technique: { score: number; level: 'ok' | 'warn' | 'invalid'; notes: string[] } | null;
}

/** Calculations derived from the user's own protocol measurements (never from the truth). */
export interface DerivedRow {
  id: string;
  label: string;
  value: string;
  formula: string;
  inputs: string;
}

export interface EducationalReport {
  studyQuality: string;
  rows: ReportRow[];
  derived: DerivedRow[];
  impression: string[];
}

export function buildEducationalReport(
  measurements: Measurement[],
  truth: StructuredEchoTruth | null,
  hideTruth: boolean,
): EducationalReport {
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
    const tq = m.technique
      ? {
          score: Math.round(m.technique.score * 100),
          level: m.technique.findings.some((f) => f.level === 'invalid')
            ? ('invalid' as const)
            : m.technique.findings.some((f) => f.level === 'warn')
              ? ('warn' as const)
              : ('ok' as const),
          notes: m.technique.findings.filter((f) => f.level !== 'ok').map((f) => f.message),
        }
      : null;
    return {
      id: m.id,
      label: m.label,
      value: `${m.value.toFixed(m.kind === 'time' || m.kind === 'volume' ? 0 : 2)} ${m.units}`,
      modality: m.modality,
      view: m.sourceViewId,
      viewScore: m.viewScore,
      truth: truthVal,
      deviation: dev,
      technique: tq,
    };
  });
  const lowQuality = measurements.filter((m) =>
    m.technique
      ? m.technique.findings.some((f) => f.level === 'invalid')
      : (m.viewScore ?? 100) < 50,
  ).length;
  const studyQuality =
    measurements.length === 0
      ? 'Sin mediciones registradas.'
      : lowQuality
        ? `${lowQuality} de ${measurements.length} mediciones tienen problemas de técnica que invalidan el valor (vista, fase, posición o alineación); su validez es limitada.`
        : 'Mediciones obtenidas con técnica adecuada.';
  const derived = deriveCalculations(measurements);
  const impression: string[] = [];
  if (hideTruth)
    impression.push(
      'Redacta tu impresión diagnóstica a partir de tus propias mediciones; la comparación se entrega al finalizar el examen.',
    );
  else if (truth) {
    impression.push(
      `FEVI del modelo ${formatClinical(truth.lv.efPct, 'percent')}; ${truth.lv.efPct >= 52 ? 'función sistólica conservada' : 'función sistólica reducida'}.`,
    );
    const R = AORTIC_STENOSIS_RULES;
    const av = truth.aorticValve;
    if (
      av.vmaxMps >= R.severeVmax.value ||
      av.meanGradientMmHg >= R.severeMeanGradient.value ||
      av.continuityAvaCm2 <= R.severeAva.value
    )
      impression.push(
        `Criterios hemodinámicos de estenosis aórtica severa (Vmax ≥ ${R.severeVmax.value} m/s, gradiente medio ≥ ${R.severeMeanGradient.value} mmHg o AVA ≤ ${R.severeAva.value} cm²; ${R.severeVmax.referenceId}).`,
      );
    else if (av.vmaxMps >= R.moderateVmax.value.lo)
      impression.push(
        `Criterios hemodinámicos de estenosis aórtica moderada (${R.moderateVmax.referenceId}).`,
      );
    else if (av.vmaxMps >= 2.0)
      impression.push('Esclerosis aórtica / estenosis leve (Vmax 2–3 m/s).');
    else impression.push('Sin estenosis aórtica significativa.');
    impression.push(...pathologyImpressions(truth));
  }
  return { studyQuality, rows, derived, impression };
}

/** Latest protocol measurement value by id. */
function latest(ms: Measurement[], id: string): Measurement | null {
  for (let i = ms.length - 1; i >= 0; i--) if (ms[i]!.measurementId === id) return ms[i]!;
  return null;
}

/** Composite calculations from the user's measurements (spec 26.3): each row states its formula and inputs. */
export function deriveCalculations(ms: Measurement[]): DerivedRow[] {
  const rows: DerivedRow[] = [];
  const v = (id: string) => latest(ms, id)?.value ?? null;
  const edv = v('lv-edv-simpson'),
    esv = v('lv-esv-simpson');
  if (edv !== null && esv !== null && edv > 0) {
    rows.push({
      id: 'ef-simpson',
      label: 'FEVI (Simpson)',
      value: `${(((edv - esv) / edv) * 100).toFixed(0)} %`,
      formula: '(VTD − VTS) / VTD',
      inputs: `VTD ${edv.toFixed(0)} mL, VTS ${esv.toFixed(0)} mL`,
    });
    rows.push({
      id: 'sv-simpson',
      label: 'Volumen sistólico (Simpson)',
      value: `${(edv - esv).toFixed(0)} mL`,
      formula: 'VTD − VTS',
      inputs: `VTD ${edv.toFixed(0)} mL, VTS ${esv.toFixed(0)} mL`,
    });
  }
  const lvotD = v('lvot-diameter'),
    lvotVti = v('lvot-vti');
  let lvotArea: number | null = null;
  if (lvotD !== null) {
    lvotArea = Math.PI * (lvotD / 2) * (lvotD / 2);
    rows.push({
      id: 'lvot-area',
      label: 'Área del TSVI',
      value: `${lvotArea.toFixed(2)} cm²`,
      formula: 'π·(D/2)²',
      inputs: `D ${lvotD.toFixed(2)} cm`,
    });
  }
  if (lvotArea !== null && lvotVti !== null) {
    rows.push({
      id: 'sv-doppler',
      label: 'Volumen sistólico (Doppler)',
      value: `${(lvotArea * lvotVti).toFixed(0)} mL`,
      formula: 'Área TSVI × VTI TSVI',
      inputs: `${lvotArea.toFixed(2)} cm² × ${lvotVti.toFixed(1)} cm`,
    });
    const avVti = v('av-vti');
    if (avVti !== null && avVti > 0) {
      rows.push({
        id: 'ava-continuity',
        label: 'AVA por continuidad',
        value: `${((lvotArea * lvotVti) / avVti).toFixed(2)} cm²`,
        formula: 'Área TSVI × VTI TSVI / VTI VAo',
        inputs: `${lvotArea.toFixed(2)} cm² × ${lvotVti.toFixed(1)} cm / ${avVti.toFixed(1)} cm`,
      });
      rows.push({
        id: 'velocity-ratio',
        label: 'Índice de velocidades (VTI)',
        value: (lvotVti / avVti).toFixed(2),
        formula: 'VTI TSVI / VTI VAo',
        inputs: `${lvotVti.toFixed(1)} / ${avVti.toFixed(1)}`,
      });
    }
  }
  const avVmax = v('av-vmax');
  if (avVmax !== null)
    rows.push({
      id: 'av-peak-gradient',
      label: 'Gradiente pico aórtico',
      value: `${(4 * avVmax * avVmax).toFixed(0)} mmHg`,
      formula: '4·Vmax²',
      inputs: `Vmax ${avVmax.toFixed(2)} m/s`,
    });
  const e = v('mitral-e'),
    a = v('mitral-a');
  if (e !== null && a !== null && a > 0)
    rows.push({
      id: 'e-a',
      label: 'Relación E/A',
      value: (e / a).toFixed(2),
      formula: 'E / A',
      inputs: `E ${e.toFixed(2)} m/s, A ${a.toFixed(2)} m/s`,
    });
  const es = v('e-prime-septal'),
    el = v('e-prime-lateral');
  if (e !== null && (es !== null || el !== null)) {
    const ep = es !== null && el !== null ? (es + el) / 2 : (es ?? el)!;
    rows.push({
      id: 'e-eprime',
      label: `E/e′ ${es !== null && el !== null ? 'promedio' : es !== null ? 'septal' : 'lateral'}`,
      value: ((e * 100) / ep).toFixed(1),
      formula: 'E / e′',
      inputs: `E ${(e * 100).toFixed(0)} cm/s, e′ ${ep.toFixed(1)} cm/s`,
    });
  }
  const tr = v('tr-vmax');
  if (tr !== null)
    rows.push({
      id: 'rvsp',
      label: 'PSVD estimada (PAD 3 mmHg)',
      value: `${(4 * tr * tr + 3).toFixed(0)} mmHg`,
      formula: '4·Vmax IT² + PAD',
      inputs: `Vmax IT ${tr.toFixed(2)} m/s, PAD 3 mmHg (asumida)`,
    });
  return rows;
}

/** Educational impression lines for the modelled pathologies (thresholds: ASE/EACVI, see docs/REFERENCES.md). */
export function pathologyImpressions(t: StructuredEchoTruth): string[] {
  const out: string[] = [];
  if (t.lv.efPct < 41)
    out.push(
      `Disfunción sistólica ${t.lv.efPct < 30 ? 'severa' : 'moderada'} del VI (FEVI ${t.lv.efPct.toFixed(0)} %).`,
    );
  if (t.wallMotion.abnormalSegments.length) out.push(`${t.wallMotion.description}.`);
  const mr = t.regurgitation.mr;
  if (mr) {
    const grade = mr.eroaCm2 >= 0.4 ? 'severa' : mr.eroaCm2 >= 0.2 ? 'moderada' : 'leve';
    out.push(
      `Insuficiencia mitral ${grade} (ORE ${mr.eroaCm2.toFixed(2)} cm², volumen regurgitante ${mr.regurgitantVolumeMl.toFixed(0)} mL, fracción ${mr.regurgitantFractionPct.toFixed(0)} %)${Math.abs(mr.jetDirectionDeg) > 15 ? ', chorro excéntrico' : ''}.`,
    );
  }
  const ar = t.regurgitation.ar;
  if (ar) {
    const grade = ar.eroaCm2 >= 0.3 ? 'severa' : ar.eroaCm2 >= 0.1 ? 'moderada' : 'leve';
    out.push(
      `Insuficiencia aórtica ${grade} (ORE ${ar.eroaCm2.toFixed(2)} cm², PHT ${ar.phtMs.toFixed(0)} ms, volumen regurgitante ${ar.regurgitantVolumeMl.toFixed(0)} mL).`,
    );
  }
  if (t.lvot.peakGradientMmHg >= 30)
    out.push(
      `Obstrucción ${t.lvot.dynamicObstruction ? 'dinámica' : 'fija'} del TSVI con gradiente pico ${t.lvot.peakGradientMmHg.toFixed(0)} mmHg${t.lvot.peakGradientMmHg >= 50 ? ' (significativa)' : ''}.`,
    );
  if (t.lv.ivsdCm >= 1.5 && t.lv.ivsdCm / Math.max(0.5, t.lv.lvpwdCm) >= 1.3)
    out.push(
      `Hipertrofia septal asimétrica (SIV ${t.lv.ivsdCm.toFixed(1)} cm, SIV/PP ${(t.lv.ivsdCm / t.lv.lvpwdCm).toFixed(1)}).`,
    );
  if (t.rightHeart.rvspMmHg !== null && t.rightHeart.rvspMmHg >= 36)
    out.push(
      `Presión sistólica del VD estimada ${t.rightHeart.rvspMmHg.toFixed(0)} mmHg (${t.rightHeart.rvspMmHg >= 50 ? 'probabilidad alta' : 'probabilidad intermedia'} de hipertensión pulmonar).`,
    );
  if (t.rv.basalDiameterCm > 4.1)
    out.push(
      `Ventrículo derecho dilatado (diámetro basal ${t.rv.basalDiameterCm.toFixed(1)} cm)${t.rv.septalFlattening > 0.3 ? ' con septo aplanado (sobrecarga de presión)' : ''}${t.rightHeart.tapseCm < 1.7 ? `; TAPSE reducido (${t.rightHeart.tapseCm.toFixed(1)} cm)` : ''}.`,
    );
  if (t.pericardium.effusionCm > 0) {
    const size =
      t.pericardium.effusionCm >= 2
        ? 'severo'
        : t.pericardium.effusionCm >= 1
          ? 'moderado'
          : 'leve';
    out.push(
      `Derrame pericárdico ${size} (${t.pericardium.effusionCm.toFixed(1)} cm)${t.pericardium.tamponade > 0.3 ? ' con signos de taponamiento (colapso del VD y de la AD, corazón oscilante)' : ''}.`,
    );
  }
  if (t.rhythm === 'atrial-fibrillation')
    out.push(
      'Fibrilación auricular: sin onda A; la evaluación diastólica se limita a E/e′, tiempo de desaceleración, volumen de la AI e IT, promediando varios latidos.',
    );
  if (t.la.volumeIndexMlM2 > 34)
    out.push(`Aurícula izquierda dilatada (${t.la.volumeIndexMlM2.toFixed(0)} mL/m²).`);
  return out;
}

function matchTruth(
  m: Measurement,
  t: StructuredEchoTruth,
): { value: number; text: string } | null {
  if (m.measurementId) {
    const spec = getMeasurementSpec(m.measurementId);
    const val = spec ? spec.truth(t) : null;
    if (val === null || val === undefined) return null;
    const fmt =
      m.kind === 'velocity' && m.units === 'm/s'
        ? formatClinical(val, 'velocityMps')
        : m.kind === 'vti'
          ? formatClinical(val, 'vtiCm')
          : m.kind === 'linear'
            ? formatClinical(val, 'linearCm')
            : `${val.toFixed(m.kind === 'time' || m.kind === 'volume' ? 0 : 1)} ${m.units}`;
    return { value: val, text: fmt };
  }
  // Heuristic mapping by kind + modality; explicit labels can be attached by the measurement tools later.
  if (m.kind === 'velocity' && (m.modality === 'cw' || m.modality === 'pw')) {
    // choose the closest plausible source: AV Vmax, LVOT Vmax, E, TR
    const candidates = [
      t.aorticValve.vmaxMps,
      t.lvot.vmaxMps,
      t.mitral.ePeakMps,
      t.rightHeart.trVmaxMps ?? 0,
    ].filter((v) => v > 0);
    const best = candidates.reduce((a, b) =>
      Math.abs(b - m.value) < Math.abs(a - m.value) ? b : a,
    );
    return { value: best, text: formatClinical(best, 'velocityMps') };
  }
  if (m.kind === 'vti') {
    const candidates = [t.aorticValve.vtiCm, t.lvot.vtiCm];
    const best = candidates.reduce((a, b) =>
      Math.abs(b - m.value) < Math.abs(a - m.value) ? b : a,
    );
    return { value: best, text: formatClinical(best, 'vtiCm') };
  }
  if (m.kind === 'linear') {
    const candidates = [
      t.lv.eddCm,
      t.lvot.diameterCm,
      t.lv.ivsdCm,
      t.la.apDiameterCm,
      t.aorta.sinusCm,
    ];
    const best = candidates.reduce((a, b) =>
      Math.abs(b - m.value) < Math.abs(a - m.value) ? b : a,
    );
    return { value: best, text: formatClinical(best, 'linearCm') };
  }
  return null;
}
