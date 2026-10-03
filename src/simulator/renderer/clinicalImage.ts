import { loadCaseById } from '@/cases';
import { computeHeartPose } from '@/simulator/anatomy/heartModel';
import { buildCaseModels, REST_PATIENT } from '@/simulator/anatomy/caseModels';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { Structure } from '@/simulator/anatomy/tissue';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import {
  imageStats,
  LABEL,
  orientApical,
  type ImageStats,
  type RegionImage,
} from '@/clinical/regionStats';
import { ProceduralSliceRenderer } from './procedural/sliceRenderer';
import {
  applyConsole,
  createConsoleState,
  type ArtifactSettings,
} from './postprocess/consolePipeline';
import { caseArtifactLevels, consoleArtifacts, scenePhysicsFor } from './scenePhysics';
import { buildScanLut, computeSectorMapping, scanConvertLut } from './scanConvert';
import { acquisitionFrameRate } from './frameRate';
import {
  allocPolarFrame,
  CALIBRATED_TIER,
  DEFAULT_ACQUISITION,
  polarSpecFor,
  type AcquisitionSettings,
  type PolarFrame,
  type Scene,
} from './types';

/**
 * The simulator's apical images as the clinical comparison measures them (decisions 69-70): the calibrated tier, the
 * one the app shows by default when the GPU forms the image (decision 154; until then it opened on the medium tier),
 * through the console, scan-converted to 640 × 640 and labelled with the CAMUS convention
 * (1 LV cavity, 2 LV myocardium, 3 left atrium) from the structure map. tools/clinical/camus-compare.ts and the
 * console test both use it, so the test measures the very image the clinical comparison did.
 *
 * Rendering and presentation are separate because only the second depends on the console: a sweep of grey
 * maps, dynamic ranges and gains renders each view once.
 */
export interface ApicalRender {
  /** The measured frame. */
  frame: PolarFrame;
  /**
   * The frames before it, oldest first, one acquisition interval apart: the console's persistence blends them into the
   * measured one as the app does (decision 258).
   */
  history: PolarFrame[];
  seed: number;
  /** The case's console artifacts, which the presentation applies as the app does. */
  artifacts: ArtifactSettings;
}

/** The console controls a clinical comparison may vary; anything else would change the render itself. */
export type ConsoleOverride = Partial<
  Pick<AcquisitionSettings, 'grayMap' | 'dynamicRangeDb' | 'gainDb' | 'depthCompensationDbPerCmMHz'>
>;

/**
 * Canonical apical view of a case at end-diastole (phase 0) or end-systole (end of ejection). `scatterSeed` picks the
 * scatterer realization (and the receiver noise of its presentation); the case seed by default.
 */
/**
 * Frames rendered for one presentation (decision 258): the measured one and the ones before it that the console's
 * persistence still holds (0.35 per frame by default: the fifth back weighs 0.35⁴ = 1.5 %).
 */
export const PERSISTENCE_FRAMES = 5;

export function renderApical(
  caseId: string,
  viewId: 'a4c' | 'a2c',
  ed: boolean,
  scatterSeed?: number,
): ApicalRender {
  const c = loadCaseById(caseId);
  const { thorax, heart, tables } = buildCaseModels(c, REST_PATIENT);
  const phase = ed ? 0 : tables.endSystoleS / tables.rrS;
  const settings = DEFAULT_ACQUISITION;
  const spec = polarSpecFor(settings, CALIBRATED_TIER);
  const beam = beamFrameFromPose(
    poseFromControl(thorax, canonicalControl(getViewTarget(viewId), heart, thorax)),
    1,
  );
  // The app shows each frame blended with the ones before it (persistence), the heart moving between them at the
  // acquisition rate and the blood's scatterers moving on (decision 258): the clinical cavity, with no pixel under grey
  // 20 at a median of 56, cannot be one frame of fully developed speckle.
  const dtPhase = 1 / acquisitionFrameRate(settings, undefined, false) / tables.rrS;
  const frames = Array.from({ length: PERSISTENCE_FRAMES }, (_, k) => {
    const ph = (((phase - (PERSISTENCE_FRAMES - 1 - k) * dtPhase) % 1) + 1) % 1;
    const scene: Scene = {
      heart,
      heartPose: computeHeartPose(heart, cycleStateAt(tables, ph)),
      thorax,
      // the app's physics, near-field clutter included (decision 238), the blood frame advancing as in the app
      physics: scenePhysicsFor(c, settings, { seed: scatterSeed ?? c.seed, bloodFrame: k }),
    };
    const frame = allocPolarFrame(spec);
    new ProceduralSliceRenderer().render(scene, beam, spec, ph, frame);
    return frame;
  });
  return {
    frame: frames[PERSISTENCE_FRAMES - 1]!,
    history: frames.slice(0, -1),
    seed: scatterSeed ?? c.seed,
    artifacts: consoleArtifacts(caseArtifactLevels(c)),
  };
}

/**
 * Scatterer realizations the clinical comparison averages over (decision 99). A frame holds one speckle realization, and
 * single-render statistics move with it: a change of the scatterer lattice that left the means over ten realizations
 * where they were (myocardial local std 12.18 → 12.14, residual skew −0.33 → −0.36) moved the declared baselines by up to
 * 0.33 quartile widths and pushed a contrast out of the range.
 */
export const SPECKLE_REALIZATIONS = 8;

/** The canonical apical view rendered once per scatterer realization (seeds follow the case seed). */
export function renderApicalRealizations(
  caseId: string,
  viewId: 'a4c' | 'a2c',
  ed: boolean,
): ApicalRender[] {
  const seed = loadCaseById(caseId).seed;
  return Array.from({ length: SPECKLE_REALIZATIONS }, (_, k) =>
    renderApical(caseId, viewId, ed, seed + k),
  );
}

const LV_WALL = new Set<number>([
  Structure.LvWallSeptal,
  Structure.LvWallLateral,
  Structure.LvWallAnterior,
  Structure.LvWallInferior,
  Structure.LvApex,
]);

/**
 * The displayed image of a render under a console (default acquisition unless overridden), apex up, atrium deep: the
 * measured frame after its history, through the console's persistence (decision 258). The console frame index selects
 * the receiver-noise realization.
 */
export function presentApical(
  render: ApicalRender,
  consoleOverride: ConsoleOverride = {},
  frameIndex = 0,
): RegionImage {
  const { frame } = render;
  const spec = frame.spec;
  const settings = { ...DEFAULT_ACQUISITION, ...consoleOverride };
  const display = new Uint8ClampedArray(spec.lines * spec.samples);
  const state = createConsoleState(render.seed);
  // the frames before the measured one pass through the same console first, each with its own receiver noise
  const sequence = [...render.history, frame];
  sequence.forEach((f, k) => {
    state.frameIndex = frameIndex * sequence.length + k;
    applyConsole(f, settings, state, display, render.artifacts);
  });
  const W = 640,
    H = 640;
  const mapping = computeSectorMapping(spec, W, H, false);
  const lut = buildScanLut(spec, mapping);
  const rgba = new Uint8ClampedArray(W * H * 4);
  scanConvertLut(display, lut, rgba);
  const grey = new Float32Array(W * H);
  const labels = new Uint8Array(W * H);
  const N = spec.samples;
  for (let p = 0; p < W * H; p++) {
    grey[p] = rgba[p * 4]!;
    if (lut.idx[p]! < 0) continue;
    const st = frame.structure[lut.li[p]! * N + lut.si[p]!]!;
    labels[p] =
      st === Structure.LvCavity
        ? LABEL.cavity
        : LV_WALL.has(st)
          ? LABEL.myocardium
          : st === Structure.LaCavity
            ? LABEL.atrium
            : LABEL.background;
  }
  const mm = 10 / mapping.pxPerCm;
  return orientApical({ width: W, height: H, grey, labels, mmPerPx: [mm, mm] });
}

/**
 * Receiver-noise realizations the clinical comparison averages every statistic over (decision 91). Band-limited noise
 * has fewer independent samples than the white noise it replaced: across six realizations of one render a statistic moves
 * with a standard deviation of up to 0.14 quartile widths, as much as the tolerance of a declared baseline.
 */
export const NOISE_REALIZATIONS = 4;

/** Image statistics of a render under a console, one per receiver-noise realization. */
export function apicalStats(
  render: ApicalRender,
  consoleOverride: ConsoleOverride = {},
  realizations = NOISE_REALIZATIONS,
): ImageStats[] {
  return Array.from({ length: realizations }, (_, fi) =>
    imageStats(presentApical(render, consoleOverride, fi)),
  );
}

/** Mean of one statistic over realizations. */
export function meanStat(stats: readonly ImageStats[], get: (s: ImageStats) => number): number {
  return stats.reduce((sum, s) => sum + get(s), 0) / stats.length;
}
