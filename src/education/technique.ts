import type { MeasurementSpec, PhaseRequirement } from '@/simulator/measurements/protocol';
import { Structure, Tissue } from '@/simulator/anatomy/tissue';

/**
 * Technique evaluation (spec 16.6, 28): grades HOW a measurement was taken, independently of the
 * number. Each check yields a finding with a level; the technique score is the product of the
 * level factors (ok 1, warn 0.75, invalid 0.3). Deterministic and explainable: every finding
 * carries the causal message shown in the report.
 */
export type FindingLevel = 'ok' | 'warn' | 'invalid';
export interface TechniqueFinding {
  code: string;
  level: FindingLevel;
  message: string;
}
export interface TechniqueResult {
  score: number; // 0..1
  findings: TechniqueFinding[];
}

/** Cardiac phase landmarks as fractions of the RR interval (from the beat tables). */
export interface PhaseMarks {
  ejectionStart: number;
  ejectionEnd: number;
  mitralOpen: number;
  eEnd: number;
  aStart: number;
  aEnd: number;
  hasAWave: boolean;
}

export interface GateContext {
  /** structure and tissue at the sample volume (PW/TDI) */
  structure: number;
  tissue: number;
  /** flow present at the gate and beam–flow angle (velocity measurements) */
  flowPresent: boolean;
  flowAngleDeg: number | null;
  /** structures crossed by the cursor line (CW, M-mode) */
  lineStructures: number[];
}

export interface MeasurementContext {
  modality: string;
  viewId: string | null;
  viewScore: number | null;
  phase: number;
  phaseMarks: PhaseMarks | null;
  gate: GateContext | null;
  /** for caliper segments: structure ids sampled along the segment (inside → both ends), and just beyond each end */
  segmentStructures?: number[];
  segmentEndsOutside?: [number, number];
  /** for Simpson traces: traced long axis vs the model's LV length (foreshortening) */
  longAxisCm?: number;
  trueLongAxisCm?: number;
  /** user assisted (auto-trace) */
  userAssisted?: boolean;
}

const LEVEL_FACTOR: Record<FindingLevel, number> = { ok: 1, warn: 0.75, invalid: 0.3 };

const BLOOD_STRUCTURES = new Set<number>([Structure.LvCavity, Structure.RvCavity, Structure.LaCavity, Structure.RaCavity, Structure.Lvot, Structure.AorticRoot, Structure.Rvot, Structure.LaAppendage, Structure.PulmonaryVein, Structure.CoronarySinus, Structure.DescendingAorta, Structure.PulmonaryArtery, Structure.Svc, Structure.Ivc, Structure.HepaticVein]);

function phaseWindow(req: PhaseRequirement, m: PhaseMarks): { lo: number; hi: number; label: string } | null {
  switch (req) {
    case 'ed':
      return { lo: -0.06, hi: 0.04, label: 'telediástole (inicio del QRS)' };
    case 'es':
      return { lo: m.ejectionEnd - 0.05, hi: m.ejectionEnd + 0.05, label: 'telesístole (fin de la eyección)' };
    case 'mid-systole':
      return { lo: m.ejectionStart + 0.15 * (m.ejectionEnd - m.ejectionStart), hi: m.ejectionStart + 0.7 * (m.ejectionEnd - m.ejectionStart), label: 'mesosístole (válvula aórtica abierta)' };
    case 'systole':
      return { lo: m.ejectionStart - 0.02, hi: m.ejectionEnd + 0.02, label: 'sístole' };
    case 'early-diastole':
      return { lo: m.mitralOpen - 0.02, hi: m.eEnd + 0.05, label: 'diástole precoz (onda E)' };
    case 'late-diastole':
      return m.hasAWave ? { lo: m.aStart - 0.02, hi: m.aEnd + 0.03, label: 'diástole tardía (onda A)' } : null;
    default:
      return null;
  }
}

function inWindow(phase: number, lo: number, hi: number): boolean {
  const p = ((phase % 1) + 1) % 1;
  // windows may wrap around 0
  const test = (x: number) => x >= lo && x <= hi;
  return test(p) || test(p - 1) || test(p + 1);
}

export function evaluateTechnique(spec: MeasurementSpec, ctx: MeasurementContext): TechniqueResult {
  const findings: TechniqueFinding[] = [];
  const add = (code: string, level: FindingLevel, message: string) => findings.push({ code, level, message });

  // modality
  const modalityFamily = ctx.modality === 'color' ? '2d' : ctx.modality;
  if (!spec.modalities.includes(modalityFamily as MeasurementSpec['modalities'][number])) add('modality', 'invalid', `Modalidad ${ctx.modality.toUpperCase()} no válida para ${spec.label}: requiere ${spec.modalities.map((m) => m.toUpperCase()).join('/')}.`);
  else add('modality', 'ok', `Modalidad ${ctx.modality.toUpperCase()} adecuada.`);

  // view
  if (!ctx.viewId || !spec.views.includes(ctx.viewId)) add('view', 'invalid', `Vista ${ctx.viewId ? ctx.viewId.toUpperCase() : 'no reconocida'}: ${spec.label} se mide en ${spec.views.map((v) => v.toUpperCase()).join('/')}.`);
  else if ((ctx.viewScore ?? 0) < 35) add('view-quality', 'invalid', `Vista ${ctx.viewId.toUpperCase()} con calidad ${ctx.viewScore ?? 0}/100: plano oblicuo o incompleto; la medida no es válida aunque el número coincida.`);
  else if ((ctx.viewScore ?? 0) < 55) add('view-quality', 'warn', `Vista ${ctx.viewId.toUpperCase()} con calidad ${ctx.viewScore}/100: optimiza el plano antes de medir.`);
  else add('view', 'ok', `Vista ${ctx.viewId.toUpperCase()} con calidad ${ctx.viewScore}/100.`);

  // phase (only for frame-based measurements; spectral tools pick their own instant)
  if (ctx.phaseMarks && spec.phase !== 'any' && (spec.tool === 'caliper' || spec.tool === 'simpson')) {
    const w = phaseWindow(spec.phase, ctx.phaseMarks);
    if (w) {
      if (inWindow(ctx.phase, w.lo, w.hi)) add('phase', 'ok', `Cuadro en ${w.label}.`);
      else {
        // how far from the window (fraction of RR)
        const p = ((ctx.phase % 1) + 1) % 1;
        const dist = Math.min(Math.abs(p - w.lo), Math.abs(p - w.hi), Math.abs(p - 1 - w.lo), Math.abs(p + 1 - w.hi));
        add('phase', dist > 0.12 ? 'invalid' : 'warn', `Cuadro fuera de ${w.label} (fase ${(p * 100).toFixed(0)} % del ciclo): usa el cine para elegir el cuadro correcto.`);
      }
    }
  }

  // placement
  if (spec.placement) {
    const pl = spec.placement;
    if (spec.tool === 'velocity' || spec.tool === 'vti' || spec.tool === 'auto-vti' || spec.tool === 'slope' || spec.tool === 'tapse') {
      const g = ctx.gate;
      if (!g) add('placement', 'warn', 'Sin información del volumen de muestra.');
      else if (modalityFamily === 'pw' || modalityFamily === 'tdi') {
        if (pl.structures.includes(g.structure)) add('placement', 'ok', `Volumen de muestra en ${pl.label}.`);
        else add('placement', 'invalid', `Volumen de muestra fuera de posición (${structureName(g.structure)}): debe estar en ${pl.label}.`);
      } else {
        // CW / M-mode: the cursor line must cross the target
        const hit = g.lineStructures.some((s) => pl.structures.includes(s));
        if (hit) add('placement', 'ok', `Línea del cursor a través de ${pl.label}.`);
        else add('placement', 'invalid', `La línea del cursor no atraviesa ${pl.label}.`);
      }
    } else if (spec.tool === 'caliper' && ctx.segmentStructures && ctx.segmentStructures.length > 2) {
      const seg = ctx.segmentStructures;
      const n = seg.length;
      const inTarget = seg.filter((s) => pl.structures.includes(s)).length / n;
      if (pl.segment === 'cavity') {
        const blood = seg.filter((s) => BLOOD_STRUCTURES.has(s)).length / n;
        if (inTarget < 0.5) add('placement', 'invalid', `El caliper no está sobre ${pl.label} (${(inTarget * 100).toFixed(0)} % del segmento en la estructura esperada).`);
        else if (blood < 0.8) add('placement', 'warn', `El caliper incluye pared (${((1 - blood) * 100).toFixed(0)} % del segmento fuera de la cavidad): mide de borde interno a borde interno.`);
        else add('placement', 'ok', `Caliper sobre ${pl.label}.`);
        const ends = ctx.segmentEndsOutside;
        if (ends && blood >= 0.8) {
          const endsOnTissue = ends.filter((s) => !BLOOD_STRUCTURES.has(s) && s !== Structure.None).length;
          if (endsOnTissue < 2) add('edges', 'warn', 'Un extremo del caliper queda dentro de la cavidad, no sobre el borde endocárdico: la medida subestima el diámetro.');
          else add('edges', 'ok', 'Extremos sobre los bordes endocárdicos.');
        }
      } else {
        if (inTarget < 0.6) add('placement', 'invalid', `El caliper no atraviesa ${pl.label} (${(inTarget * 100).toFixed(0)} % del segmento en la pared).`);
        else if (inTarget < 0.85) add('placement', 'warn', `El caliper se sale de la pared (${(inTarget * 100).toFixed(0)} % del segmento en la pared): ajusta los extremos a los bordes.`);
        else add('placement', 'ok', `Caliper a través de ${pl.label}.`);
      }
    } else if (spec.tool === 'simpson' && ctx.segmentStructures && ctx.segmentStructures.length) {
      const inside = ctx.segmentStructures.filter((s) => pl.structures.includes(s) || s === Structure.PapillaryMuscle).length / ctx.segmentStructures.length;
      if (inside < 0.7) add('placement', 'invalid', `El trazado no sigue el endocardio del VI (${(inside * 100).toFixed(0)} % del área dentro de la cavidad).`);
      else if (inside < 0.85) add('placement', 'warn', 'El trazado se aleja del endocardio en parte del contorno.');
      else add('placement', 'ok', 'Trazado sobre el endocardio del VI.');
    }
  }

  // alignment
  if (spec.maxAngleDeg !== undefined && ctx.gate) {
    const a = ctx.gate.flowAngleDeg;
    if (a === null || !ctx.gate.flowPresent) add('alignment', 'warn', 'Sin flujo en el volumen de muestra en el instante de la medida: no se puede juzgar la alineación.');
    else if (a <= spec.maxAngleDeg) add('alignment', 'ok', `Ángulo haz–flujo ${a.toFixed(0)}° (≤ ${spec.maxAngleDeg}°).`);
    else if (a <= spec.maxAngleDeg + 12) add('alignment', 'warn', `Ángulo haz–flujo ${a.toFixed(0)}°: la velocidad se subestima un ${((1 - Math.cos((a * Math.PI) / 180)) * 100).toFixed(0)} % (cos θ).`);
    else add('alignment', 'invalid', `Ángulo haz–flujo ${a.toFixed(0)}°: subestimación del ${((1 - Math.cos((a * Math.PI) / 180)) * 100).toFixed(0)} %; realinea la sonda con el chorro.`);
  }

  // foreshortening (Simpson)
  if (spec.tool === 'simpson' && ctx.longAxisCm !== undefined && ctx.trueLongAxisCm !== undefined && ctx.trueLongAxisCm > 0) {
    const ratio = ctx.longAxisCm / ctx.trueLongAxisCm;
    if (ratio < 0.82) add('foreshortening', 'invalid', `Ápex acortado: longitud trazada ${ctx.longAxisCm.toFixed(1)} cm frente a ${ctx.trueLongAxisCm.toFixed(1)} cm del modelo (${((1 - ratio) * 100).toFixed(0)} % menos); el volumen se subestima.`);
    else if (ratio < 0.92) add('foreshortening', 'warn', `Ligero acortamiento apical (longitud ${ctx.longAxisCm.toFixed(1)} vs ${ctx.trueLongAxisCm.toFixed(1)} cm).`);
    else add('foreshortening', 'ok', 'Eje largo completo (sin acortamiento).');
  }
  if (ctx.userAssisted) add('assisted', 'ok', 'Envolvente trazada automáticamente; revisa que siga la señal más densa.');

  let score = 1;
  for (const f of findings) score *= LEVEL_FACTOR[f.level];
  return { score, findings };
}

export function structureName(id: number): string {
  const names: Partial<Record<number, string>> = {
    [Structure.None]: 'fuera del corazón',
    [Structure.LvCavity]: 'cavidad del VI',
    [Structure.LvWallSeptal]: 'septo',
    [Structure.LvWallLateral]: 'pared lateral del VI',
    [Structure.LvWallAnterior]: 'pared anterior del VI',
    [Structure.LvWallInferior]: 'pared inferior del VI',
    [Structure.LvApex]: 'ápex del VI',
    [Structure.PapillaryMuscle]: 'músculo papilar',
    [Structure.RvCavity]: 'cavidad del VD',
    [Structure.RvWall]: 'pared libre del VD',
    [Structure.Rvot]: 'TSVD',
    [Structure.PulmonaryArtery]: 'arteria pulmonar',
    [Structure.Svc]: 'vena cava superior',
    [Structure.Ivc]: 'vena cava inferior',
    [Structure.HepaticVein]: 'vena hepática',
    [Structure.Diaphragm]: 'diafragma',
    [Structure.RvPapillary]: 'músculo papilar del VD',
    [Structure.LaCavity]: 'aurícula izquierda',
    [Structure.LaWall]: 'pared de la AI',
    [Structure.RaCavity]: 'aurícula derecha',
    [Structure.RaWall]: 'pared de la AD',
    [Structure.MitralAnterior]: 'valva mitral anterior',
    [Structure.MitralPosterior]: 'valva mitral posterior',
    [Structure.TricuspidValve]: 'válvula tricúspide',
    [Structure.AorticValve]: 'válvula aórtica',
    [Structure.AorticRoot]: 'raíz aórtica',
    [Structure.Lvot]: 'TSVI',
    [Structure.PulmonaryValve]: 'válvula pulmonar',
    [Structure.InteratrialSeptum]: 'septo interauricular',
    [Structure.MitralAnnulus]: 'anillo mitral',
    [Structure.TricuspidAnnulus]: 'anillo tricuspídeo',
    [Structure.Chordae]: 'cuerdas tendinosas',
    [Structure.Pericardium]: 'pericardio',
    [Structure.ModeratorBand]: 'banda moderadora',
    [Structure.LaAppendage]: 'orejuela izquierda',
    [Structure.PulmonaryVein]: 'vena pulmonar',
    [Structure.CoronarySinus]: 'seno coronario',
    [Structure.Lung]: 'pulmón',
    [Structure.Rib]: 'costilla',
    [Structure.ChestWall]: 'pared torácica',
    [Structure.DescendingAorta]: 'aorta descendente',
  };
  return names[id] ?? `estructura ${id}`;
}

/** Tissue helper for callers building contexts from polar maps. */
export const isBloodTissue = (t: number): boolean => t === Tissue.Blood;
