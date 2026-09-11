import type { ProbeControl } from '@/simulator/probe/pose';
import type { PatientState } from '@/simulator/anatomy/thoraxModel';
import type { AcquisitionSettings, ImagingModality } from '@/simulator/renderer/types';
import type { ColorSettings } from '@/simulator/doppler/color/colorDoppler';
import type { SpectralSettings } from '@/simulator/doppler/spectral/spectrum';
import type { ViewAnalysis } from '@/simulator/view-recognition/viewQuality';
import type { SectorMapping } from '@/simulator/renderer/scanConvert';
import type { CaseDefinition } from '@/cases/schema';
import type { StructuredEchoTruth } from '@/simulator/hemodynamics/groundTruth';

export type QualityTier = 'low' | 'medium' | 'high';

/** Everything the UI can change, sent to the simulator every animation frame. */
export interface SimInput {
  probe: ProbeControl;
  patient: PatientState;
  settings: AcquisitionSettings;
  modality: ImagingModality;
  frozen: boolean;
  /** When frozen: 0 = latest frame, negative = older frames. */
  cineOffset: number;
  color: ColorSettings;
  spectral: SpectralSettings;
  /** Doppler / M-mode cursor: angle within the sector (rad) and gate depth (cm, PW/TDI). */
  cursorThetaRad: number;
  gateDepthCm: number;
  quality: QualityTier;
  display: { width: number; height: number };
  rendererBackend: 'atlas' | 'procedural' | 'webgl2';
}

export interface EcgPoint {
  t: number;
  v: number;
}

export interface StripInfo {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Seconds per pixel column. */
  secondsPerColumn: number;
  /** Spectral: velocity (m/s) at top/bottom rows. M-mode: depth (cm) at top/bottom. */
  topValue: number;
  bottomValue: number;
  kind: 'spectral' | 'm-mode' | null;
}

/** What sits at the Doppler/M-mode cursor this frame (for technique evaluation of measurements). */
export interface GateInfo {
  thetaRad: number;
  depthCm: number;
  /** structure/tissue ids at the PW/TDI sample volume */
  structure: number;
  tissue: number;
  flowPresent: boolean;
  /** beam–flow angle at the gate (deg) when flow is present */
  flowAngleDeg: number | null;
  /** distinct structure ids crossed by the cursor line (CW, M-mode) */
  lineStructures: number[];
}

export interface SimOutput {
  frameId: number;
  width: number;
  height: number;
  rgba: ArrayBuffer;
  sector: SectorMapping & { x: number; y: number };
  strip: StripInfo;
  /** Polar geometry of the frame and its per-sample structure map (line-major), for measurement technique checks. */
  polar: { lines: number; samples: number; sectorRad: number; depthCm: number };
  structure: Uint8Array;
  gate: GateInfo | null;
  timeS: number;
  phase: number;
  beatIndex: number;
  heartRateBpm: number;
  rrS: number;
  simulatedFps: number;
  ecg: EcgPoint[];
  ecgHead: number;
  view: ViewAnalysis | null;
  spectrumColumn: Float32Array | null;
  spectralRange: { vMin: number; vMax: number };
  frozen: boolean;
  cineLength: number;
  cineOffset: number;
  cineFramePhase: number;
  stats: Record<string, number | string>;
  colorFps: number;
  probeBeam: { origin: [number, number, number]; forward: [number, number, number]; lateral: [number, number, number]; normal: [number, number, number] };
}

/** Cardiac phase landmarks (fractions of RR) sent with the ready message. */
export interface PhaseMarks {
  ejectionStart: number;
  ejectionEnd: number;
  mitralOpen: number;
  eEnd: number;
  aStart: number;
  aEnd: number;
  hasAWave: boolean;
}

/** On-demand requests answered by the simulator (rare events, not per frame). */
export type SimRequest = { kind: 'autoTrace'; x0: number; x1: number };
export type SimResponse = { kind: 'autoTrace'; velocitiesMps: number[]; secondsPerColumn: number; x0: number };

export type MainToWorker =
  | { type: 'init'; caseDef: CaseDefinition; input: SimInput }
  | { type: 'input'; input: SimInput }
  | { type: 'recycle'; buffer: ArrayBuffer }
  | { type: 'loadCase'; caseDef: CaseDefinition; input: SimInput }
  | { type: 'request'; id: number; req: SimRequest };

export type WorkerToMain =
  | { type: 'ready'; truth: StructuredEchoTruth; caseId: string; phaseMarks: PhaseMarks; lvLengthCm: number }
  | { type: 'frame'; output: SimOutput }
  | { type: 'response'; id: number; res: SimResponse | null }
  | { type: 'error'; message: string };
