/**
 * One cardiac cycle of a canonical view through the app's CPU chain, for the realism bench (decision 344): the
 * calibrated tier, the case's physics with the blood's scatterers advancing frame by frame, the console with its
 * persistence carried across frames (warmed on the end of the cycle), scan conversion to a square canvas, and the
 * structure under each pixel. Every metric of the bench that reads the simulator's clinical image (volumes, strain,
 * decorrelation, speckle statistics) and the clips of the Turing test read these frames.
 */
import { loadCaseById } from '@/cases';
import { buildCaseModels, REST_PATIENT } from '@/simulator/anatomy/caseModels';
import { computeHeartPose, type HeartModel, type HeartPose } from '@/simulator/anatomy/heartModel';
import { Structure } from '@/simulator/anatomy/tissue';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import { acquisitionFrameRate } from '@/simulator/renderer/frameRate';
import { applyConsole, createConsoleState } from '@/simulator/renderer/postprocess/consolePipeline';
import { ProceduralSliceRenderer } from '@/simulator/renderer/procedural/sliceRenderer';
import {
  caseArtifactLevels,
  consoleArtifacts,
  scenePhysicsFor,
} from '@/simulator/renderer/scenePhysics';
import {
  buildScanLut,
  computeSectorMapping,
  scanConvertLut,
} from '@/simulator/renderer/scanConvert';
import {
  allocPolarFrame,
  CALIBRATED_TIER,
  DEFAULT_ACQUISITION,
  polarSpecFor,
  type HeartClassifier,
  type PolarFrame,
  type Scene,
} from '@/simulator/renderer/types';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import { LABEL } from '@/clinical/regionStats';

/** Canvas of the bench's clinical frames (px), the size `presentApical` measures CAMUS against. */
export const CANVAS = 640;
/** Frames of console history before the first kept one: 0.35⁶ < 0.2 % of persistence left. */
const WARMUP = 6;

export const LV_WALLS = new Set<number>([
  Structure.LvWallSeptal,
  Structure.LvWallLateral,
  Structure.LvWallAnterior,
  Structure.LvWallInferior,
  Structure.LvApex,
]);

export interface CineFrame {
  phase: number;
  /** Displayed grey 0–255 on the canvas (row-major), 0 outside the sector. */
  grey: Float32Array;
  /** Structure id under each pixel (255 outside the sector). */
  structure: Uint8Array;
  /** The pre-console linear envelope and structure of the polar frame. */
  polar: PolarFrame;
}

export interface Cine {
  caseId: string;
  view: string;
  fps: number;
  rrS: number;
  esPhase: number;
  mmPerPx: number;
  /** Apex of the sector on the canvas (px): the probe face. */
  apex: { x: number; y: number };
  frames: CineFrame[];
  /** The model's LV volume over the cycle (mL), from the beat tables, at each frame's phase. */
  modelVolumeMl: number[];
}

/** CAMUS labels of a structure id (1 LV cavity, 2 LV myocardium, 3 LA, 0 the rest). */
export function camusLabel(st: number): number {
  return st === Structure.LvCavity
    ? LABEL.cavity
    : LV_WALLS.has(st)
      ? LABEL.myocardium
      : st === Structure.LaCavity
        ? LABEL.atrium
        : LABEL.background;
}

/**
 * A cine of one cycle at the simulated scanner's acquisition rate (or `fps`), one frame per 1/fps from end-diastole.
 * `seed` picks the scatterer realization.
 */
export function renderCine(
  caseId: string,
  view: string,
  opts: {
    fps?: number;
    seed?: number;
    maxFrames?: number;
    /** Diagnostics: physics fields to override (e.g. no clutter) and the console's persistence. */
    physics?: Partial<Scene['physics']>;
    persistence?: number;
    /** Another heart in place of the analytic one (decision 346), built from the case's heart at end diastole. */
    heartClassifier?: (heart: HeartModel, endDiastole: HeartPose) => HeartClassifier;
  } = {},
): Cine {
  const c = loadCaseById(caseId);
  const { thorax, heart, tables } = buildCaseModels(c, REST_PATIENT);
  const settings = {
    ...DEFAULT_ACQUISITION,
    persistence: opts.persistence ?? DEFAULT_ACQUISITION.persistence,
  };
  const spec = polarSpecFor(settings, CALIBRATED_TIER);
  const fps = opts.fps ?? Math.min(90, acquisitionFrameRate(settings, undefined, false));
  const beam = beamFrameFromPose(
    poseFromControl(thorax, canonicalControl(getViewTarget(view), heart, thorax)),
    1,
  );
  const n = Math.min(opts.maxFrames ?? Infinity, Math.max(2, Math.round(tables.rrS * fps)));
  const heartClassifier = opts.heartClassifier?.(
    heart,
    computeHeartPose(heart, cycleStateAt(tables, 0)),
  );
  const mapping = computeSectorMapping(spec, CANVAS, CANVAS, false);
  const lut = buildScanLut(spec, mapping);
  const renderer = new ProceduralSliceRenderer();
  const artifacts = consoleArtifacts(caseArtifactLevels(c));
  const state = createConsoleState(opts.seed ?? c.seed);
  const display = new Uint8ClampedArray(spec.lines * spec.samples);
  const rgba = new Uint8ClampedArray(CANVAS * CANVAS * 4);
  const N = spec.samples;
  const frames: CineFrame[] = [];
  for (let k = -WARMUP; k < n; k++) {
    const phase = ((((k / fps) % tables.rrS) + tables.rrS) % tables.rrS) / tables.rrS;
    const scene: Scene = {
      heart,
      heartPose: computeHeartPose(heart, cycleStateAt(tables, phase)),
      thorax,
      physics: {
        ...scenePhysicsFor(c, settings, { seed: opts.seed ?? c.seed, bloodFrame: k + WARMUP }),
        ...opts.physics,
      },
      ...(heartClassifier ? { heartClassifier } : {}),
    };
    const polar = allocPolarFrame(spec);
    renderer.render(scene, beam, spec, phase, polar);
    state.frameIndex = k + WARMUP;
    applyConsole(polar, settings, state, display, artifacts);
    if (k < 0) continue;
    scanConvertLut(display, lut, rgba);
    const grey = new Float32Array(CANVAS * CANVAS);
    const structure = new Uint8Array(CANVAS * CANVAS).fill(255);
    for (let p = 0; p < CANVAS * CANVAS; p++) {
      grey[p] = rgba[p * 4]!;
      if (lut.idx[p]! >= 0) structure[p] = polar.structure[lut.li[p]! * N + lut.si[p]!]!;
    }
    frames.push({ phase, grey, structure, polar });
  }
  const vol = tables.lvVolumeMl;
  return {
    caseId,
    view,
    fps,
    rrS: tables.rrS,
    esPhase: tables.endSystoleS / tables.rrS,
    mmPerPx: 10 / mapping.pxPerCm,
    apex: { x: mapping.apexX, y: mapping.apexY },
    frames,
    modelVolumeMl: frames.map(
      (f) => vol[Math.min(vol.length - 1, Math.floor(f.phase * vol.length))]!,
    ),
  };
}

/** The CAMUS label mask of a frame. */
export function labelMask(f: CineFrame): Uint8Array {
  return Uint8Array.from(f.structure, (s) => (s === 255 ? 0 : camusLabel(s)));
}
