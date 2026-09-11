import type { BeamFrame } from '@/simulator/probe/pose';
import type { HeartModel, HeartPose } from '@/simulator/anatomy/heartModel';
import type { ThoraxModel } from '@/simulator/anatomy/thoraxModel';

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
  grayMap: 'linear' | 's-curve' | 'high-contrast';
  invertLR: boolean;
  zoom: number; // 1 = none
}

export const DEFAULT_ACQUISITION: AcquisitionSettings = {
  depthCm: 16,
  sectorDeg: 80,
  gainDb: 0,
  tgcDb: [0, 0, 0, 0, 0, 0, 0, 0],
  dynamicRangeDb: 55,
  frequencyMHz: 2.5,
  harmonics: true,
  focusCm: 9,
  lineDensity: 'medium',
  persistence: 0.35,
  edgeEnhance: 0.1,
  grayMap: 's-curve',
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
  amplitude: Float32Array; // lines*samples, index = line*samples + sample
  /** Per-sample structure id (for view analysis, Doppler masks, measurements). */
  structure: Uint8Array;
  /** Per-sample two-way transmission reaching that sample (for shadow-aware Doppler). */
  transmission: Float32Array;
  /** Per-sample tissue class. */
  tissue: Uint8Array;
}

export function allocPolarFrame(spec: PolarFrameSpec): PolarFrame {
  const n = spec.lines * spec.samples;
  return { spec, amplitude: new Float32Array(n), structure: new Uint8Array(n), transmission: new Float32Array(n), tissue: new Uint8Array(n) };
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

export interface RendererBackend {
  readonly id: 'atlas' | 'procedural' | 'webgl2-procedural' | 'webgpu-procedural' | 'remote-cuda';
  render(scene: Scene, beam: BeamFrame, spec: PolarFrameSpec, phase: number, out: PolarFrame, hints?: RenderHints): void;
  /** Optional diagnostics for the dev HUD. */
  stats(): Record<string, number | string>;
  dispose(): void;
}

export function polarSpecFor(settings: AcquisitionSettings, tier: 'low' | 'medium' | 'high'): PolarFrameSpec {
  const baseLines = settings.lineDensity === 'low' ? 64 : settings.lineDensity === 'high' ? 160 : 112;
  const tierMul = tier === 'low' ? 0.75 : tier === 'high' ? 1.35 : 1;
  const lines = Math.round((baseLines * tierMul * settings.sectorDeg) / 75);
  const samples = Math.round((tier === 'low' ? 160 : tier === 'high' ? 320 : 224) * Math.sqrt(settings.depthCm / 16));
  // slice-thickness averaging triples the classification work, so it is reserved for the high tier (GPU / offline)
  return { lines: Math.max(32, lines), samples: Math.max(96, samples), sectorRad: (settings.sectorDeg * Math.PI) / 180, depthCm: settings.depthCm, elevationSamples: tier === 'high' ? 3 : 1, focusCm: settings.focusCm };
}
