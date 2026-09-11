import { normalExcellentCase } from '@/cases/normal-excellent';
import { validateCase } from '@/cases/schema';
import { createHeartModel, computeHeartPose } from '@/simulator/anatomy/heartModel';
import { createThoraxModel } from '@/simulator/anatomy/thoraxModel';
import { buildBeatTables, cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { ProceduralSliceRenderer } from '@/simulator/renderer/procedural/sliceRenderer';
import { allocPolarFrame, DEFAULT_ACQUISITION, polarSpecFor, type Scene } from '@/simulator/renderer/types';
import { applyConsole, createConsoleState } from '@/simulator/renderer/postprocess/consolePipeline';
import { computeSectorMapping, scanConvert } from '@/simulator/renderer/scanConvert';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import { canonicalControl, VIEW_TARGETS } from '@/simulator/windows/viewTargets';

const c = validateCase(normalExcellentCase).case!;
const thorax = createThoraxModel(c.bodyHabitus, c.acousticWindow, { position: 'left-lateral', respiration: 'expiration', headElevationDeg: 0 });
const heart = createHeartModel(c.anatomy, c.physiology, thorax.heartOffset, c.seed);
const tables = buildBeatTables(60 / c.rhythm.heartRateBpm, c.physiology, c.rhythm, c.hemodynamics);
const renderer = new ProceduralSliceRenderer();
const settings = { ...DEFAULT_ACQUISITION };
const spec = polarSpecFor(settings, 'medium');
const view = VIEW_TARGETS.find((v) => v.id === (process.argv[2] ?? 'plax'))!;
const beam = beamFrameFromPose(poseFromControl(thorax, canonicalControl(view, heart, thorax)), 1);
const frame = allocPolarFrame(spec);
const cs = createConsoleState(1);
const disp = new Uint8ClampedArray(spec.lines * spec.samples);
const W = 512, H = 440;
const rgba = new Uint8ClampedArray(W * H * 4);
const mapping = computeSectorMapping(spec, W, H, false);
const N = 40;
let tr = 0, tc = 0, ts = 0;
for (let i = 0; i < N; i++) {
  const phase = (i % 16) / 16;
  const scene: Scene = { heart, heartPose: computeHeartPose(heart, cycleStateAt(tables, phase)), thorax, physics: { frequencyMHz: 2.5, harmonics: true, clutterLevel: 0.1, windowAttenuation: 0.1, seed: 101 } };
  const t0 = performance.now();
  renderer.render(scene, beam, spec, phase, frame);
  const t1 = performance.now();
  applyConsole(frame, settings, cs, disp);
  const t2 = performance.now();
  scanConvert(disp, spec, mapping, rgba);
  const t3 = performance.now();
  if (i >= 10) { tr += t1 - t0; tc += t2 - t1; ts += t3 - t2; }
}
process.stdout.write(`spec ${spec.lines}x${spec.samples}  render ${(tr / (N - 10)).toFixed(1)} ms  console ${(tc / (N - 10)).toFixed(1)} ms  scan ${(ts / (N - 10)).toFixed(1)} ms\n`);
