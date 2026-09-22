/**
 * Structure slice map: draws the beam plane of a canonical view (or an explicit control) as a
 * colour-coded map of structures without acoustics, for anatomical QA of the geometric model.
 *   npx tsx tools/offline/render/slice-map.ts [outDir] [viewIds] [caseId]   (PHASES=0,0.3)
 * Each pixel is classified in the plane: x = lateral (cm), y = depth (cm) from the beam origin.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodePng } from './png';
import { loadCaseById } from '@/cases';
import {
  classifyHeart,
  computeHeartPose,
  createHeartModel,
  heartLandmarks,
  heartToTorso,
  torsoToHeart,
} from '@/simulator/anatomy/heartModel';
import { classifyThorax, createThoraxModel } from '@/simulator/anatomy/thoraxModel';
import { STRUCTURE_RGB, TISSUE_RGB, type Rgb } from '@/simulator/anatomy/structurePalette';
import { makeSample } from '@/simulator/anatomy/tissue';
import { buildBeatTables, cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import { canonicalControl, VIEW_TARGETS } from '@/simulator/windows/viewTargets';
import { add, dot, scale, sub, v3 } from '@/core/vec3';

const outDir = process.argv[2] ?? 'tools/offline/render/out';
mkdirSync(outDir, { recursive: true });
const c = loadCaseById(process.argv[4] ?? 'normal-excellent-window');
const thorax = createThoraxModel(c.bodyHabitus, c.acousticWindow, {
  position: 'left-lateral',
  respiration: 'expiration',
  headElevationDeg: 0,
});
const heart = createHeartModel(c.anatomy, c.physiology, thorax.heartOffset, c.seed);
const landmarks = heartLandmarks(heart);
const tables = buildBeatTables(60 / c.rhythm.heartRateBpm, c.physiology, c.rhythm, c.hemodynamics);
const views = process.argv[3]
  ? process.argv[3].split(',')
  : ['plax', 'psax-av', 'psax-mv', 'psax-pm', 'a4c', 'a2c', 'a3c'];
const DEPTH = 16;
const HALF = 8; // lateral half-width (cm)
const PX = 30; // px per cm
const W = 2 * HALF * PX,
  H = DEPTH * PX;

// colours shared with the navigator's live cut map (decision 141)
const colours = STRUCTURE_RGB;
const tissueFallback = TISSUE_RGB;

for (const id of views) {
  const view = VIEW_TARGETS.find((v) => v.id === id);
  if (!view) throw new Error(`unknown view ${id}`);
  const ctrl = canonicalControl(view, heart, thorax);
  const beam = beamFrameFromPose(poseFromControl(thorax, ctrl), 1);
  const phases = (process.env['PHASES'] ?? '0,0.3').split(',').map(Number);
  for (const phase of phases) {
    const pose = computeHeartPose(heart, cycleStateAt(tables, phase));
    const rgba = new Uint8ClampedArray(W * H * 4);
    const s = makeSample();
    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        const lat = (px + 0.5) / PX - HALF;
        const dep = (py + 0.5) / PX;
        const pT = add(beam.origin, add(scale(beam.forward, dep), scale(beam.lateral, lat)));
        const pH = torsoToHeart(heart.frame, pT);
        let col: Rgb = [0, 0, 0];
        if (classifyHeart(heart, pose, pH.x, pH.y, pH.z, s))
          col = colours[s.structure] ?? tissueFallback[s.tissue] ?? [255, 0, 255];
        else if (classifyThorax(thorax, pT.x, pT.y, pT.z, s))
          col = tissueFallback[s.tissue] ?? [80, 80, 80];
        const o = (py * W + px) * 4;
        rgba[o] = col[0];
        rgba[o + 1] = col[1];
        rgba[o + 2] = col[2];
        rgba[o + 3] = 255;
      }
    }
    // landmarks in plane: white cross when within 0.5 cm of the plane, grey when within radius
    for (const lm of landmarks) {
      const pT = heartToTorso(heart.frame, lm.p);
      const d = sub(pT, beam.origin);
      const e = dot(d, beam.normal);
      if (Math.abs(e) > lm.radius) continue;
      const lat = dot(d, beam.lateral);
      const dep = dot(d, beam.forward);
      const cx = Math.round((lat + HALF) * PX),
        cy = Math.round(dep * PX);
      const v = Math.abs(e) < 0.5 ? 255 : 140;
      for (let k = -4; k <= 4; k++) {
        for (const [x, y] of [
          [cx + k, cy],
          [cx, cy + k],
        ] as const) {
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          const o = (y * W + x) * 4;
          rgba[o] = rgba[o + 1] = rgba[o + 2] = v;
        }
      }
    }
    // 1 cm grid ticks on the left edge
    for (let cm = 0; cm <= DEPTH; cm++) {
      const y = cm * PX;
      for (let x = 0; x < (cm % 5 === 0 ? 12 : 6); x++) {
        if (y >= H) continue;
        const o = (y * W + x) * 4;
        rgba[o] = rgba[o + 1] = rgba[o + 2] = 255;
      }
    }
    const file = join(outDir, `${c.id}-${id}-phase${phase.toFixed(2)}-map.png`);
    writeFileSync(file, encodePng(W, H, rgba));
    process.stdout.write(`${file}  ctrl=${JSON.stringify(ctrl)}\n`);
  }
}
void v3;
