/**
 * Offline renderer: dumps canonical views of a case to PNG for visual QA and goldens.
 * Usage: npx tsx tools/offline/render/render-views.ts [outDir] [viewIds,comma,separated] [caseId]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodePng } from './png';
import { loadCaseById } from '@/cases';
import { createHeartModel, computeHeartPose } from '@/simulator/anatomy/heartModel';
import { createThoraxModel } from '@/simulator/anatomy/thoraxModel';
import { buildBeatTables, cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { ProceduralSliceRenderer } from '@/simulator/renderer/procedural/sliceRenderer';
import { allocPolarFrame, DEFAULT_ACQUISITION, polarSpecFor, type Scene } from '@/simulator/renderer/types';
import { applyConsole, createConsoleState } from '@/simulator/renderer/postprocess/consolePipeline';
import { computeSectorMapping, scanConvert } from '@/simulator/renderer/scanConvert';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import { canonicalControl, VIEW_TARGETS } from '@/simulator/windows/viewTargets';

const outDir = process.argv[2] ?? 'tools/offline/render/out';
mkdirSync(outDir, { recursive: true });
const c = loadCaseById(process.argv[4] ?? 'normal-excellent-window');
const thorax = createThoraxModel(c.bodyHabitus, c.acousticWindow, { position: 'left-lateral', respiration: 'expiration', headElevationDeg: 0 });
const heart = createHeartModel(c.anatomy, c.physiology, thorax.heartOffset, c.seed);
const tables = buildBeatTables(60 / c.rhythm.heartRateBpm, c.physiology, c.rhythm, c.hemodynamics);
const renderer = new ProceduralSliceRenderer();
const settings = { ...DEFAULT_ACQUISITION };
const spec = polarSpecFor(settings, 'medium');
const W = 512,
  H = 440;
const rgba = new Uint8ClampedArray(W * H * 4);
const mapping = computeSectorMapping(spec, W, H, false);
const views = process.argv[3] ? process.argv[3].split(',') : ['plax', 'psax-av', 'psax-mv', 'psax-pm', 'a4c', 'a2c', 'a3c'];
for (const id of views) {
  const view = VIEW_TARGETS.find((v) => v.id === id)!;
  const ctrl = canonicalControl(view, heart, thorax);
  const beam = beamFrameFromPose(poseFromControl(thorax, ctrl), 1);
  const phases = (process.env['PHASES'] ?? '0,0.3').split(',').map(Number);
  for (const phase of phases) {
    const state = cycleStateAt(tables, phase);
    const scene: Scene = {
      heart,
      heartPose: computeHeartPose(heart, state),
      thorax,
      physics: { frequencyMHz: settings.frequencyMHz, harmonics: settings.harmonics, clutterLevel: c.acousticWindow.clutterLevel, windowAttenuation: c.acousticWindow.chestWallAttenuation, seed: c.seed },
    };
    const frame = allocPolarFrame(spec);
    renderer.render(scene, beam, spec, phase, frame); // warm-up
    const t0 = performance.now();
    renderer.render(scene, beam, spec, phase, frame);
    const t1 = performance.now();
    const cs = createConsoleState(c.seed);
    const disp = new Uint8ClampedArray(spec.lines * spec.samples);
    applyConsole(frame, settings, cs, disp);
    const t2 = performance.now();
    scanConvert(disp, spec, mapping, rgba);
    const t3 = performance.now();
    const file = join(outDir, `${c.id}-${id}-phase${phase.toFixed(2)}.png`);
    writeFileSync(file, encodePng(W, H, rgba));
    process.stdout.write(`${file}  render ${(t1 - t0).toFixed(1)} ms, console ${(t2 - t1).toFixed(1)} ms, scan ${(t3 - t2).toFixed(1)} ms  ctrl=${JSON.stringify(ctrl)}\n`);
  }
}
