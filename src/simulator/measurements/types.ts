import type { SectorMapping } from '../renderer/scanConvert';

/** How a measurement was taken, graded by education/technique.ts: one finding per check, levels multiply. */
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

/**
 * Measurement record (spec 16.6): every measurement keeps its provenance so scoring can judge
 * technique (view, frame, quality, alignment) and not only the number.
 */
export type MeasurementKind = 'linear' | 'velocity' | 'vti' | 'time' | 'area' | 'volume';

export interface Measurement {
  id: string;
  kind: MeasurementKind;
  /** Semantic id from the measurement protocol (e.g. 'lvot-diameter'); null for free measurements. */
  measurementId?: string | null;
  /** Technique evaluation captured at commit time (see education/technique.ts). */
  technique?: TechniqueResult | null;
  label: string;
  value: number;
  units: string;
  modality: string;
  sourceViewId: string | null;
  viewScore: number | null;
  frameId: number;
  phase: number;
  timeS: number;
  geometry: { x: number; y: number }[]; // display pixels at capture
  captureSector?: SectorMapping;
  derived?: Record<string, number>;
  imageQualityScore: number | null;
  userAssisted: boolean;
  referenceGuidelineIds: string[];
  createdAt: string;
}
