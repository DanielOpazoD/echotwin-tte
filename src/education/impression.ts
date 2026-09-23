import { rangeFlag } from '@/clinical/guidelines/normalRanges';
import type { StructuredEchoTruth } from '@/simulator/hemodynamics/groundTruth';

/**
 * Structured impression (spec 26, 28.4): the learner selects findings from a fixed catalogue instead
 * of free text; the expected findings are derived from the model truth with guideline thresholds, so
 * the comparison is deterministic and explainable. Scored as F1 between selected and expected sets.
 */
export type FindingDomain =
  'lv' | 'valves' | 'right' | 'atria' | 'pericardium' | 'rhythm-diastole' | 'global';

export interface Finding {
  id: string;
  label: string;
  domain: FindingDomain;
  /** ids that contradict this one (only one of the group can be true) */
  exclusive?: string;
}

export const FINDINGS: Finding[] = [
  { id: 'normal-study', label: 'Estudio dentro de límites normales', domain: 'global' },
  { id: 'ef-normal', label: 'FEVI conservada (≥ 52 %)', domain: 'lv', exclusive: 'ef' },
  { id: 'ef-mild', label: 'Disfunción sistólica leve (41–51 %)', domain: 'lv', exclusive: 'ef' },
  {
    id: 'ef-moderate',
    label: 'Disfunción sistólica moderada (30–40 %)',
    domain: 'lv',
    exclusive: 'ef',
  },
  { id: 'ef-severe', label: 'Disfunción sistólica severa (< 30 %)', domain: 'lv', exclusive: 'ef' },
  { id: 'lv-dilated', label: 'Ventrículo izquierdo dilatado', domain: 'lv' },
  { id: 'lvh', label: 'Hipertrofia ventricular izquierda', domain: 'lv' },
  { id: 'asymmetric-septal-hypertrophy', label: 'Hipertrofia septal asimétrica', domain: 'lv' },
  { id: 'rwma', label: 'Alteración segmentaria de la motilidad', domain: 'lv' },
  { id: 'lvot-obstruction', label: 'Obstrucción dinámica del TSVI', domain: 'valves' },
  {
    id: 'as-none',
    label: 'Sin estenosis aórtica significativa',
    domain: 'valves',
    exclusive: 'as',
  },
  {
    id: 'as-mild',
    label: 'Estenosis aórtica leve / esclerosis',
    domain: 'valves',
    exclusive: 'as',
  },
  { id: 'as-moderate', label: 'Estenosis aórtica moderada', domain: 'valves', exclusive: 'as' },
  { id: 'as-severe', label: 'Estenosis aórtica severa', domain: 'valves', exclusive: 'as' },
  {
    id: 'mr-none',
    label: 'Sin insuficiencia mitral significativa',
    domain: 'valves',
    exclusive: 'mr',
  },
  { id: 'mr-mild', label: 'Insuficiencia mitral leve', domain: 'valves', exclusive: 'mr' },
  { id: 'mr-moderate', label: 'Insuficiencia mitral moderada', domain: 'valves', exclusive: 'mr' },
  { id: 'mr-severe', label: 'Insuficiencia mitral severa', domain: 'valves', exclusive: 'mr' },
  { id: 'mvp', label: 'Prolapso mitral', domain: 'valves' },
  { id: 'ar-present', label: 'Insuficiencia aórtica', domain: 'valves' },
  { id: 'rv-dilated', label: 'Ventrículo derecho dilatado', domain: 'right' },
  { id: 'rv-dysfunction', label: 'Disfunción sistólica del VD (TAPSE < 1,7 cm)', domain: 'right' },
  {
    id: 'ph-probable',
    label: 'Probabilidad alta de hipertensión pulmonar (PSVD ≥ 50)',
    domain: 'right',
  },
  { id: 'tr-significant', label: 'Insuficiencia tricuspídea moderada o mayor', domain: 'right' },
  { id: 'la-dilated', label: 'Aurícula izquierda dilatada (> 34 mL/m²)', domain: 'atria' },
  { id: 'effusion', label: 'Derrame pericárdico', domain: 'pericardium' },
  { id: 'tamponade', label: 'Signos de taponamiento', domain: 'pericardium' },
  { id: 'af', label: 'Fibrilación auricular', domain: 'rhythm-diastole' },
  {
    id: 'diastolic-dysfunction',
    label: 'Disfunción diastólica / presiones de llenado elevadas',
    domain: 'rhythm-diastole',
  },
];

export function getFinding(id: string): Finding | undefined {
  return FINDINGS.find((f) => f.id === id);
}

/** Expected findings for a case, derived from its structured truth with the thresholds of the guidelines used in the app. */
export function expectedFindings(t: StructuredEchoTruth): string[] {
  const out = new Set<string>();
  const ef = t.lv.efPct;
  out.add(ef >= 52 ? 'ef-normal' : ef >= 41 ? 'ef-mild' : ef >= 30 ? 'ef-moderate' : 'ef-severe');
  // the upper limits of the reference ranges for the patient's sex (decision 175): EDV index 74 (men) or 61 (women)
  // mL/m², end-diastolic diameter 5.8 or 5.2 cm; the male limits applied to everyone
  const edviHigh = t.sex === 'female' ? 61 : 74;
  if (t.lv.edvMl / t.bsaM2 > edviHigh || rangeFlag('lv-edd', t.sex, t.lv.eddCm) === 'high')
    out.add('lv-dilated');
  if (t.lv.ivsdCm >= 1.5 && t.lv.ivsdCm / Math.max(0.5, t.lv.lvpwdCm) >= 1.3)
    out.add('asymmetric-septal-hypertrophy');
  else if (t.lv.ivsdCm > 1.1 || t.lv.lvpwdCm > 1.1) out.add('lvh');
  if (t.wallMotion.abnormalSegments.length) out.add('rwma');
  if (t.lvot.peakGradientMmHg >= 30) out.add('lvot-obstruction');
  const av = t.aorticValve;
  if (av.vmaxMps >= 4 || av.meanGradientMmHg >= 40 || av.continuityAvaCm2 <= 1.0)
    out.add('as-severe');
  else if (av.vmaxMps >= 3) out.add('as-moderate');
  else if (av.vmaxMps >= 2) out.add('as-mild');
  else out.add('as-none');
  const mr = t.regurgitation.mr;
  if (!mr || mr.eroaCm2 < 0.1) out.add('mr-none');
  else if (mr.eroaCm2 >= 0.4) out.add('mr-severe');
  else if (mr.eroaCm2 >= 0.2) out.add('mr-moderate');
  else out.add('mr-mild');
  if (t.regurgitation.ar) out.add('ar-present');
  if (t.rv.basalDiameterCm > 4.1) out.add('rv-dilated');
  if (t.rightHeart.tapseCm < 1.7) out.add('rv-dysfunction');
  if ((t.rightHeart.rvspMmHg ?? 0) >= 50) out.add('ph-probable');
  if ((t.regurgitation.tr?.eroaCm2 ?? 0) >= 0.2) out.add('tr-significant');
  if (t.la.volumeIndexMlM2 > 34) out.add('la-dilated');
  if (t.pericardium.effusionCm > 0) out.add('effusion');
  if (t.pericardium.tamponade > 0.3) out.add('tamponade');
  if (t.rhythm === 'atrial-fibrillation') out.add('af');
  // an E/A above 2 alone is the filling of a young normal heart (decision 175): it marks dysfunction with another sign
  // of raised filling pressure — reduced e′, a TR velocity above 2.8 m/s or a dilated left atrium
  const eReduced =
    rangeFlag('e-prime-septal', t.sex, t.mitral.ePrimeSeptalCmps) === 'low' ||
    rangeFlag('e-prime-lateral', t.sex, t.mitral.ePrimeLateralCmps) === 'low';
  const trHigh = (t.rightHeart.trVmaxMps ?? 0) > 2.8;
  const otherSign = eReduced || trHigh || t.la.volumeIndexMlM2 > 34;
  if (
    t.mitral.eOverEPrimeAvg > 14 ||
    (t.mitral.eOverA !== null && t.mitral.eOverA > 2 && otherSign) ||
    (t.mitral.eOverA !== null && t.mitral.eOverA < 0.8 && t.la.volumeIndexMlM2 > 34)
  )
    out.add('diastolic-dysfunction');
  // a study with only the "normal/none" statements is a normal study
  const abnormal = [...out].filter((id) => !['ef-normal', 'as-none', 'mr-none'].includes(id));
  if (abnormal.length === 0) out.add('normal-study');
  return [...out];
}

export interface ImpressionScore {
  score: number; // 0..100 (F1)
  correct: string[];
  missed: string[];
  wrong: string[];
}

/** F1 between the learner's selection and the expected findings; "normal/none" statements count like any other. */
export function scoreImpression(
  selected: readonly string[],
  expected: readonly string[],
): ImpressionScore {
  const sel = new Set(selected);
  const exp = new Set(expected);
  const correct = [...sel].filter((id) => exp.has(id));
  const wrong = [...sel].filter((id) => !exp.has(id));
  const missed = [...exp].filter((id) => !sel.has(id));
  if (exp.size === 0) return { score: sel.size === 0 ? 100 : 0, correct, missed, wrong };
  const precision = sel.size ? correct.length / sel.size : 0;
  const recall = correct.length / exp.size;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return { score: Math.round(f1 * 100), correct, missed, wrong };
}
