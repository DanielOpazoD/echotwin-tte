import { loadCaseById } from '@/cases';
import { computeHeartPose, createHeartModel } from '@/simulator/anatomy/heartModel';
import { createThoraxModel } from '@/simulator/anatomy/thoraxModel';
import { buildBeatTables, cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { Structure } from '@/simulator/anatomy/tissue';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import { LABEL, orientApical, type RegionImage } from '@/clinical/regionStats';
import { ProceduralSliceRenderer } from './procedural/sliceRenderer';
import { applyConsole, createConsoleState } from './postprocess/consolePipeline';
import { buildScanLut, computeSectorMapping, scanConvertLut } from './scanConvert';
import { allocPolarFrame, DEFAULT_ACQUISITION, polarSpecFor, type AcquisitionSettings, type PolarFrame, type Scene } from './types';

/**
 * The simulator's apical images as the clinical comparison measures them (decisions 69-70): the high tier the
 * GPU shows live, through the console, scan-converted to 640 × 640 and labelled with the CAMUS convention
 * (1 LV cavity, 2 LV myocardium, 3 left atrium) from the structure map. tools/clinical/camus-compare.ts and the
 * console test both use it, so the test measures the very image the clinical comparison did.
 *
 * Rendering and presentation are separate because only the second depends on the console: a sweep of grey
 * maps, dynamic ranges and gains renders each view once.
 */
export interface ApicalRender {
  frame: PolarFrame;
  seed: number;
}

/** The console controls a clinical comparison may vary; anything else would change the render itself. */
export type ConsoleOverride = Partial<Pick<AcquisitionSettings, 'grayMap' | 'dynamicRangeDb' | 'gainDb'>>;

/** Canonical apical view of a case at end-diastole (phase 0) or end-systole (end of ejection). */
export function renderApical(caseId: string, viewId: 'a4c' | 'a2c', ed: boolean): ApicalRender {
  const c = loadCaseById(caseId);
  const thorax = createThoraxModel(c.bodyHabitus, c.acousticWindow, { position: 'left-lateral', respiration: 'expiration', headElevationDeg: 0 }, c.anatomy.ivc.collapsePct);
  const heart = createHeartModel(c.anatomy, c.physiology, thorax.heartOffset, c.seed, thorax.ivcCollapse);
  const tables = buildBeatTables(60 / c.rhythm.heartRateBpm, c.physiology, c.rhythm, c.hemodynamics);
  const phase = ed ? 0 : tables.timings.ejectionEndS / tables.rrS;
  const settings = DEFAULT_ACQUISITION;
  const spec = polarSpecFor(settings, 'high');
  const beam = beamFrameFromPose(poseFromControl(thorax, canonicalControl(getViewTarget(viewId), heart, thorax)), 1);
  const scene: Scene = {
    heart,
    heartPose: computeHeartPose(heart, cycleStateAt(tables, phase)),
    thorax,
    physics: { frequencyMHz: settings.frequencyMHz, harmonics: settings.harmonics, clutterLevel: c.acousticWindow.clutterLevel, windowAttenuation: c.acousticWindow.chestWallAttenuation, seed: c.seed },
  };
  const frame = allocPolarFrame(spec);
  new ProceduralSliceRenderer().render(scene, beam, spec, phase, frame);
  return { frame, seed: c.seed };
}

const LV_WALL = new Set<number>([Structure.LvWallSeptal, Structure.LvWallLateral, Structure.LvWallAnterior, Structure.LvWallInferior, Structure.LvApex]);

/** The displayed image of a render under a console (default acquisition unless overridden), apex up, atrium deep. */
export function presentApical(render: ApicalRender, consoleOverride: ConsoleOverride = {}): RegionImage {
  const { frame } = render;
  const spec = frame.spec;
  const settings = { ...DEFAULT_ACQUISITION, ...consoleOverride };
  const display = new Uint8ClampedArray(spec.lines * spec.samples);
  applyConsole(frame, settings, createConsoleState(render.seed), display);
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
    labels[p] = st === Structure.LvCavity ? LABEL.cavity : LV_WALL.has(st) ? LABEL.myocardium : st === Structure.LaCavity ? LABEL.atrium : LABEL.background;
  }
  const mm = 10 / mapping.pxPerCm;
  return orientApical({ width: W, height: H, grey, labels, mmPerPx: [mm, mm] });
}
