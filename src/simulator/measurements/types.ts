/**
 * Measurement record (spec 16.6): every measurement keeps its provenance so scoring can judge
 * technique (view, frame, quality, alignment) and not only the number.
 */
export type MeasurementKind = 'linear' | 'velocity' | 'vti' | 'time' | 'area' | 'volume';

export interface Measurement {
  id: string;
  kind: MeasurementKind;
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
  derived?: Record<string, number>;
  imageQualityScore: number | null;
  userAssisted: boolean;
  referenceGuidelineIds: string[];
  createdAt: string;
}
