/**
 * Offline atlas inspection: renders the 16-phase cine of every canonical view of a case with the
 * procedural anchor source and writes a 4×4 contact sheet per view (PNG). Useful to review anchor
 * cines and to compare with future real-data anchors. Usage:
 *   npx tsx tools/offline/atlas-generation/build-atlas.ts [outDir] [caseId]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodePng } from '../render/png';
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

const outDir = process.argv[2] ?? 'tools/offline/atlas-generation/out';
const caseId = process.argv[3] ?? 'normal-excellent-window';
mkdirSync(outDir, { recursive: true });
const c = loadCaseById(caseId);
const thorax = createThoraxModel(c.bodyHabitus, c.acousticWindow, { position: 'left-lateral', respiration: 'expiration', headElevationDeg: 0 });
const heart = createHeartModel(c.anatomy, c.physiology, thorax.heartOffset, c.seed);
const tables = buildBeatTables(60 / c.rhythm.heartRateBpm, c.physiology, c.rhythm, c.hemodynamics);
const renderer = new ProceduralSliceRenderer();
const settings = { ...DEFAULT_ACQUISITION };
const spec = polarSpecFor(settings, 'low');
const PHASES = 16;
const TW = 192,
  TH = 168;
const sheet = new Uint8ClampedArray(TW * 4 * TH * 4 * 4);
const tile = new Uint8ClampedArray(TW * TH * 4);
const mapping = computeSectorMapping(spec, TW, TH, false);
for (const view of VIEW_TARGETS) {
  const ctrl = canonicalControl(view, heart, thorax);
  const beam = beamFrameFromPose(poseFromControl(thorax, ctrl), 1);
  const cs = createConsoleState(c.seed);
  for (let p = 0; p < PHASES; p++) {
    const phase = p / PHASES;
    const scene: Scene = { heart, heartPose: computeHeartPose(heart, cycleStateAt(tables, phase)), thorax, physics: { frequencyMHz: settings.frequencyMHz, harmonics: settings.harmonics, clutterLevel: c.acousticWindow.clutterLevel, windowAttenuation: c.acousticWindow.chestWallAttenuation, seed: c.seed } };
    const frame = allocPolarFrame(spec);
    renderer.render(scene, beam, spec, phase, frame);
    const disp = new Uint8ClampedArray(spec.lines * spec.samples);
    applyConsole(frame, { ...settings, persistence: 0 }, cs, disp);
    scanConvert(disp, spec, mapping, tile);
    const gx = (p % 4) * TW,
      gy = Math.floor(p / 4) * TH;
    for (let y = 0; y < TH; y++) sheet.set(tile.subarray(y * TW * 4, (y + 1) * TW * 4), ((gy + y) * TW * 4 + gx) * 4);
  }
  const file = join(outDir, `${c.id}-${view.id}-cine.png`);
  writeFileSync(file, encodePng(TW * 4, TH * 4, sheet));
  process.stdout.write(`${file}\n`);
}
