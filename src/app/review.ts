import type { ProbePointInfo, SimInput, SimOutput } from '@/simulator/core/protocol';
import type { ImagingModality } from '@/simulator/renderer/types';
import type { SectorMapping } from '@/simulator/renderer/scanConvert';
import { Structure, Tissue } from '@/simulator/anatomy/tissue';

/**
 * Review mode (decision 134): the exchange format between whoever looks at the image and whoever changes
 * the model. A report carries the exact simulator input (so the frame can be reproduced offline with the
 * same seed), the frame's identity (phase, view analysis) and numbered markers placed on the image, each
 * with what the model holds there and a free note. Pure functions: no store, no DOM.
 */
export type ReviewCategory =
  'anatomia' | 'movimiento' | 'textura' | 'doppler' | 'vista' | 'interfaz' | 'otro';

export const REVIEW_CATEGORIES: { id: ReviewCategory; label: string }[] = [
  { id: 'anatomia', label: 'Anatomía / forma' },
  { id: 'movimiento', label: 'Movimiento / ciclo' },
  { id: 'textura', label: 'Textura / brillo' },
  { id: 'doppler', label: 'Doppler / tira' },
  { id: 'vista', label: 'Vista / plano' },
  { id: 'interfaz', label: 'Interfaz' },
  { id: 'otro', label: 'Otro' },
];

export interface ReviewMarker {
  id: string;
  /** 1-based number shown on the image. */
  n: number;
  /** Display pixel where it was placed and the sector mapping of that moment (reprojected on resize/zoom). */
  x: number;
  y: number;
  captureSector: SectorMapping;
  /** Polar position in the sector; null when the click fell on a strip. */
  rCm: number | null;
  thetaRad: number | null;
  /** Strip coordinates when the click fell on a spectral or M-mode strip. */
  strip: { kind: 'spectral' | 'm-mode'; column: number; value: number } | null;
  frameId: number;
  phase: number;
  modality: ImagingModality;
  /** Structure id from the frame's own structure map at the click (0 on strips). */
  structure: number;
  /** The worker's classification of the point (arrives asynchronously; null on strips). */
  point: ProbePointInfo | null;
  note: string;
  category: ReviewCategory;
}

export interface ReviewReport {
  format: 'echotwin-review';
  version: 1;
  createdAt: string;
  author: 'usuario' | 'claude';
  app: { url: string };
  caseId: string;
  caseTitle: string;
  mode: string;
  workerMode: string;
  /** The exact simulator input of the frame: replaying it reproduces the image (deterministic seed). */
  input: SimInput;
  frame: {
    frameId: number;
    phase: number;
    timeS: number;
    beatIndex: number;
    heartRateBpm: number;
    view: SimOutput['view'];
    backend: string;
  } | null;
  note: string;
  markers: ReviewMarker[];
}

export interface ReviewSnapshot {
  caseId: string;
  caseTitle: string;
  mode: string;
  workerMode: string;
  input: SimInput;
  hud: SimOutput | null;
  note: string;
  markers: ReviewMarker[];
  author?: ReviewReport['author'];
  url?: string;
}

export const STRUCTURE_LABELS: Record<number, string> = {
  [Structure.None]: 'fuera del modelo',
  [Structure.LvCavity]: 'cavidad del VI',
  [Structure.LvWallSeptal]: 'pared septal del VI',
  [Structure.LvWallLateral]: 'pared lateral del VI',
  [Structure.LvWallAnterior]: 'pared anterior del VI',
  [Structure.LvWallInferior]: 'pared inferior del VI',
  [Structure.LvApex]: 'ápex del VI',
  [Structure.RvCavity]: 'cavidad del VD',
  [Structure.RvWall]: 'pared libre del VD',
  [Structure.LaCavity]: 'aurícula izquierda',
  [Structure.LaWall]: 'pared de la AI',
  [Structure.RaCavity]: 'aurícula derecha',
  [Structure.RaWall]: 'pared de la AD',
  [Structure.MitralAnterior]: 'velo mitral anterior',
  [Structure.MitralPosterior]: 'velo mitral posterior',
  [Structure.AorticValve]: 'válvula aórtica',
  [Structure.TricuspidValve]: 'válvula tricúspide',
  [Structure.AorticRoot]: 'raíz aórtica',
  [Structure.Lvot]: 'TSVI',
  [Structure.Rvot]: 'TSVD',
  [Structure.PapillaryMuscle]: 'músculo papilar',
  [Structure.Pericardium]: 'pericardio',
  [Structure.PericardialEffusion]: 'derrame pericárdico',
  [Structure.DescendingAorta]: 'aorta descendente',
  [Structure.Ivc]: 'vena cava inferior',
  [Structure.ChestWall]: 'pared torácica',
  [Structure.Rib]: 'costilla',
  [Structure.Sternum]: 'esternón',
  [Structure.Lung]: 'pulmón',
  [Structure.Liver]: 'hígado',
  [Structure.Spine]: 'columna',
  [Structure.InteratrialSeptum]: 'tabique interauricular',
  [Structure.PulmonaryValve]: 'válvula pulmonar',
  [Structure.MitralAnnulus]: 'anillo mitral',
  [Structure.TricuspidAnnulus]: 'anillo tricúspide',
  [Structure.Chordae]: 'cuerdas tendinosas',
  [Structure.ModeratorBand]: 'banda moderadora',
  [Structure.LaAppendage]: 'orejuela izquierda',
  [Structure.PulmonaryVein]: 'vena pulmonar',
  [Structure.CoronarySinus]: 'seno coronario',
  [Structure.PulmonaryArtery]: 'arteria pulmonar',
  [Structure.RvPapillary]: 'papilar del VD',
  [Structure.Svc]: 'vena cava superior',
  [Structure.HepaticVein]: 'vena hepática',
  [Structure.Diaphragm]: 'diafragma',
  [Structure.EpicardialFat]: 'grasa epicárdica',
};

export const TISSUE_LABELS: Record<number, string> = {
  [Tissue.None]: '—',
  [Tissue.Blood]: 'sangre',
  [Tissue.Myocardium]: 'miocardio',
  [Tissue.Valve]: 'válvula',
  [Tissue.Pericardium]: 'pericardio',
  [Tissue.Fat]: 'grasa',
  [Tissue.Muscle]: 'músculo',
  [Tissue.Bone]: 'hueso',
  [Tissue.Cartilage]: 'cartílago',
  [Tissue.Lung]: 'pulmón',
  [Tissue.Fluid]: 'líquido',
  [Tissue.VesselWall]: 'pared vascular',
  [Tissue.Calcium]: 'calcio',
  [Tissue.Skin]: 'piel',
  [Tissue.Liver]: 'hígado',
  [Tissue.Spine]: 'columna',
  [Tissue.Fibrous]: 'tejido fibroso',
  [Tissue.Chordae]: 'cuerdas',
};

export function structureLabel(id: number): string {
  return STRUCTURE_LABELS[id] ?? `estructura ${id}`;
}

export function tissueLabel(id: number): string {
  return TISSUE_LABELS[id] ?? `tejido ${id}`;
}

const deg = (rad: number): string => `${((rad * 180) / Math.PI).toFixed(0)}°`;
const f1 = (v: number): string => v.toFixed(1);
const f2 = (v: number): string => v.toFixed(2);

/** Where a marker sits, in the words the model uses: structure, tissue, polar position and local coordinates. */
export function markerPlace(m: ReviewMarker): string {
  if (m.strip)
    return `tira ${m.strip.kind === 'spectral' ? 'espectral' : 'modo M'} · columna ${m.strip.column.toFixed(0)} · ${m.strip.kind === 'spectral' ? `${f2(m.strip.value)} m/s` : `${f1(m.strip.value)} cm`}`;
  const parts: string[] = [];
  const p = m.point;
  parts.push(structureLabel(p ? p.structure : m.structure));
  if (p) parts.push(tissueLabel(p.tissue));
  if (m.rCm !== null && m.thetaRad !== null) parts.push(`${f1(m.rCm)} cm · ${deg(m.thetaRad)}`);
  if (p) {
    parts.push(`corazón (${f1(p.heart.x)}, ${f1(p.heart.y)}, ${f1(p.heart.z)})`);
    if (p.levelFrac !== null && p.azRad !== null)
      parts.push(`nivel ${f2(p.levelFrac)} · acimut ${deg(p.azRad)}`);
    if (p.rootT !== null && p.rootR !== null) parts.push(`raíz t ${f2(p.rootT)} r ${f2(p.rootR)}`);
    parts.push(`sdf ${f2(p.sdfCm)}`);
  }
  return parts.join(' · ');
}

export function buildReviewReport(s: ReviewSnapshot): ReviewReport {
  const hud = s.hud;
  return {
    format: 'echotwin-review',
    version: 1,
    createdAt: new Date().toISOString(),
    author: s.author ?? 'usuario',
    app: { url: s.url ?? '' },
    caseId: s.caseId,
    caseTitle: s.caseTitle,
    mode: s.mode,
    workerMode: s.workerMode,
    input: s.input,
    frame: hud
      ? {
          frameId: hud.frameId,
          phase: hud.phase,
          timeS: hud.timeS,
          beatIndex: hud.beatIndex,
          heartRateBpm: hud.heartRateBpm,
          view: hud.view,
          backend: String(hud.stats['backend'] ?? ''),
        }
      : null,
    note: s.note,
    markers: s.markers,
  };
}

const PATIENT_POSITION: Record<string, string> = {
  'left-lateral': 'decúbito lateral izquierdo',
  supine: 'supino',
  'subcostal-supine': 'supino (subcostal)',
};
const RESPIRATION: Record<string, string> = {
  expiration: 'espiración',
  inspiration: 'inspiración',
  'breath-hold': 'apnea',
  'free-breathing': 'respiración libre',
};

function phaseName(phase: number): string {
  if (phase < 0.05 || phase >= 0.95) return 'telediástole';
  if (phase < 0.4) return 'sístole';
  if (phase < 0.5) return 'telesístole';
  if (phase < 0.75) return 'diástole precoz';
  return 'diástole tardía';
}

/** The report as the text pasted into a conversation: readable lines first, the JSON (exact state) after. */
export function reportToMarkdown(r: ReviewReport): string {
  const i = r.input;
  const s = i.settings;
  const lines: string[] = [];
  lines.push(`## Informe de revisión EchoTwin — ${r.createdAt.slice(0, 16).replace('T', ' ')}`);
  lines.push('');
  lines.push(`Caso: ${r.caseId} (${r.caseTitle}) · modo ${r.mode} · núcleo ${r.workerMode}`);
  lines.push(
    `Paciente: ${PATIENT_POSITION[i.patient.position] ?? i.patient.position}, ${RESPIRATION[i.patient.respiration] ?? i.patient.respiration}`,
  );
  lines.push(
    `Sonda: u ${f1(i.probe.u)} v ${f1(i.probe.v)} cm · rotación ${f1(i.probe.rotationDeg)}° · tilt ${f1(i.probe.tiltDeg)}° · rock ${f1(i.probe.rockDeg)}° · presión ${f2(i.probe.pressure)}`,
  );
  const v = r.frame?.view;
  if (v)
    lines.push(
      `Vista reconocida: ${v.bestViewName} (${v.bestViewId ?? '—'}, puntaje ${Math.round(v.score)}, acortamiento ${v.foreshorteningDeg.toFixed(0)}°, plano ${v.planeAngleDeg.toFixed(0)}°, desplazamiento ${v.offsetCm.toFixed(1)} cm)`,
    );
  lines.push(
    `Modalidad ${i.modality.toUpperCase()} · profundidad ${s.depthCm} cm · sector ${s.sectorDeg}° · ganancia ${s.gainDb} dB · ${s.frequencyMHz} MHz${s.harmonics ? ' THI' : ''} · foco ${s.focusCm} cm · zoom ${s.zoom} · rango ${s.dynamicRangeDb} dB · mapa ${s.grayMap} · persistencia ${s.persistence} · calidad ${i.quality} · backend ${i.rendererBackend}${r.frame?.backend ? ` (${r.frame.backend})` : ''}${s.invertLR ? ' · izq/der invertido' : ''}`,
  );
  if (i.modality === 'color')
    lines.push(
      `Color: escala ${f2(i.color.scaleMps)} m/s · caja r ${f1(i.color.boxRMinCm)}–${f1(i.color.boxRMaxCm)} cm, θ ${deg(i.color.boxThetaMinRad)}…${deg(i.color.boxThetaMaxRad)}`,
    );
  if (i.modality !== '2d' && i.modality !== 'color')
    lines.push(
      `Cursor ${deg(i.cursorThetaRad)} · compuerta ${f1(i.gateDepthCm)} cm (${f1(i.spectral.gateLengthCm)} cm) · escala ${f2(i.spectral.scaleMps)} m/s · barrido ${i.spectral.sweepSpeedMmPerS} mm/s`,
    );
  if (i.artifactOverrides)
    lines.push(`Laboratorio de artefactos: ${JSON.stringify(i.artifactOverrides)}`);
  if (r.frame)
    lines.push(
      `Cuadro ${r.frame.frameId} · fase ${f2(r.frame.phase)} (${phaseName(r.frame.phase)}) · latido ${r.frame.beatIndex} · FC ${Math.round(r.frame.heartRateBpm)} · ${i.frozen ? `congelado, cine ${i.cineOffset}` : 'en vivo'}`,
    );
  lines.push('');
  if (r.note.trim()) {
    lines.push(`Nota general: ${r.note.trim()}`);
    lines.push('');
  }
  if (r.markers.length) {
    lines.push('Marcadores:');
    for (const m of r.markers) {
      const cat = REVIEW_CATEGORIES.find((c) => c.id === m.category)?.label ?? m.category;
      lines.push(
        `${m.n}. [${cat}] ${markerPlace(m)} · fase ${f2(m.phase)}${m.note.trim() ? ` — «${m.note.trim()}»` : ''}`,
      );
    }
    lines.push('');
  }
  lines.push('```json');
  lines.push(JSON.stringify(r));
  lines.push('```');
  return lines.join('\n');
}

/** Reads a report back from raw JSON or from a pasted markdown that carries it in a ```json block. */
export function parseReviewReport(text: string): ReviewReport | null {
  const candidates: string[] = [text.trim()];
  const fenced = /```json\s*([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = fenced.exec(text)) !== null) candidates.push(m[1]!.trim());
  for (const c of candidates) {
    try {
      const obj = JSON.parse(c) as Partial<ReviewReport>;
      if (
        obj &&
        obj.format === 'echotwin-review' &&
        obj.input &&
        typeof obj.caseId === 'string' &&
        Array.isArray(obj.markers)
      )
        return { ...obj, note: obj.note ?? '', version: 1 } as ReviewReport;
    } catch {
      /* not this candidate */
    }
  }
  return null;
}
