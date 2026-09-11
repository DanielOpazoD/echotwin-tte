import { describe, expect, it } from 'vitest';
import { ATLAS_PHASES, AtlasRenderer, decodeTransmission, encodeTransmission } from './atlasRenderer';
import { ProceduralSliceRenderer } from '../procedural/sliceRenderer';
import { allocPolarFrame, DEFAULT_ACQUISITION, polarSpecFor, type Scene } from '../types';
import { loadCaseById } from '@/cases';
import { createHeartModel, computeHeartPose } from '@/simulator/anatomy/heartModel';
import { createThoraxModel } from '@/simulator/anatomy/thoraxModel';
import { buildBeatTables, cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';

const c = loadCaseById('normal-excellent-window');
const thorax = createThoraxModel(c.bodyHabitus, c.acousticWindow, { position: 'left-lateral', respiration: 'expiration', headElevationDeg: 0 });
const heart = createHeartModel(c.anatomy, c.physiology, thorax.heartOffset);
const tables = buildBeatTables(60 / c.rhythm.heartRateBpm, c.physiology, c.rhythm, c.hemodynamics);
const spec = polarSpecFor({ ...DEFAULT_ACQUISITION, lineDensity: 'low' }, 'low');
const scene = (phase: number): Scene => ({ heart, heartPose: computeHeartPose(heart, cycleStateAt(tables, phase)), thorax, physics: { frequencyMHz: 2.5, harmonics: true, clutterLevel: 0.1, windowAttenuation: 0.1, seed: 1 } });

function meanAbsDiff(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
  return s / a.length;
}

describe('pose-conditioned atlas renderer', () => {
  it('matches the procedural renderer at an anchor pose once the anchor is complete', { timeout: 60_000 }, () => {
    const proc = new ProceduralSliceRenderer();
    const atlas = new AtlasRenderer(proc, 1);
    const ctrl = canonicalControl(getViewTarget('plax'), heart, thorax);
    const beam = beamFrameFromPose(poseFromControl(thorax, ctrl));
    const out = allocPolarFrame(spec);
    const hints = { stationary: true, budgetMs: 100, sceneAtPhase: (ph: number) => scene(ph) };
    for (let i = 0; i < ATLAS_PHASES + 2; i++) atlas.render(scene(0.25), beam, spec, 0.25, out, hints);
    expect(atlas.stats()['building']).toBe('idle');
    const ref = allocPolarFrame(spec);
    proc.render(scene(0.25), beam, spec, 0.25, ref);
    // phase 0.25 = exactly anchor phase 8/32 → one anchor, no fill; only 16-bit quantisation differs
    expect(Number(atlas.stats()['fillWeight'])).toBe(0);
    expect(meanAbsDiff(out.amplitude, ref.amplitude)).toBeLessThan(0.002);
    // a moving probe never builds anchors (one render per frame)
    const atlas2 = new AtlasRenderer(proc, 1);
    atlas2.render(scene(0.1), beam, spec, 0.1, out, { stationary: false });
    expect(atlas2.stats()['atlasAnchors']).toBe(0);
    expect(atlas2.stats()['building']).toBe('moving');
  });
  it('sweeping between PLAX and PSAX degrades continuously (no frame jumps)', { timeout: 60_000 }, () => {
    const proc = new ProceduralSliceRenderer();
    const atlas = new AtlasRenderer(proc, 1);
    const plax = canonicalControl(getViewTarget('plax'), heart, thorax);
    const out = allocPolarFrame(spec);
    let prev: Float32Array | null = null;
    const diffs: number[] = [];
    for (let rot = 0; rot <= 90; rot += 6) {
      const beam = beamFrameFromPose(poseFromControl(thorax, { ...plax, rotationDeg: plax.rotationDeg + rot }));
      atlas.render(scene(0.1), beam, spec, 0.1, out, { stationary: false });
      if (prev) diffs.push(meanAbsDiff(out.amplitude, prev));
      prev = new Float32Array(out.amplitude);
    }
    const max = Math.max(...diffs);
    const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    // frame-to-frame differences stay bounded relative to their mean: no discrete snapping
    expect(max).toBeLessThan(mean * 3.5);
  });
});

describe('atlas frame compaction', () => {
  it('transmission log encoding round-trips within 4 % over 1e-4..1', () => {
    for (const t of [1, 0.5, 0.1, 0.01, 0.001, 1e-4]) {
      const back = decodeTransmission(encodeTransmission(t));
      expect(Math.abs(back - t) / t).toBeLessThan(0.04);
    }
  });
});
