import { create } from 'zustand';
import type { ProbeControl } from '@/simulator/probe/pose';
import type { PatientState } from '@/simulator/anatomy/thoraxModel';
import {
  DEFAULT_ACQUISITION,
  type AcquisitionSettings,
  type ImagingModality,
} from '@/simulator/renderer/types';
import { DEFAULT_COLOR, type ColorSettings } from '@/simulator/doppler/color/colorDoppler';
import { DEFAULT_SPECTRAL, type SpectralSettings } from '@/simulator/doppler/spectral/spectrum';
import type { SimOutput, QualityTier, RendererBackendChoice } from '@/simulator/core/protocol';
import type { StructuredEchoTruth } from '@/simulator/hemodynamics/groundTruth';
import type { Measurement } from '@/simulator/measurements/types';
import { getMeasurementSpec } from '@/simulator/measurements/protocol';
import { renumberMarkers, type ReviewMarker, type ReviewReport } from './review';
import {
  addEvent,
  completeTask,
  emptyProgress,
  loadProgress,
  saveProgress,
  type ProgressEvent,
  type ProgressState,
} from '@/education/progress';
import { expectedFindings, getFinding, scoreImpression } from '@/education/impression';
import { buildExamSummary } from '@/education/scoring/scoring';
import { loadCaseById } from '@/cases';
import type { PhaseMarks } from '@/simulator/core/protocol';
import { frameBus } from './frameBus';
import { easeInOut, lerpControl, presetDurationMs } from '@/simulator/probe/interpolate';
import { modePolicy, type ProductMode } from './modePolicy';

export type { ProductMode };

/** Right-console tabs (PR: tabbed console). Persisted so a reload restores the working context. */
export type ConsoleTab = 'adquirir' | 'imagen' | 'doppler' | 'medir' | 'lab' | 'revisar';

export interface UiPrefs {
  showTorso: boolean;
  showSkeleton: boolean;
  /** 3D navigator layers and aids (spec 4.3): each one can be turned off to read the anatomy underneath. */
  navSkin: boolean;
  navHeart: boolean;
  navChambers: boolean;
  navValves: boolean;
  navVessels: boolean;
  navAxes: boolean;
  navCut: boolean;
  /** Second navigator view under the torso: the heart cut by the imaging plane, seen face-on (decision 137). */
  navSplit: boolean;
  /** Chamber and valve names on the cut face. */
  navLabels: boolean;
  /** The cut map colours the LV myocardium by segment, numbered (decision 152). */
  navSegments: boolean;
  /** The ultrasound image shows the LV segments of the tissue in it, translucent and numbered (decision 153). */
  imageSegments: boolean;
  /** The LV segment panel (polar map and inspector) under the navigator. */
  segmentsOpen: boolean;
  /** Segment model shown: the anatomical AHA 17 or the 16-segment wall-motion model. */
  segmentModel: 'LV_AHA17' | 'LV_16';
  /** Segment selected on the cut map or the polar map, shared by both. Not persisted. */
  selectedSegment: number | null;
  /** The view guide (score, hints, details, causes) under the navigator; hidden until asked for (decision 141). */
  guidanceOpen: boolean;
  /** Rings on the skin where each canonical view is acquired (decision 132). */
  navWindows: boolean;
  showHints: boolean;
  showPhysics: boolean;
  devPanel: boolean;
  /** Review mode (decision 134): clicks on the image place numbered markers for a feedback report. Not persisted. */
  reviewMode: boolean;
  /** Freeze the image when the first marker is placed on a live frame, so the markers keep their frame (decision 135). */
  reviewFreezeOnMark: boolean;
  showEcg: boolean;
  tutorialDone: boolean;
  /** Machine-style telemetry overlay on the image corners (case, vitals, acquisition params). */
  showHud: boolean;
  /** Left navigation rail collapsed to the mini strip (score + expander). */
  railMini: boolean;
  /** Clean-interface mode: the whole left rail hides so only the image and console remain. */
  minimal: boolean;
  consoleTab: ConsoleTab;
  screen: 'simulator' | 'references' | 'report' | 'curriculum' | 'progress';
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
  rendererBackend: RendererBackendChoice;
  mode: ProductMode;
  targetViewId: string | null;
  ui: UiPrefs;
  truth: StructuredEchoTruth | null;
  measurements: Measurement[];
  activeTool:
    'none' | 'caliper' | 'velocity' | 'vti' | 'auto-vti' | 'time' | 'slope' | 'simpson' | 'tapse';
  /** Local learning progress (events + completed curriculum tasks), persisted in localStorage. */
  progress: ProgressState;
  recordEvent: (e: ProgressEvent) => void;
  completeTasks: (taskIds: string[]) => void;
  resetLearningProgress: () => void;
  /** Structured impression selected by the learner for the current case. */
  impressionSelection: string[];
  toggleFinding: (id: string) => void;
  /** Artifact laboratory overrides (null = case defaults). */
  artifactLab: { sideLobe: number; mirror: number; beamWidth: number; clutter: number } | null;
  setArtifactLab: (
    v: { sideLobe: number; mirror: number; beamWidth: number; clutter: number } | null,
  ) => void;
  /** Semantic measurement being captured (protocol id) or null for a free measurement. */
  activeMeasurementId: string | null;
  /** Review mode markers and the free note of the report being prepared (decision 134). */
  reviewMarkers: ReviewMarker[];
  reviewNote: string;
  /** Marker highlighted on the image, the model and the panel; Delete removes it (decision 135). */
  reviewSelectedId: string | null;
  /** Removed markers as batches (a primary goes with its secondaries), newest last, restored by undo. */
  reviewUndo: ReviewMarker[][];
  /** Primary marker the next clicks add secondary points to, until Esc (decision 136). */
  reviewLinkParentId: string | null;
  armReviewLink: (id: string | null) => void;
  /** Who wrote the report the current markers came from, when they were loaded from one. */
  reviewSource: { author: ReviewReport['author']; createdAt: string } | null;
  selectReviewMarker: (id: string | null) => void;
  undoReviewRemove: () => void;
  addReviewMarker: (m: ReviewMarker) => void;
  updateReviewMarker: (id: string, patch: Partial<ReviewMarker>) => void;
  removeReviewMarker: (id: string) => void;
  clearReview: () => void;
  setReviewNote: (note: string) => void;
  /** Restore the state a report describes (case, patient, probe, console) and show its markers. */
  loadReviewReport: (r: ReviewReport) => void;
  /** Cardiac phase landmarks and LV length of the loaded case (from the simulator). */
  phaseMarks: PhaseMarks | null;
  lvLengthCm: number | null;
  /** Best view-quality score reached per view id during this case (drives acquisition scoring). */
  viewProgress: Record<string, number>;
  /** Preset view in progress: the probe is moved continuously to the canonical pose (never teleported). */
  presetAnim: {
    from: ProbeControl;
    to: ProbeControl;
    startMs: number;
    durationMs: number;
    viewId: string;
  } | null;
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
  setBackend: (b: RendererBackendChoice) => void;
  setMode: (m: ProductMode) => void;
  setTargetView: (id: string | null) => void;
  setUi: (u: Partial<UiPrefs>) => void;
  setTruth: (t: StructuredEchoTruth | null, caseId: string) => void;
  addMeasurement: (m: Measurement) => void;
  removeMeasurement: (id: string) => void;
  clearMeasurements: () => void;
  setActiveTool: (t: SimStore['activeTool']) => void;
  /** Start capturing a protocol measurement: selects its tool and remembers the semantic id. */
  setActiveMeasurement: (id: string | null) => void;
  setCycleInfo: (marks: PhaseMarks, lvLengthCm: number) => void;
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

/**
 * The LV segment layer (decision 152) is shown on the cut map and the 3D heart only where hints are allowed: in exam
 * mode it is off whatever the saved preference, since its toggle lives in a panel exam mode hides.
 */
export function segmentLayerOn(s: Pick<SimStore, 'mode' | 'ui'>): boolean {
  return s.ui.navSegments && modePolicy(s.mode).hintsEnabled;
}

/** The segment layer of the ultrasound image (decision 153), off in exam mode like the others. */
export function imageSegmentsOn(s: Pick<SimStore, 'mode' | 'ui'>): boolean {
  return s.ui.imageSegments && modePolicy(s.mode).hintsEnabled;
}

/**
 * The LV segment under the pointer, wherever it is — the image, the cut map, the 3D heart or the polar map — so the
 * others highlight it too (decision 153). Its own store: it changes as the mouse moves and is never persisted.
 */
export const useSegmentHover = create<{
  id: number | null;
  source: 'image' | 'cut' | 'heart' | 'polar' | null;
  setHover: (id: number | null, source: 'image' | 'cut' | 'heart' | 'polar' | null) => void;
}>((set, get) => ({
  id: null,
  source: null,
  setHover: (id, source) => {
    const cur = get();
    // leaving one view clears only that view's hover, so a late mouseleave does not undo another view's
    if (id === null && cur.source !== null && cur.source !== source) return;
    if (cur.id !== id || cur.source !== (id === null ? null : source))
      set({ id, source: id === null ? null : source });
  },
}));

/** HUD (per-frame light state) lives in its own store so the console does not re-render per frame. */
export const useHudStore = create<{ hud: SimOutput | null; setHud: (h: SimOutput | null) => void }>(
  (set) => ({
    hud: null,
    setHud: (h) => set({ hud: h }),
  }),
);

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
    const {
      showTorso,
      showSkeleton,
      showHints,
      showEcg,
      tutorialDone,
      showHud,
      navSkin,
      navHeart,
      navChambers,
      navValves,
      navVessels,
      navAxes,
      navCut,
      navWindows,
      navSplit,
      navLabels,
      navSegments,
      imageSegments,
      segmentsOpen,
      segmentModel,
      guidanceOpen,
      reviewFreezeOnMark,
      railMini,
      minimal,
      consoleTab,
    } = ui;
    localStorage.setItem(
      PREF_KEY,
      JSON.stringify({
        showTorso,
        showSkeleton,
        showHints,
        showEcg,
        tutorialDone,
        showHud,
        navSkin,
        navHeart,
        navChambers,
        navValves,
        navVessels,
        navAxes,
        navCut,
        navWindows,
        navSplit,
        navLabels,
        navSegments,
        imageSegments,
        segmentsOpen,
        segmentModel,
        guidanceOpen,
        reviewFreezeOnMark,
        railMini,
        minimal,
        consoleTab,
      }),
    );
  } catch {
    /* storage unavailable */
  }
}

/** A deliberately imperfect starting pose near the parasternal window (never a canonical view). */
export const START_PROBE: ProbeControl = {
  u: 3.4,
  v: 0.4,
  rotationDeg: 25,
  tiltDeg: 6,
  rockDeg: -4,
  pressure: 0.55,
};

export const useSimStore = create<SimStore>((set, get) => ({
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
  ui: {
    showTorso: true,
    showSkeleton: true,
    navSkin: true,
    navHeart: true,
    navChambers: true,
    navValves: true,
    navVessels: true,
    navAxes: true,
    navCut: false,
    navWindows: true,
    navSplit: true,
    navLabels: true,
    navSegments: false,
    imageSegments: false,
    segmentsOpen: false,
    segmentModel: 'LV_AHA17',
    selectedSegment: null,
    guidanceOpen: false,
    showHints: true,
    showPhysics: false,
    devPanel: false,
    reviewMode: false,
    reviewFreezeOnMark: true,
    showEcg: true,
    tutorialDone: false,
    showHud: true,
    railMini: false,
    minimal: false,
    consoleTab: 'adquirir',
    screen: 'simulator',
    ...loadPrefs(),
  },
  truth: null,
  measurements: [],
  activeTool: 'none',
  reviewMarkers: [],
  reviewNote: '',
  reviewSelectedId: null,
  reviewUndo: [],
  reviewSource: null,
  reviewLinkParentId: null,
  activeMeasurementId: null,
  progress: loadProgress(typeof localStorage !== 'undefined' ? localStorage : null),
  impressionSelection: [],
  artifactLab: null,
  phaseMarks: null,
  lvLengthCm: null,
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
  setCineOffset: (o) =>
    set(() => ({
      cineOffset: Math.min(0, Math.max(-((useHudStore.getState().hud?.cineLength ?? 1) - 1), o)),
    })),
  setColor: (c) => set((s) => ({ color: { ...s.color, ...c } })),
  setSpectral: (sp) => set((s) => ({ spectral: { ...s.spectral, ...sp } })),
  setCursor: (theta, depth) =>
    set((s) => ({ cursorThetaRad: theta, gateDepthCm: depth ?? s.gateDepthCm })),
  setQuality: (q) => set({ quality: q }),
  setBackend: (b) => set({ rendererBackend: b }),
  setMode: (m) =>
    set((s) => {
      const policy = modePolicy(m);
      return {
        mode: m,
        examFinished: false,
        viewProgress: m === 'exam' ? {} : s.viewProgress,
        measurements: m === 'exam' ? [] : s.measurements,
        ui: {
          ...s.ui,
          showHints: policy.hintsEnabled,
          showPhysics: policy.devToolsAllowed ? s.ui.showPhysics : false,
          devPanel: policy.devToolsAllowed ? s.ui.devPanel : false,
          reviewMode: policy.devToolsAllowed ? s.ui.reviewMode : false,
        },
      };
    }),
  setTargetView: (id) => set({ targetViewId: id }),
  setUi: (u) =>
    set((s) => {
      const ui = { ...s.ui, ...u };
      savePrefs(ui);
      return { ui };
    }),
  setTruth: (t, caseId) => set({ truth: t, caseId }),
  addMeasurement: (m) =>
    set((s) => {
      const progress = addEvent(s.progress, {
        t: Date.now(),
        kind: 'measurement',
        caseId: s.caseId,
        measurementId: m.measurementId ?? m.label,
        techniqueScore: m.technique?.score ?? null,
        value: m.value,
      });
      saveProgress(typeof localStorage !== 'undefined' ? localStorage : null, progress);
      return { measurements: [...s.measurements, m], progress };
    }),
  removeMeasurement: (id) =>
    set((s) => ({ measurements: s.measurements.filter((m) => m.id !== id) })),
  clearMeasurements: () => set({ measurements: [] }),
  setActiveTool: (t) => set({ activeTool: t, activeMeasurementId: null }),
  addReviewMarker: (m) =>
    set((s) => ({
      reviewMarkers: renumberMarkers([...s.reviewMarkers, m]),
      reviewSelectedId: m.id,
      // the first marker on a live image freezes it, so the markers keep the frame they were put on
      ...(m.space === 'image' && !s.frozen && s.ui.reviewFreezeOnMark
        ? { frozen: true, cineOffset: 0 }
        : {}),
    })),
  updateReviewMarker: (id, patch) =>
    set((s) => ({
      reviewMarkers: s.reviewMarkers.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    })),
  removeReviewMarker: (id) =>
    set((s) => {
      // a primary takes its secondary points with it; the batch comes back together with undo
      const goneIds = new Set([
        id,
        ...s.reviewMarkers.filter((m) => m.parentId === id).map((m) => m.id),
      ]);
      const gone = s.reviewMarkers.filter((m) => goneIds.has(m.id));
      return {
        reviewMarkers: renumberMarkers(s.reviewMarkers.filter((m) => !goneIds.has(m.id))),
        reviewUndo: gone.length ? [...s.reviewUndo.slice(-19), gone] : s.reviewUndo,
        reviewSelectedId: goneIds.has(s.reviewSelectedId ?? '') ? null : s.reviewSelectedId,
        reviewLinkParentId: goneIds.has(s.reviewLinkParentId ?? '') ? null : s.reviewLinkParentId,
      };
    }),
  clearReview: () =>
    set((s) => ({
      reviewMarkers: [],
      reviewNote: '',
      reviewSelectedId: null,
      reviewSource: null,
      reviewLinkParentId: null,
      reviewUndo: s.reviewMarkers.length
        ? [...s.reviewUndo.slice(-19), s.reviewMarkers]
        : s.reviewUndo,
    })),
  selectReviewMarker: (id) => set({ reviewSelectedId: id }),
  armReviewLink: (id) => set({ reviewLinkParentId: id }),
  undoReviewRemove: () =>
    set((s) => {
      const batch = s.reviewUndo[s.reviewUndo.length - 1];
      if (!batch) return {};
      const present = new Set([...s.reviewMarkers, ...batch].map((m) => m.id));
      // a secondary whose primary is gone for good comes back as a primary
      const restored = batch.map((m) =>
        m.parentId && !present.has(m.parentId) ? { ...m, parentId: null } : m,
      );
      return {
        reviewMarkers: renumberMarkers([...s.reviewMarkers, ...restored]),
        reviewUndo: s.reviewUndo.slice(0, -1),
        reviewSelectedId: restored[0]?.id ?? null,
      };
    }),
  setReviewNote: (note) => set({ reviewNote: note }),
  loadReviewReport: (r) => {
    const s = get();
    if (!modePolicy(s.mode).devToolsAllowed) return;
    if (r.caseId !== s.caseId) s.loadCase(r.caseId);
    const i = r.input;
    set({
      probe: { ...i.probe },
      patient: { ...i.patient },
      settings: { ...i.settings, tgcDb: [...i.settings.tgcDb] },
      modality: i.modality,
      color: { ...i.color },
      spectral: { ...i.spectral },
      cursorThetaRad: i.cursorThetaRad,
      gateDepthCm: i.gateDepthCm,
      quality: i.quality,
      rendererBackend: i.rendererBackend,
      // a frozen cine cannot be restored: the frame is replayed live at the report's probe and console
      frozen: false,
      cineOffset: 0,
      artifactLab: i.artifactOverrides,
      presetAnim: null,
      reviewMarkers: renumberMarkers(r.markers),
      reviewNote: r.note,
      reviewSelectedId: null,
      reviewLinkParentId: null,
      reviewSource: { author: r.author, createdAt: r.createdAt },
    });
    get().setUi({ reviewMode: true, consoleTab: 'revisar' });
  },
  setActiveMeasurement: (id) => {
    if (!id) return set({ activeMeasurementId: null, activeTool: 'none' });
    const spec = getMeasurementSpec(id);
    if (!spec) return set({ activeMeasurementId: null, activeTool: 'none' });
    set({ activeMeasurementId: id, activeTool: spec.tool });
  },
  setCycleInfo: (marks, lvLengthCm) => set({ phaseMarks: marks, lvLengthCm }),
  setArtifactLab: (v) => set({ artifactLab: v }),
  recordEvent: (e) =>
    set((s) => {
      const progress = addEvent(s.progress, e);
      saveProgress(typeof localStorage !== 'undefined' ? localStorage : null, progress);
      return { progress };
    }),
  completeTasks: (ids) =>
    set((s) => {
      let progress = s.progress;
      const now = Date.now();
      for (const id of ids) progress = completeTask(progress, id, now);
      if (progress === s.progress) return {};
      saveProgress(typeof localStorage !== 'undefined' ? localStorage : null, progress);
      return { progress };
    }),
  resetLearningProgress: () => {
    const progress = emptyProgress();
    saveProgress(typeof localStorage !== 'undefined' ? localStorage : null, progress);
    set({ progress });
  },
  toggleFinding: (id) =>
    set((s) => {
      const f = getFinding(id);
      let sel = s.impressionSelection.filter((x) => x !== id);
      if (!s.impressionSelection.includes(id)) {
        // exclusive groups: selecting one deselects the others of the group
        if (f?.exclusive) sel = sel.filter((x) => getFinding(x)?.exclusive !== f.exclusive);
        sel.push(id);
      }
      return { impressionSelection: sel };
    }),
  startPresetView: (viewId) => {
    if (get().mode === 'exam') return;
    const begin = (to: ProbeControl) =>
      set((s) => {
        const from = { ...s.probe };
        return {
          presetAnim: {
            from,
            to,
            startMs: performance.now(),
            durationMs: presetDurationMs(from, to),
            viewId,
          },
          targetViewId: viewId,
          frozen: false,
        };
      });
    // the pose comes from the worker's own models — the ones the image is traced from (audit B7); without a
    // worker (tests, inline mode) the main-thread copies answer, as they did before
    void frameBus
      .request({ kind: 'canonicalControl', viewId })
      .then((res) => {
        if (res && res.kind === 'canonicalControl') return begin(clampProbe(res.control));
        // no worker answered (tests, inline mode): the main-thread copies compute it, loaded on demand so the
        // anatomy engine stays out of the entry chunk
        return Promise.all([
          import('./caseModels'),
          import('@/simulator/windows/viewTargets'),
        ]).then(([cm, vt]) => {
          const { heart, thorax } = cm.getCaseModels(get().caseId, get().patient);
          begin(clampProbe(vt.canonicalControl(vt.getViewTarget(viewId), heart, thorax)));
        });
      })
      .catch((e: unknown) => {
        console.warn('preset view request failed', e instanceof Error ? e.message : e);
      });
  },
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
    set((s) =>
      (s.viewProgress[viewId] ?? 0) >= score
        ? {}
        : { viewProgress: { ...s.viewProgress, [viewId]: score } },
    ),
  finishExam: () =>
    set((s) => {
      let progress = s.progress;
      if (s.truth) {
        const caseDef = loadCaseById(s.caseId);
        const impression = scoreImpression(s.impressionSelection, expectedFindings(s.truth)).score;
        const summary = buildExamSummary(
          caseDef,
          s.truth,
          s.viewProgress,
          s.measurements,
          impression,
        );
        progress = addEvent(progress, {
          t: Date.now(),
          kind: 'exam',
          caseId: s.caseId,
          total: summary.total,
          acquisition: summary.acquisition.total,
          measurements: summary.measurements.total,
          impression,
        });
        saveProgress(typeof localStorage !== 'undefined' ? localStorage : null, progress);
      }
      return { examFinished: true, frozen: true, progress, ui: { ...s.ui, screen: 'report' } };
    }),
  resetProgress: () => set({ viewProgress: {}, examFinished: false, measurements: [] }),
  setError: (e) => set({ error: e }),
  setWorkerMode: (m) => set({ workerMode: m }),
  setFpsUi: (f) => set({ fpsUi: f }),
  resetProbe: () => set({ probe: { ...START_PROBE }, presetAnim: null }),
  loadCase: (id) =>
    set((s) => {
      const progress = addEvent(s.progress, { t: Date.now(), kind: 'case', caseId: id });
      saveProgress(typeof localStorage !== 'undefined' ? localStorage : null, progress);
      return {
        caseId: id,
        measurements: [],
        frozen: false,
        cineOffset: 0,
        probe: { ...START_PROBE },
        viewProgress: {},
        examFinished: false,
        presetAnim: null,
        impressionSelection: [],
        artifactLab: null,
        progress,
      };
    }),
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
