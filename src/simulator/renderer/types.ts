import type { BeamFrame } from '@/simulator/probe/pose';
import type { HeartModel, HeartPose } from '@/simulator/anatomy/heartModel';
import type { ThoraxModel } from '@/simulator/anatomy/thoraxModel';
import type { ConsoleState } from './postprocess/consolePipeline';

export type ImagingModality = '2d' | 'm-mode' | 'cmm' | 'color' | 'pw' | 'cw' | 'tdi';
export type LineDensity = 'low' | 'medium' | 'high';

/** Console settings that alter pixels (spec 7.8). Every field has an observable effect. */
export interface AcquisitionSettings {
  depthCm: number;
  sectorDeg: number;
  gainDb: number;
  tgcDb: number[]; // 8 bands, near → far
  dynamicRangeDb: number;
  frequencyMHz: number;
  harmonics: boolean;
  focusCm: number;
  lineDensity: LineDensity;
  persistence: number; // 0..1
  edgeEnhance: number; // 0..1 (smoothing when negative is not allowed; 0 = none)
  grayMap: 'linear' | 's-curve' | 'high-contrast' | 'clinical';
  invertLR: boolean;
  zoom: number; // 1 = none
  /** Default depth compensation of the console (dB/cm/MHz, two-way path); the console's own value when absent. */
  depthCompensationDbPerCmMHz?: number;
}

export const DEFAULT_ACQUISITION: AcquisitionSettings = {
  depthCm: 16,
  sectorDeg: 80,
  gainDb: 0,
  tgcDb: [0, 0, 0, 0, 0, 0, 0, 0],
  // 70 dB, chosen against 500 CAMUS patients (decision 70): the previous s-curve at 55 dB was the worst of 24
  // consoles tried, placing blood at grey 3-5 where clinical studies show 56-60. The clinical grey map and the white
  // point came with complex receiver noise (decision 91)
  dynamicRangeDb: 70,
  frequencyMHz: 2.5,
  harmonics: true,
  focusCm: 9,
  lineDensity: 'medium',
  persistence: 0.35,
  edgeEnhance: 0.1,
  grayMap: 'clinical',
  invertLR: false,
  zoom: 1,
};

/** Raw (pre-console) polar frame: linear echo amplitude per (line, sample). */
export interface PolarFrameSpec {
  lines: number;
  samples: number;
  sectorRad: number;
  depthCm: number;
  /** Elevation samples per point (1 = infinitely thin slice, 3 = weighted mean over the slice thickness). */
  elevationSamples: number;
  /** Focus depth (cm): lateral and elevational resolution degrade away from it. */
  focusCm: number;
}

export interface PolarFrame {
  spec: PolarFrameSpec;
  /** Linear envelope, lines*samples, index = line*samples + sample. Not read back when the GPU forms the display (decision 54). */
  amplitude: Float32Array;
  /** Per-sample structure id (for view analysis, Doppler masks, measurements). */
  structure: Uint8Array;
  /** Per-sample two-way transmission reaching that sample (for shadow-aware Doppler). */
  transmission: Float32Array;
  /** Per-sample tissue class. */
  tissue: Uint8Array;
}

export function allocPolarFrame(spec: PolarFrameSpec): PolarFrame {
  const n = spec.lines * spec.samples;
  return {
    spec,
    amplitude: new Float32Array(n),
    structure: new Uint8Array(n),
    transmission: new Float32Array(n),
    tissue: new Uint8Array(n),
  };
}

export interface ScenePhysics {
  frequencyMHz: number;
  harmonics: boolean;
  clutterLevel: number; // 0..1 from case + window
  windowAttenuation: number; // 0..1 extra chest-wall attenuation
  seed: number;
  /** Case "beam-width" artifact 0..1: widens the lateral beam away from the focus (renderer PSF). */
  beamWidth?: number;
}

export interface Scene {
  heart: HeartModel;
  heartPose: HeartPose;
  thorax: ThoraxModel;
  physics: ScenePhysics;
}

/**
 * RendererBackend contract (spec 0.7, 30): produces raw polar frames for a beam/scene. Implemented
 * by the AtlasRenderer (default), the ProceduralSliceRenderer (anchor source + experimental
 * backend) and, in the future, WebGPU / remote backends. Scoring, cases, Doppler and UI never
 * depend on which backend produced the frame.
 */
/** Optional per-frame hints from the simulator (a backend may ignore them). */
export interface RenderHints {
  /** True when the probe has rested for a few frames: a render cache may keep frames only then. */
  stationary: boolean;
  /** Time the render of this frame may take (ms): 0.6 of the simulated frame interval. */
  budgetMs?: number;
  /** Scene (heart pose) at an arbitrary phase, so a render cache can fill the phase slots of a cine. */
  sceneAtPhase?: (phase: number) => Scene;
}

/** Console input of a display formed by the renderer: the settings and the console state it advances. */
export interface DisplayConsole {
  settings: AcquisitionSettings;
  state: ConsoleState;
}

/**
 * What the presentation of a colour field needs of the colour Doppler settings (the full `ColorSettings` lives in
 * doppler/color/colorDoppler.ts and satisfies this structurally): the box in polar coordinates, the scale the map
 * saturates at, and whether variance is shown. Declared here so the renderer never imports the Doppler engine.
 */
export interface ColorPresentSettings {
  boxThetaMinRad: number;
  boxThetaMaxRad: number;
  boxRMinCm: number;
  boxRMaxCm: number;
  scaleMps: number;
  showVariance: boolean;
  invert: boolean;
}

export interface RendererBackend {
  readonly id: 'atlas' | 'procedural' | 'webgl2-procedural' | 'webgpu-procedural' | 'remote-cuda';
  render(
    scene: Scene,
    beam: BeamFrame,
    spec: PolarFrameSpec,
    phase: number,
    out: PolarFrame,
    hints?: RenderHints,
  ): void;
  /**
   * Optional: render and form the displayed polar image in one go (GPU console, decision 54). Fills `display`
   * and the structure, tissue and transmission maps of `out` (not the amplitude) and advances the console
   * state. Returns false when this frame cannot be formed that way; the caller then uses `render` and the CPU
   * console.
   */
  renderDisplay?(
    scene: Scene,
    beam: BeamFrame,
    spec: PolarFrameSpec,
    phase: number,
    out: PolarFrame,
    hints: RenderHints | undefined,
    console: DisplayConsole,
    display: Uint8ClampedArray,
  ): boolean;
  /** Optional diagnostics for the dev HUD. */
  stats(): Record<string, number | string>;
  dispose(): void;
}

export function polarSpecFor(
  settings: AcquisitionSettings,
  tier: 'low' | 'medium' | 'high',
): PolarFrameSpec {
  const baseLines =
    settings.lineDensity === 'low' ? 64 : settings.lineDensity === 'high' ? 160 : 112;
  const tierMul = tier === 'low' ? 0.75 : tier === 'high' ? 1.35 : 1;
  const lines = Math.round((baseLines * tierMul * settings.sectorDeg) / 75);
  const samples = Math.round(
    (tier === 'low' ? 160 : tier === 'high' ? 320 : 224) * Math.sqrt(settings.depthCm / 16),
  );
  // slice-thickness averaging triples the classification work, so it is reserved for the high tier (GPU / offline)
  return {
    lines: Math.max(32, lines),
    samples: Math.max(96, samples),
    sectorRad: (settings.sectorDeg * Math.PI) / 180,
    depthCm: settings.depthCm,
    elevationSamples: tier === 'high' ? 3 : 1,
    focusCm: settings.focusCm,
  };
}
