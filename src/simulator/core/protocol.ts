import type { ProbeControl } from '@/simulator/probe/pose';
import type { PatientState } from '@/simulator/anatomy/thoraxModel';
import type { AcquisitionSettings, ImagingModality } from '@/simulator/renderer/types';
import type { ColorSettings } from '@/simulator/doppler/color/colorDoppler';
import type { SpectralSettings } from '@/simulator/doppler/spectral/spectrum';
import type { ViewAnalysis } from '@/simulator/view-recognition/viewQuality';
import type { SectorMapping } from '@/simulator/renderer/scanConvert';
import type { CaseDefinition } from '@/cases/schema';
import type { StructuredEchoTruth } from '@/simulator/hemodynamics/groundTruth';

/**
 * The backend the user selects (Dev panel). `atlas` wraps the GPU port when available and the CPU tracer
 * otherwise; `procedural` forces the CPU reference; `webgl2` asks for the port directly. One list for the
 * protocol, the store and the panel (engineering audit, B3).
 */
export const RENDERER_BACKEND_CHOICES = ['atlas', 'procedural', 'webgl2'] as const;
export type RendererBackendChoice = (typeof RENDERER_BACKEND_CHOICES)[number];

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
  rendererBackend: RendererBackendChoice;
  /** Artifact laboratory: live overrides of the case artifacts (0..1 each); null = as defined by the case. */
  artifactOverrides: {
    sideLobe: number;
    mirror: number;
    beamWidth: number;
    clutter: number;
  } | null;
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
  /** Composite RGBA, row-major. Empty when the GPU formed the image and it travels as `bitmap`. */
  rgba: ArrayBuffer;
  /** The composite drawn by the GPU present pass (decision 54); the display draws it once and closes it. */
  bitmap?: ImageBitmap | null;
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
  probeBeam: {
    origin: [number, number, number];
    forward: [number, number, number];
    lateral: [number, number, number];
    normal: [number, number, number];
  };
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
export type SimRequest =
  | { kind: 'autoTrace'; x0: number; x1: number }
  /** The probe control that reaches a canonical view from the window, computed on the worker's own models (B7). */
  | { kind: 'canonicalControl'; viewId: string }
  /** What the model holds at one point of the displayed frame — polar in the image, or a torso point of the 3D
   *  navigator (review mode, decisions 134 and 135). */
  | {
      kind: 'probePoint';
      rCm?: number;
      thetaRad?: number;
      torso?: { x: number; y: number; z: number };
    };
export type SimResponse =
  | {
      kind: 'autoTrace';
      velocitiesMps: number[];
      secondsPerColumn: number;
      x0: number;
    }
  | { kind: 'canonicalControl'; control: ProbeControl }
  | { kind: 'probePoint'; point: ProbePointInfo };

/** The model at one point of the image: classification and the coordinates the anatomy code reasons in. */
export interface ProbePointInfo {
  /** Polar position relative to the beam (a torso point is projected onto the image plane). */
  rCm: number;
  thetaRad: number;
  /** Distance from the imaging plane (cm, along the elevation normal); 0 for a point of the image. */
  offPlaneCm: number;
  /** Cardiac phase of the frame the point was read on. */
  phase: number;
  torso: { x: number; y: number; z: number };
  /** Heart-frame point (cm). */
  heart: { x: number; y: number; z: number };
  inHeart: boolean;
  structure: number;
  tissue: number;
  /** Signed distance to the structure's interface (cm, negative inside). */
  sdfCm: number;
  /** Azimuth around the LV long axis (rad) and level fraction (0 base → 1 apex), inside the heart. */
  azRad: number | null;
  levelFrac: number | null;
  /** Aortic root coordinates (cm along the axis from the annulus, radial distance) when the point is near the root. */
  rootT: number | null;
  rootR: number | null;
}

export type MainToWorker =
  | { type: 'init'; caseDef: CaseDefinition; input: SimInput }
  | { type: 'input'; input: SimInput }
  | { type: 'recycle'; buffer: ArrayBuffer }
  | { type: 'loadCase'; caseDef: CaseDefinition; input: SimInput }
  | { type: 'request'; id: number; req: SimRequest };

export type WorkerToMain =
  | {
      type: 'ready';
      truth: StructuredEchoTruth;
      caseId: string;
      phaseMarks: PhaseMarks;
      lvLengthCm: number;
    }
  | { type: 'frame'; output: SimOutput }
  | { type: 'response'; id: number; res: SimResponse | null }
  | { type: 'error'; message: string };
