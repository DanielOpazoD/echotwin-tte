import { create } from 'zustand';
import type { ProbeControl } from '@/simulator/probe/pose';
import type { PatientState } from '@/simulator/anatomy/thoraxModel';
import {
  DEFAULT_ACQUISITION,
  type AcquisitionSettings,
  type ImagingModality,
} from '@/simulator/renderer/types';
import { DEFAULT_COLOR, type ColorSettings } from '@/simulator/doppler/color/colorDoppler';
import {
  DEFAULT_SPECTRAL,
  SPECTRAL_MODE_DEFAULTS,
  spectralVelocitySetup,
  type SpectralModality,
  type SpectralSettings,
  type SpectralVelocitySetup,
} from '@/simulator/doppler/spectral/spectrum';
import {
  DEFAULT_QUALITY,
  type QualityChoice,
  type RendererBackendChoice,
  type SimOutput,
} from '@/simulator/core/protocol';
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
  type ProgressState,
} from '@/education/progress';
import { getFinding } from '@/education/impression';
import { examSummaryOf, impressionCorrected } from './examSummary';
import type { ExamSummary } from '@/education/scoring/scoring';
import type { PhaseMarks } from '@/simulator/core/protocol';
import { frameBus } from './frameBus';
import { easeInOut, lerpControl, presetDurationMs } from '@/simulator/probe/interpolate';
import { modePolicy, type ProductMode } from './modePolicy';
import { isSpectralModality } from '@/simulator/renderer/modality';

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
  /**
   * The view guide (score, hints, details, causes) under the navigator; hidden until asked for (decision 141) and
   * hidden again at every load: it is not persisted (decision 188).
   */
  guidanceOpen: boolean;
  /** The keyboard shortcuts sheet over the simulator («?» or the ⋯ menu, decision 185). Not persisted. */
  shortcutsOpen: boolean;
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
  /** Room mode (decision 205): the chrome dims and only the image keeps its light, as in a dark echo room. */
  roomMode: boolean;
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
  /**
   * The frozen cine replays as a loop (decision 191). Any frame the learner picks by hand, a tool, review mode, the
   * freeze and the modality stop it, so a measurement or a marker never lands on a frame the loop chose (decision 197).
   */
  cinePlaying: boolean;
  color: ColorSettings;
  /** The spectral settings of the mode on screen; each spectral mode keeps its own velocity window (decision 230). */
  spectral: SpectralSettings;
  /** The velocity settings each spectral mode had when the learner left it, restored on return (decision 230). */
  spectralByMode: Partial<Record<SpectralModality, SpectralVelocitySetup>>;
  cursorThetaRad: number;
  gateDepthCm: number;
  quality: QualityChoice;
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
  completeTasks: (taskIds: string[]) => void;
  resetLearningProgress: () => void;
  /** Structured impression selected by the learner for the current case. */
  impressionSelection: string[];
  /** The learner pressed «Corregir» on the impression (practice; the exam corrects it when finished, decision 257). */
  impressionChecked: boolean;
  toggleFinding: (id: string) => void;
  /** «Corregir»: shows which findings were right; the sheet stays closed until «Rehacer». */
  checkImpression: () => void;
  /** «Rehacer»: an empty sheet, not yet corrected. */
  redoImpression: () => void;
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
  /**
   * Best score of each view reached by moving the probe (decision 174): a view whose preset the learner used in this case
   * keeps its score in `viewProgress` but adds nothing here until the case is loaded again. The curriculum reads this.
   */
  handViewProgress: Record<string, number>;
  /** Views whose preset was used since the case was loaded. */
  presetViews: string[];
  /** Preset view in progress: the probe is moved continuously to the canonical pose (never teleported). */
  presetAnim: {
    from: ProbeControl;
    to: ProbeControl;
    startMs: number;
    durationMs: number;
    viewId: string;
  } | null;
  examFinished: boolean;
  /**
   * The exam's summary as it was when the learner finished, the one recorded for the teacher and the one the report shows
   * (decision 236): recomputed from the live session, it drifted from the record as soon as anything changed after.
   */
  examResult: ExamSummary | null;
  error: string | null;
  workerMode: 'worker' | 'inline' | 'starting';
  /** The 3D navigator has its model (decision 203): the start screen ticks it off. Not persisted. */
  navigatorReady: boolean;
  fpsUi: number;
  setProbe: (p: Partial<ProbeControl>) => void;
  nudgeProbe: (p: Partial<ProbeControl>) => void;
  setPatient: (p: Partial<PatientState>) => void;
  setSettings: (s: Partial<AcquisitionSettings>) => void;
  setTgc: (band: number, db: number) => void;
  setModality: (m: ImagingModality) => void;
  toggleFreeze: () => void;
  setCineOffset: (o: number) => void;
  /** One step of the cine loop: the next frame, the newest wrapping to the oldest; it keeps the loop playing. */
  stepCine: () => void;
  setCinePlaying: (p: boolean) => void;
  setColor: (c: Partial<ColorSettings>) => void;
  setSpectral: (s: Partial<SpectralSettings>) => void;
  setCursor: (theta: number, depth?: number) => void;
  setQuality: (q: QualityChoice) => void;
  setBackend: (b: RendererBackendChoice) => void;
  setMode: (m: ProductMode) => void;
  setTargetView: (id: string | null) => void;
  /**
   * «Abrir tarea» of the curriculum: the task's case (loaded only when it is not the current one, so the session is kept)
   * and its view as the target of the guided mode, with the view guide open on the simulator.
   */
  openTask: (task: { caseId?: string; viewId?: string }) => void;
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
  /** Advance the preset animation; called from the animation loop. */
  tickPresetAnimation: (nowMs: number) => void;
  finishExam: () => void;
  resetProgress: () => void;
  setError: (e: string | null) => void;
  setWorkerMode: (m: SimStore['workerMode']) => void;
  setNavigatorReady: (ready: boolean) => void;
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

/** The layers the 3D navigator draws: the saved ones, or in exam mode only the skin and the ribs (decision 256). */
export interface NavigatorLayers {
  skin: boolean;
  skeleton: boolean;
  heart: boolean;
  chambers: boolean;
  valves: boolean;
  vessels: boolean;
  cut: boolean;
  split: boolean;
  windows: boolean;
  axes: boolean;
}
export function navigatorLayers(s: Pick<SimStore, 'mode' | 'ui'>): NavigatorLayers {
  if (!modePolicy(s.mode).navigatorAnatomy)
    return {
      skin: true,
      skeleton: true,
      heart: false,
      chambers: false,
      valves: false,
      vessels: false,
      cut: false,
      split: false,
      windows: false,
      axes: false,
    };
  return {
    skin: s.ui.navSkin,
    skeleton: s.ui.showSkeleton,
    heart: s.ui.navHeart,
    chambers: s.ui.navChambers,
    valves: s.ui.navValves,
    vessels: s.ui.navVessels,
    cut: s.ui.navCut,
    split: s.ui.navSplit,
    windows: s.ui.navWindows,
    axes: s.ui.navAxes,
  };
}

/** The segment layer of the ultrasound image (decision 153), off in exam mode like the others. */
export function imageSegmentsOn(s: Pick<SimStore, 'mode' | 'ui'>): boolean {
  return s.ui.imageSegments && modePolicy(s.mode).hintsEnabled;
}

/**
 * The LV segment under the pointer, wherever it is — the image, the cut map, the 3D heart or the polar map — so the
 * others highlight it too (decision 153). Its own store: it changes as the mouse moves and is never persisted.
 */
/** The structure under the pointer on the cut map (decision 202): the image outlines it in return. */
export const useStructureHover = create<{
  id: number | null;
  setHover: (id: number | null) => void;
}>((set) => ({ id: null, setHover: (id) => set((s) => (s.id === id ? s : { id })) }));

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

/**
 * How the short-axis cut on the image sits against the polar map (decision 181): the angle of the map (degrees from
 * anterior, counter-clockwise toward the septum) that the top of the image shows, and whether the RV insertions are
 * marked on the image. Null and false when the segment layer is off or the cut is not a short axis.
 */
export const useSegmentOrientation = create<{
  upDeg: number | null;
  insertions: boolean;
  set: (upDeg: number | null, insertions: boolean) => void;
}>((set, get) => ({
  upDeg: null,
  insertions: false,
  set: (upDeg, insertions) => {
    const cur = get();
    const up = upDeg === null ? null : Math.round(upDeg);
    if (cur.upDeg !== up || cur.insertions !== insertions) set({ upDeg: up, insertions });
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
    if (!raw) return {};
    const prefs = JSON.parse(raw) as Partial<UiPrefs>;
    // the view guide always starts hidden (decision 188): a save from before kept it open across sessions
    delete prefs.guidanceOpen;
    return prefs;
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
      reviewFreezeOnMark,
      railMini,
      minimal,
      roomMode,
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
        reviewFreezeOnMark,
        railMini,
        minimal,
        roomMode,
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
  cinePlaying: false,
  color: { ...DEFAULT_COLOR },
  spectral: { ...DEFAULT_SPECTRAL },
  spectralByMode: {},
  cursorThetaRad: 0.05,
  gateDepthCm: 9,
  quality: DEFAULT_QUALITY,
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
    shortcutsOpen: false,
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
    roomMode: false,
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
  impressionChecked: false,
  artifactLab: null,
  phaseMarks: null,
  lvLengthCm: null,
  viewProgress: {},
  handViewProgress: {},
  presetViews: [],
  presetAnim: null,
  examFinished: false,
  examResult: null,
  error: null,
  workerMode: 'starting',
  navigatorReady: false,
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
  setModality: (m) =>
    set((s) => {
      const out: Partial<SimStore> = {
        modality: m,
        frozen: false,
        cineOffset: 0,
        cinePlaying: false,
      };
      // each spectral mode opens with its own velocity window, or with the one the learner left it with (decision 230)
      const from = isSpectralModality(s.modality) ? (s.modality as SpectralModality) : null;
      const to = isSpectralModality(m) ? (m as SpectralModality) : null;
      if (from && from !== to)
        out.spectralByMode = { ...s.spectralByMode, [from]: spectralVelocitySetup(s.spectral) };
      if (to && to !== from) {
        const memory = (out.spectralByMode ?? s.spectralByMode)[to];
        out.spectral = { ...s.spectral, ...(memory ?? SPECTRAL_MODE_DEFAULTS[to]) };
      }
      return out;
    }),
  toggleFreeze: () => set((s) => ({ frozen: !s.frozen, cineOffset: 0, cinePlaying: false })),
  setCineOffset: (o) =>
    set(() => ({
      cineOffset: Math.min(0, Math.max(-((useHudStore.getState().hud?.cineLength ?? 1) - 1), o)),
      cinePlaying: false,
    })),
  stepCine: () =>
    set((s) => {
      const length = useHudStore.getState().hud?.cineLength ?? 1;
      return { cineOffset: s.cineOffset >= 0 ? -(length - 1) : s.cineOffset + 1 };
    }),
  setCinePlaying: (p) => set({ cinePlaying: p }),
  setColor: (c) => set((s) => ({ color: { ...s.color, ...c } })),
  setSpectral: (sp) => set((s) => ({ spectral: { ...s.spectral, ...sp } })),
  setCursor: (theta, depth) =>
    set((s) => ({ cursorThetaRad: theta, gateDepthCm: depth ?? s.gateDepthCm })),
  setQuality: (q) => set({ quality: q }),
  setBackend: (b) => set({ rendererBackend: b }),
  setMode: (m) =>
    set((s) => {
      const policy = modePolicy(m);
      // an exam starts from scratch, as a case load does: the pose, the impression, the preset and the artifact lab left
      // behind by the practice would otherwise be scored as the learner's (A4C scored 97 the instant the exam began)
      return {
        mode: m,
        examFinished: false,
        examResult: null,
        ...(m === 'exam' ? freshSession() : {}),
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
  openTask: (task) => {
    const st = get();
    if (task.caseId && task.caseId !== st.caseId) st.loadCase(task.caseId);
    if (get().mode !== 'guided') get().setMode('guided');
    set((s) => ({
      targetViewId: task.viewId ?? null,
      ui: { ...s.ui, screen: 'simulator', guidanceOpen: Boolean(task.viewId) || s.ui.guidanceOpen },
    }));
  },
  setUi: (u) =>
    set((s) => {
      const ui = { ...s.ui, ...u };
      savePrefs(ui);
      return u.reviewMode ? { ui, cinePlaying: false } : { ui };
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
  setActiveTool: (t) =>
    set({
      activeTool: t,
      activeMeasurementId: null,
      ...(t !== 'none' ? { cinePlaying: false } : {}),
    }),
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
      if (!batch) return s;
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
    set({ activeMeasurementId: id, activeTool: spec.tool, cinePlaying: false });
  },
  setCycleInfo: (marks, lvLengthCm) => set({ phaseMarks: marks, lvLengthCm }),
  setArtifactLab: (v) => set({ artifactLab: v }),
  completeTasks: (ids) =>
    set((s) => {
      let progress = s.progress;
      const now = Date.now();
      for (const id of ids) progress = completeTask(progress, id, now);
      if (progress === s.progress) return s;
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
      // the answer sheet closes when the exam is finished (decision 236) and, in practice, once corrected (decision 257)
      if (impressionCorrected(s)) return s;
      const f = getFinding(id);
      let sel = s.impressionSelection.filter((x) => x !== id);
      if (!s.impressionSelection.includes(id)) {
        // exclusive groups: selecting one deselects the others of the group
        if (f?.exclusive) sel = sel.filter((x) => getFinding(x)?.exclusive !== f.exclusive);
        sel.push(id);
      }
      return { impressionSelection: sel };
    }),
  checkImpression: () =>
    set((s) =>
      s.mode === 'exam' || !s.impressionSelection.length ? s : { impressionChecked: true },
    ),
  redoImpression: () =>
    set((s) => (s.mode === 'exam' ? s : { impressionSelection: [], impressionChecked: false })),
  startPresetView: (viewId) => {
    if (get().mode === 'exam') return;
    // from now on this view's score is the preset's, not the learner's (decision 174)
    if (!get().presetViews.includes(viewId))
      set((s) => ({ presetViews: [...s.presetViews, viewId] }));
    const token = ++presetToken;
    const begin = (to: ProbeControl) =>
      set((s) => {
        // the pose arrives asynchronously: a session started or a preset cancelled meanwhile does not get it, even if it
        // went back to practice by then
        if (token !== presetToken || s.mode === 'exam') return s;
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
  tickPresetAnimation: (nowMs) =>
    set((s) => {
      const a = s.presetAnim;
      if (!a) return s;
      const t = (nowMs - a.startMs) / a.durationMs;
      const probe = lerpControl(a.from, a.to, easeInOut(t));
      return t >= 1 ? { probe: a.to, presetAnim: null } : { probe };
    }),
  recordViewScore: (viewId, score) =>
    set((s) => {
      // the same state when nothing changes: a new one, even empty, notifies every subscriber (decision 173)
      const overall = (s.viewProgress[viewId] ?? 0) < score;
      // a view reached with its preset does not count as acquired by hand (decision 174)
      const handBefore = s.handViewProgress[viewId] ?? 0;
      const byHand = !s.presetViews.includes(viewId) && handBefore < score;
      if (!overall && !byHand) return s;
      // the learner's record keeps only what they reached by hand, and only the first score and each rise of 5 points
      // or more over the best so far, so that a preset or a score that wavers does not fill it (decision 236)
      const record = byHand && (score >= handBefore + 5 || handBefore === 0);
      const progress = record
        ? addEvent(s.progress, { t: Date.now(), kind: 'view', caseId: s.caseId, viewId, score })
        : s.progress;
      if (record) saveProgress(typeof localStorage !== 'undefined' ? localStorage : null, progress);
      return {
        viewProgress: overall ? { ...s.viewProgress, [viewId]: score } : s.viewProgress,
        handViewProgress: byHand ? { ...s.handViewProgress, [viewId]: score } : s.handViewProgress,
        progress,
      };
    }),
  finishExam: () =>
    set((s) => {
      let progress = s.progress;
      // the summary the report shows, not a second computation of it (decision 236)
      const summary = examSummaryOf(s);
      if (summary) {
        progress = addEvent(progress, {
          t: Date.now(),
          kind: 'exam',
          caseId: s.caseId,
          total: summary.total,
          acquisition: summary.acquisition.total,
          measurements: summary.measurements.total,
          impression: summary.impression,
        });
        saveProgress(typeof localStorage !== 'undefined' ? localStorage : null, progress);
      }
      return {
        examFinished: true,
        examResult: summary,
        frozen: true,
        progress,
        ui: { ...s.ui, screen: 'report' },
      };
    }),
  resetProgress: () =>
    set({
      viewProgress: {},
      handViewProgress: {},
      presetViews: [],
      examFinished: false,
      examResult: null,
      measurements: [],
    }),
  setError: (e) => set({ error: e }),
  setWorkerMode: (m) => set({ workerMode: m }),
  setNavigatorReady: (ready) => set({ navigatorReady: ready }),
  setFpsUi: (f) => set({ fpsUi: f }),
  resetProbe: () => set({ probe: { ...START_PROBE }, presetAnim: null }),
  loadCase: (id) =>
    set((s) => {
      const progress = addEvent(s.progress, { t: Date.now(), kind: 'case', caseId: id });
      saveProgress(typeof localStorage !== 'undefined' ? localStorage : null, progress);
      return { caseId: id, ...freshSession(), progress };
    }),
}));

/** The preset pose request in flight: a later request, a cancellation or a fresh session supersedes it. */
let presetToken = 0;

/**
 * What a session starts from, when a case is loaded and when an exam begins (decision 235): one list, so that the two
 * cannot drift apart (the exam start left the artifact lab on and the case load the target view).
 */
function freshSession() {
  presetToken++;
  return {
    measurements: [],
    frozen: false,
    cineOffset: 0,
    probe: { ...START_PROBE },
    viewProgress: {},
    handViewProgress: {},
    presetViews: [],
    examFinished: false,
    examResult: null,
    presetAnim: null,
    targetViewId: null,
    impressionSelection: [],
    impressionChecked: false,
    artifactLab: null,
  };
}

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
