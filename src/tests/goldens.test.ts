// @tier slow
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadCaseById } from '@/cases';
import { createHeartModel, computeHeartPose } from '@/simulator/anatomy/heartModel';
import { createThoraxModel } from '@/simulator/anatomy/thoraxModel';
import { buildBeatTables, cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { ProceduralSliceRenderer } from '@/simulator/renderer/procedural/sliceRenderer';
import {
  allocPolarFrame,
  DEFAULT_ACQUISITION,
  polarSpecFor,
  type Scene,
} from '@/simulator/renderer/types';
import { applyConsole, createConsoleState } from '@/simulator/renderer/postprocess/consolePipeline';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import { encodePng } from '../../tools/offline/render/png';

/**
 * Golden frames (spec 44.4): deterministic renders per seed, summarised as a 12×12 grid of mean
 * intensities so small floating-point differences across CPUs do not break the test while any
 * anatomical/rendering regression does. Update with `npm run golden:update` after intended changes;
 * the update also writes one PNG per frame next to the JSON so the review of a golden change is a
 * picture in the diff, not 1 152 integers. A missing reference file fails (it used to be written
 * silently, which made the test vacuous on a fresh clone without the file — engineering audit, A6).
 */
const GOLDEN_DIR = join(process.cwd(), 'src/tests/goldens');
const GOLDEN = join(GOLDEN_DIR, 'frames.json');
const UPDATE = process.argv.includes('--update') || process.env['UPDATE_GOLDENS'] === '1';
const GRID = 12;
const TOLERANCE = 6;

function grid(display: Uint8ClampedArray, lines: number, samples: number): number[] {
  const g: number[] = [];
  for (let gi = 0; gi < GRID; gi++)
    for (let gj = 0; gj < GRID; gj++) {
      let s = 0,
        n = 0;
      for (
        let li = Math.floor((gi * lines) / GRID);
        li < Math.floor(((gi + 1) * lines) / GRID);
        li++
      )
        for (
          let si = Math.floor((gj * samples) / GRID);
          si < Math.floor(((gj + 1) * samples) / GRID);
          si++
        ) {
          s += display[li * samples + si] ?? 0;
          n++;
        }
      g.push(Math.round(s / Math.max(1, n)));
    }
  return g;
}

/** The polar frame as a grey PNG (lines down, samples across): enough to see what a golden change did. */
function polarPng(display: Uint8ClampedArray, lines: number, samples: number): Buffer {
  const rgba = new Uint8ClampedArray(lines * samples * 4);
  for (let i = 0; i < lines * samples; i++) {
    const v = display[i] ?? 0;
    rgba[i * 4] = v;
    rgba[i * 4 + 1] = v;
    rgba[i * 4 + 2] = v;
    rgba[i * 4 + 3] = 255;
  }
  return encodePng(samples, lines, rgba);
}

describe('golden frames by seed', () => {
  const c = loadCaseById('normal-excellent-window');
  const thorax = createThoraxModel(c.bodyHabitus, c.acousticWindow, {
    position: 'left-lateral',
    respiration: 'expiration',
    headElevationDeg: 0,
  });
  const heart = createHeartModel(c.anatomy, c.physiology, thorax.heartOffset, c.seed);
  const tables = buildBeatTables(
    60 / c.rhythm.heartRateBpm,
    c.physiology,
    c.rhythm,
    c.hemodynamics,
  );
  const settings = { ...DEFAULT_ACQUISITION };
  const spec = polarSpecFor(settings, 'low');
  const renderer = new ProceduralSliceRenderer();
  const physics = {
    frequencyMHz: 2.5,
    harmonics: true,
    clutterLevel: 0.1,
    windowAttenuation: 0.1,
    seed: c.seed,
  };
  const results: Record<string, number[]> = {};
  const displays: Record<string, Uint8ClampedArray> = {};
  for (const id of ['plax', 'psax-pm', 'a4c', 'a2c']) {
    for (const phase of [0.0, 0.3]) {
      const ctrl = canonicalControl(getViewTarget(id), heart, thorax);
      const beam = beamFrameFromPose(poseFromControl(thorax, ctrl), 1);
      const scene: Scene = {
        heart,
        heartPose: computeHeartPose(heart, cycleStateAt(tables, phase)),
        thorax,
        physics,
      };
      const frame = allocPolarFrame(spec);
      renderer.render(scene, beam, spec, phase, frame);
      const disp = new Uint8ClampedArray(spec.lines * spec.samples);
      applyConsole(frame, settings, createConsoleState(c.seed), disp);
      results[`${id}@${phase}`] = grid(disp, spec.lines, spec.samples);
      displays[`${id}@${phase}`] = disp;
    }
  }
  it('rendering is deterministic for the same seed', () => {
    const ctrl = canonicalControl(getViewTarget('plax'), heart, thorax);
    const beam = beamFrameFromPose(poseFromControl(thorax, ctrl), 1);
    const scene: Scene = {
      heart,
      heartPose: computeHeartPose(heart, cycleStateAt(tables, 0.3)),
      thorax,
      physics,
    };
    const a = allocPolarFrame(spec),
      b = allocPolarFrame(spec);
    renderer.render(scene, beam, spec, 0.3, a);
    renderer.render(scene, beam, spec, 0.3, b);
    expect(Array.from(a.amplitude.slice(0, 500))).toEqual(Array.from(b.amplitude.slice(0, 500)));
  });
  it('matches stored goldens within tolerance', () => {
    if (UPDATE) {
      writeFileSync(GOLDEN, JSON.stringify(results, null, 0));
      for (const [k, disp] of Object.entries(displays))
        writeFileSync(join(GOLDEN_DIR, `${k}.png`), polarPng(disp, spec.lines, spec.samples));
      return;
    }
    expect(existsSync(GOLDEN), `missing ${GOLDEN}: run npm run golden:update`).toBe(true);
    const stored = JSON.parse(readFileSync(GOLDEN, 'utf8')) as Record<string, number[]>;
    const orphans = Object.keys(stored).filter((k) => !(k in results));
    expect(orphans, 'goldens stored for frames the test no longer renders').toEqual([]);
    for (const [k, v] of Object.entries(results)) {
      const s = stored[k];
      expect(s, `missing golden ${k}`).toBeDefined();
      expect(s, `golden ${k} has ${s!.length} cells, expected ${v.length}`).toHaveLength(v.length);
      let maxDiff = 0;
      for (let i = 0; i < v.length; i++)
        maxDiff = Math.max(maxDiff, Math.abs((v[i] ?? 0) - (s![i] ?? 0)));
      expect(maxDiff, `golden ${k} drifted`).toBeLessThanOrEqual(TOLERANCE);
    }
  });
});
