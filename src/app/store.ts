import { create } from 'zustand';
import type { ProbeControl } from '@/simulator/probe/pose';
import type { PatientState } from '@/simulator/anatomy/thoraxModel';
import { DEFAULT_ACQUISITION, type AcquisitionSettings, type ImagingModality } from '@/simulator/renderer/types';
import { DEFAULT_COLOR, type ColorSettings } from '@/simulator/doppler/color/colorDoppler';
import { DEFAULT_SPECTRAL, type SpectralSettings } from '@/simulator/doppler/spectral/spectrum';
import type { SimOutput, QualityTier } from '@/simulator/core/protocol';
import type { StructuredEchoTruth } from '@/simulator/hemodynamics/groundTruth';
import type { Measurement } from '@/simulator/measurements/types';
import { getCaseModels } from './caseModels';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import { easeInOut, lerpControl, presetDurationMs } from '@/simulator/probe/interpolate';

export type ProductMode = 'sandbox' | 'guided' | 'exam';

export interface UiPrefs {
  showTorso: boolean;
  showSkeleton: boolean;
  showHints: boolean;
  showPhysics: boolean;
  devPanel: boolean;
  showEcg: boolean;
  tutorialDone: boolean;
  screen: 'simulator' | 'references' | 'report';
}

export interface SimStore {
  caseId: string;
  probe: ProbeControl;
  patient: PatientState;
  settings: AcquisitionSettings;
  modality: ImagingModality;
  frozen: boolean;
  cineOffset: number;
  color: ColorSettings;
  spectral: SpectralSettings;
  cursorThetaRad: number;
  gateDepthCm: number;
  quality: QualityTier;
  rendererBackend: 'atlas' | 'procedural';
  mode: ProductMode;
  targetViewId: string | null;
  ui: UiPrefs;
  truth: StructuredEchoTruth | null;
  measurements: Measurement[];
  activeTool: 'none' | 'caliper' | 'velocity' | 'vti' | 'time';
  /** Best view-quality score reached per view id during this case (drives acquisition scoring). */
  viewProgress: Record<string, number>;
  /** Preset view in progress: the probe is moved continuously to the canonical pose (never teleported). */
  presetAnim: { from: ProbeControl; to: ProbeControl; startMs: number; durationMs: number; viewId: string } | null;
  examFinished: boolean;
  error: string | null;
  workerMode: 'worker' | 'inline' | 'starting';
  fpsUi: number;
  setProbe: (p: Partial<ProbeControl>) => void;
  nudgeProbe: (p: Partial<ProbeControl>) => void;
  setPatient: (p: Partial<PatientState>) => void;
  setSettings: (s: Partial<AcquisitionSettings>) => void;
  setTgc: (band: number, db: number) => void;
  setModality: (m: ImagingModality) => void;
  toggleFreeze: () => void;
  setCineOffset: (o: number) => void;
  setColor: (c: Partial<ColorSettings>) => void;
  setSpectral: (s: Partial<SpectralSettings>) => void;
  setCursor: (theta: number, depth?: number) => void;
  setQuality: (q: QualityTier) => void;
  setBackend: (b: 'atlas' | 'procedural') => void;
  setMode: (m: ProductMode) => void;
  setTargetView: (id: string | null) => void;
  setUi: (u: Partial<UiPrefs>) => void;
  setTruth: (t: StructuredEchoTruth | null, caseId: string) => void;
  addMeasurement: (m: Measurement) => void;
  removeMeasurement: (id: string) => void;
  clearMeasurements: () => void;
  setActiveTool: (t: SimStore['activeTool']) => void;
  recordViewScore: (viewId: string, score: number) => void;
  /** Start moving the probe to a predefined view (disabled in exam mode). */
  startPresetView: (viewId: string) => void;
  cancelPreset: () => void;
  /** Advance the preset animation; called from the animation loop. */
  tickPresetAnimation: (nowMs: number) => void;
  finishExam: () => void;
  resetProgress: () => void;
  setError: (e: string | null) => void;
  setWorkerMode: (m: SimStore['workerMode']) => void;
  setFpsUi: (f: number) => void;
  resetProbe: () => void;
  loadCase: (id: string) => void;
}

/** HUD (per-frame light state) lives in its own store so the console does not re-render per frame. */
export const useHudStore = create<{ hud: SimOutput | null; setHud: (h: SimOutput | null) => void }>((set) => ({
  hud: null,
  setHud: (h) => set({ hud: h }),
}));

const PREF_KEY = 'echotwin.prefs.v1';
function loadPrefs(): Partial<UiPrefs> {
  try {
    const raw = localStorage.getItem(PREF_KEY);
    return raw ? (JSON.parse(raw) as Partial<UiPrefs>) : {};
  } catch {
    return {};
  }
}
function savePrefs(ui: UiPrefs): void {
  try {
    const { showTorso, showSkeleton, showHints, showEcg, tutorialDone } = ui;
    localStorage.setItem(PREF_KEY, JSON.stringify({ showTorso, showSkeleton, showHints, showEcg, tutorialDone }));
  } catch {
    /* storage unavailable */
  }
}

/** A deliberately imperfect starting pose near the parasternal window (never a canonical view). */
export const START_PROBE: ProbeControl = { u: 3.4, v: 0.4, rotationDeg: 25, tiltDeg: 6, rockDeg: -4, pressure: 0.55 };

export const useSimStore = create<SimStore>((set) => ({
  caseId: 'normal-excellent-window',
  probe: { ...START_PROBE },
  patient: { position: 'left-lateral', respiration: 'expiration', headElevationDeg: 0 },
  settings: { ...DEFAULT_ACQUISITION, tgcDb: [...DEFAULT_ACQUISITION.tgcDb] },
  modality: '2d',
  frozen: false,
  cineOffset: 0,
  color: { ...DEFAULT_COLOR },
  spectral: { ...DEFAULT_SPECTRAL },
  cursorThetaRad: 0.05,
  gateDepthCm: 9,
  quality: 'medium',
  rendererBackend: 'atlas',
  mode: 'sandbox',
  targetViewId: null,
  ui: { showTorso: true, showSkeleton: true, showHints: true, showPhysics: false, devPanel: false, showEcg: true, tutorialDone: false, screen: 'simulator', ...loadPrefs() },
  truth: null,
  measurements: [],
  activeTool: 'none',
  viewProgress: {},
  presetAnim: null,
  examFinished: false,
  error: null,
  workerMode: 'starting',
  fpsUi: 0,
  setProbe: (p) => set((s) => ({ probe: clampProbe({ ...s.probe, ...p }), presetAnim: null })),
  nudgeProbe: (p) =>
    set((s) => {
      const n = { ...s.probe };
      for (const k of Object.keys(p) as (keyof ProbeControl)[]) n[k] = (n[k] ?? 0) + (p[k] ?? 0);
      return { probe: clampProbe(n), presetAnim: null };
    }),
  setPatient: (p) => set((s) => ({ patient: { ...s.patient, ...p } })),
  setSettings: (st) => set((s) => ({ settings: clampSettings({ ...s.settings, ...st }) })),
  setTgc: (band, db) =>
    set((s) => {
      const tgc = [...s.settings.tgcDb];
      tgc[band] = Math.max(-15, Math.min(15, db));
      return { settings: { ...s.settings, tgcDb: tgc } };
    }),
  setModality: (m) => set({ modality: m, frozen: false, cineOffset: 0 }),
  toggleFreeze: () => set((s) => ({ frozen: !s.frozen, cineOffset: 0 })),
  setCineOffset: (o) => set(() => ({ cineOffset: Math.min(0, Math.max(-((useHudStore.getState().hud?.cineLength ?? 1) - 1), o)) })),
  setColor: (c) => set((s) => ({ color: { ...s.color, ...c } })),
  setSpectral: (sp) => set((s) => ({ spectral: { ...s.spectral, ...sp } })),
  setCursor: (theta, depth) => set((s) => ({ cursorThetaRad: theta, gateDepthCm: depth ?? s.gateDepthCm })),
  setQuality: (q) => set({ quality: q }),
  setBackend: (b) => set({ rendererBackend: b }),
  setMode: (m) =>
    set((s) => ({
      mode: m,
      examFinished: false,
      viewProgress: m === 'exam' ? {} : s.viewProgress,
      measurements: m === 'exam' ? [] : s.measurements,
      ui: { ...s.ui, showHints: m !== 'exam', showPhysics: m === 'exam' ? false : s.ui.showPhysics, devPanel: m === 'exam' ? false : s.ui.devPanel },
    })),
  setTargetView: (id) => set({ targetViewId: id }),
  setUi: (u) =>
    set((s) => {
      const ui = { ...s.ui, ...u };
      savePrefs(ui);
      return { ui };
    }),
  setTruth: (t, caseId) => set({ truth: t, caseId }),
  addMeasurement: (m) => set((s) => ({ measurements: [...s.measurements, m] })),
  removeMeasurement: (id) => set((s) => ({ measurements: s.measurements.filter((m) => m.id !== id) })),
  clearMeasurements: () => set({ measurements: [] }),
  setActiveTool: (t) => set({ activeTool: t }),
  startPresetView: (viewId) =>
    set((s) => {
      if (s.mode === 'exam') return {};
      const { heart, thorax } = getCaseModels(s.caseId, s.patient);
      const to = clampProbe(canonicalControl(getViewTarget(viewId), heart, thorax));
      const from = { ...s.probe };
      return { presetAnim: { from, to, startMs: performance.now(), durationMs: presetDurationMs(from, to), viewId }, targetViewId: viewId, frozen: false };
    }),
  cancelPreset: () => set({ presetAnim: null }),
  tickPresetAnimation: (nowMs) =>
    set((s) => {
      const a = s.presetAnim;
      if (!a) return {};
      const t = (nowMs - a.startMs) / a.durationMs;
      const probe = lerpControl(a.from, a.to, easeInOut(t));
      return t >= 1 ? { probe: a.to, presetAnim: null } : { probe };
    }),
  recordViewScore: (viewId, score) =>
    set((s) => ((s.viewProgress[viewId] ?? 0) >= score ? {} : { viewProgress: { ...s.viewProgress, [viewId]: score } })),
  finishExam: () => set({ examFinished: true, frozen: true, ui: { ...useSimStore.getState().ui, screen: 'report' } }),
  resetProgress: () => set({ viewProgress: {}, examFinished: false, measurements: [] }),
  setError: (e) => set({ error: e }),
  setWorkerMode: (m) => set({ workerMode: m }),
  setFpsUi: (f) => set({ fpsUi: f }),
  resetProbe: () => set({ probe: { ...START_PROBE }, presetAnim: null }),
  loadCase: (id) => set({ caseId: id, measurements: [], frozen: false, cineOffset: 0, probe: { ...START_PROBE }, viewProgress: {}, examFinished: false, presetAnim: null }),
}));

function clampProbe(p: ProbeControl): ProbeControl {
  return {
    u: Math.max(-14, Math.min(14, p.u)),
    v: Math.max(-12, Math.min(11, p.v)),
    rotationDeg: ((((p.rotationDeg + 180) % 360) + 360) % 360) - 180,
    tiltDeg: Math.max(-70, Math.min(70, p.tiltDeg)),
    rockDeg: Math.max(-60, Math.min(60, p.rockDeg)),
    pressure: Math.max(0, Math.min(1, p.pressure)),
  };
}

function clampSettings(s: AcquisitionSettings): AcquisitionSettings {
  return {
    ...s,
    depthCm: Math.max(6, Math.min(30, s.depthCm)),
    sectorDeg: Math.max(30, Math.min(100, s.sectorDeg)),
    gainDb: Math.max(-30, Math.min(30, s.gainDb)),
    dynamicRangeDb: Math.max(30, Math.min(90, s.dynamicRangeDb)),
    frequencyMHz: Math.max(1.5, Math.min(5, s.frequencyMHz)),
    focusCm: Math.max(2, Math.min(s.depthCm, s.focusCm)),
    persistence: Math.max(0, Math.min(0.9, s.persistence)),
    zoom: Math.max(1, Math.min(2.5, s.zoom)),
  };
}
