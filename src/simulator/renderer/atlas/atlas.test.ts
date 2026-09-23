// @tier slow
import { describe, expect, it } from 'vitest';
import {
  ATLAS_PHASES,
  AtlasRenderer,
  ENTER_AFTER_FRAMES,
  REMEASURE_EVERY,
  decodeTransmission,
  encodeTransmission,
} from './atlasRenderer';
import { ProceduralSliceRenderer } from '../procedural/sliceRenderer';
import {
  allocPolarFrame,
  DEFAULT_ACQUISITION,
  polarSpecFor,
  type PolarFrame,
  type PolarFrameSpec,
  type RendererBackend,
  type Scene,
} from '../types';
import { loadCaseById } from '@/cases';
import { createHeartModel, computeHeartPose } from '@/simulator/anatomy/heartModel';
import { createThoraxModel } from '@/simulator/anatomy/thoraxModel';
import { buildBeatTables, cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { beamFrameFromPose, poseFromControl, type BeamFrame } from '@/simulator/probe/pose';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';

const c = loadCaseById('normal-excellent-window');
const thorax = createThoraxModel(c.bodyHabitus, c.acousticWindow, {
  position: 'left-lateral',
  respiration: 'expiration',
  headElevationDeg: 0,
});
const heart = createHeartModel(c.anatomy, c.physiology, thorax.heartOffset);
const tables = buildBeatTables(60 / c.rhythm.heartRateBpm, c.physiology, c.rhythm, c.hemodynamics);
const spec = polarSpecFor({ ...DEFAULT_ACQUISITION, lineDensity: 'low' }, 'low');
const scene = (phase: number): Scene => ({
  heart,
  heartPose: computeHeartPose(heart, cycleStateAt(tables, phase)),
  thorax,
  physics: {
    frequencyMHz: 2.5,
    harmonics: true,
    clutterLevel: 0.1,
    windowAttenuation: 0.1,
    seed: 1,
  },
});
const plax = canonicalControl(getViewTarget('plax'), heart, thorax);
type Control = typeof plax;
const beamOf = (ctrl: Control): BeamFrame => beamFrameFromPose(poseFromControl(thorax, ctrl));

/** Delegates to the CPU tracer and counts renders, so the tests can prove the cache never adds work. */
class CountingSource implements RendererBackend {
  readonly id = 'procedural' as const;
  calls = 0;
  private inner = new ProceduralSliceRenderer();
  render(sc: Scene, b: BeamFrame, sp: PolarFrameSpec, ph: number, out: PolarFrame): void {
    this.calls++;
    this.inner.render(sc, b, sp, ph, out);
  }
  stats(): Record<string, number | string> {
    return {};
  }
  dispose(): void {}
}

const reference = new ProceduralSliceRenderer();
function directRender(beam: BeamFrame, phase: number): PolarFrame {
  const f = allocPolarFrame(spec);
  reference.render(scene(phase), beam, spec, phase, f);
  return f;
}

function meanAbsDiff(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
  return s / a.length;
}

const FULL = `${ATLAS_PHASES}/${ATLAS_PHASES}`;

/** Rest at `beam` with a zero budget (a "slow" source) stepping the phase by half a slot until the cine is complete. */
function fillCine(atlas: AtlasRenderer, beam: BeamFrame, out: PolarFrame): number {
  let frames = 0;
  for (let k = 0; k < 6 * ATLAS_PHASES && atlas.stats()['cineFill'] !== FULL; k++) {
    const ph = (k % (2 * ATLAS_PHASES)) / (2 * ATLAS_PHASES);
    atlas.render(scene(ph), beam, spec, ph, out, {
      stationary: true,
      budgetMs: 0,
      sceneAtPhase: scene,
    });
    frames++;
  }
  return frames;
}

describe('atlas render cache: the image is always the image of the current pose', () => {
  it(
    'with a source that fits the frame budget it renders the exact pose and phase and keeps no cine',
    { timeout: 60_000 },
    () => {
      const src = new CountingSource();
      const atlas = new AtlasRenderer(src, 1);
      const beam = beamOf(plax);
      const out = allocPolarFrame(spec);
      for (let i = 0; i < 40; i++)
        atlas.render(scene(0.27), beam, spec, 0.27, out, { stationary: true, budgetMs: 1e9 });
      expect(atlas.stats()['mode']).toBe('direct');
      expect(atlas.stats()['atlasAnchors']).toBe(0);
      expect(src.calls).toBe(40);
      // phase 0.27 is not a cine slot: the frame is the exact phase, not a quantised one
      expect(meanAbsDiff(out.amplitude, directRender(beam, 0.27).amplitude)).toBeLessThan(1e-9);
    },
  );

  it(
    'with a slow source at rest it fills a cine within about one beat, one render per empty slot, then serves it',
    { timeout: 60_000 },
    () => {
      const src = new CountingSource();
      const atlas = new AtlasRenderer(src, 1);
      const beam = beamOf(plax);
      const out = allocPolarFrame(spec);
      const frames = fillCine(atlas, beam, out);
      expect(atlas.stats()['cineFill']).toBe(FULL);
      // the phase advances half a slot per frame: each slot is rendered once, plus the direct frames before the
      // source has been over the budget ENTER_AFTER_FRAMES times (decision 179)
      expect(frames).toBeLessThanOrEqual(2 * ATLAS_PHASES + ENTER_AFTER_FRAMES);
      expect(src.calls).toBeLessThanOrEqual(ATLAS_PHASES + ENTER_AFTER_FRAMES);
      const callsWhenFull = src.calls;
      atlas.render(scene(0.27), beam, spec, 0.27, out, {
        stationary: true,
        budgetMs: 0,
        sceneAtPhase: scene,
      });
      expect(atlas.stats()['served']).toBe('cache');
      expect(src.calls).toBe(callsWhenFull);
      // phase 0.27 plays the frame of slot 9/32, rendered at exactly that phase: only 16-bit quantisation differs
      expect(
        meanAbsDiff(out.amplitude, directRender(beam, 9 / ATLAS_PHASES).amplitude),
      ).toBeLessThan(0.002);
    },
  );

  it(
    'any movement beyond 0.1 mm or 0.08° shows the new pose: no dead zone and no blending with the cine',
    { timeout: 120_000 },
    () => {
      const atlas = new AtlasRenderer(new CountingSource(), 1);
      const beam0 = beamOf(plax);
      const out = allocPolarFrame(spec);
      fillCine(atlas, beam0, out);
      const cineImage = directRender(beam0, 0.25);
      const moves: [string, Control][] = [
        ['rotation +0.5°', { ...plax, rotationDeg: plax.rotationDeg + 0.5 }],
        ['rotation +1°', { ...plax, rotationDeg: plax.rotationDeg + 1 }],
        ['rotation +3°', { ...plax, rotationDeg: plax.rotationDeg + 3 }],
        ['tilt +3°', { ...plax, tiltDeg: plax.tiltDeg + 3 }],
        ['rock +3°', { ...plax, rockDeg: plax.rockDeg + 3 }],
        ['slide 1 mm', { ...plax, u: plax.u + 0.1 }],
        ['slide 3 mm', { ...plax, u: plax.u + 0.3 }],
      ];
      for (const [label, ctrl] of moves) {
        const beam = beamOf(ctrl);
        const truth = directRender(beam, 0.25);
        for (const stationary of [false, true]) {
          atlas.render(scene(0.25), beam, spec, 0.25, out, {
            stationary,
            budgetMs: 0,
            sceneAtPhase: scene,
          });
          expect(atlas.stats()['served'], label).toBe('direct');
          expect(meanAbsDiff(out.amplitude, truth.amplitude), label).toBeLessThan(1e-9);
          expect(meanAbsDiff(out.amplitude, cineImage.amplitude), label).toBeGreaterThan(1e-4);
        }
      }
      // back at the cine pose the stored cine is served again
      atlas.render(scene(0.25), beam0, spec, 0.25, out, { stationary: true, budgetMs: 0 });
      expect(atlas.stats()['served']).toBe('cache');
    },
  );

  it(
    'sweeping PLAX → PSAX past a complete cine degrades continuously (no frame jumps)',
    { timeout: 120_000 },
    () => {
      const atlas = new AtlasRenderer(new CountingSource(), 1);
      const out = allocPolarFrame(spec);
      fillCine(atlas, beamOf(plax), out);
      let prev: Float32Array | null = null;
      const diffs: number[] = [];
      for (let rot = 0; rot <= 90; rot += 6) {
        const beam = beamOf({ ...plax, rotationDeg: plax.rotationDeg + rot });
        atlas.render(scene(0.1), beam, spec, 0.1, out, { stationary: false, budgetMs: 0 });
        if (prev) diffs.push(meanAbsDiff(out.amplitude, prev));
        prev = new Float32Array(out.amplitude);
      }
      const max = Math.max(...diffs);
      const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
      expect(max).toBeLessThan(mean * 3.5);
    },
  );
});

/**
 * A source whose frames cost `costs[i]` ms (busy wait) and that forms the display itself, as the WebGL2 renderer does.
 */
class TimedDisplaySource implements RendererBackend {
  readonly id = 'webgl2-procedural' as const;
  private i = 0;
  /** When set, every frame costs this much instead of following `costs`. */
  costMs: number | null = null;
  /**
   * The clock the atlas reads (ms): a frame advances it by its cost. Spent in busy waits on the real clock, a 2 ms frame
   * measured tens of ms when the CI runner was loaded (40-60) and the source never got the display back.
   */
  clock = 0;
  constructor(private costs: number[]) {}
  private spend(): void {
    this.clock += this.costMs ?? this.costs[Math.min(this.i++, this.costs.length - 1)]!;
  }
  render(): void {
    this.spend();
  }
  renderDisplay(): boolean {
    this.spend();
    return true;
  }
  stats(): Record<string, number | string> {
    return {};
  }
  dispose(): void {}
}

describe('atlas mode under contention (decision 179)', () => {
  const beam = beamOf(plax);
  const out = allocPolarFrame(spec);
  const display = new Uint8ClampedArray(spec.lines * spec.samples);
  const con = { settings: DEFAULT_ACQUISITION, state: {} } as never;
  const run = (costs: number[]) => {
    const src = new TimedDisplaySource(costs);
    const atlas = new AtlasRenderer(src, 1, () => src.clock);
    return costs.map(() =>
      atlas.renderDisplay(
        scene(0.3),
        beam,
        spec,
        0.3,
        out,
        { stationary: true, budgetMs: 10 },
        con,
        display,
      ),
    );
  };

  it('keeps a fast source direct through a burst of slow frames', () => {
    // 2 ms frames with three of 40 ms: the moving average passes 1.25 × the 10 ms budget, the source is not slow
    const onDisplay = run([2, 2, 2, 2, 40, 40, 40, 2, 2, 2, 2, 2, 2, 2]);
    expect(onDisplay.every(Boolean)).toBe(true);
  });

  it('gives the display back to a source that is fast again while the probe rests', () => {
    const src = new TimedDisplaySource([]);
    const atlas = new AtlasRenderer(src, 1, () => src.clock);
    // one frame as the simulator forms it: the display from the source, or the cache (with the CPU console)
    const frame = (k: number) => {
      const ph = (k % (2 * ATLAS_PHASES)) / (2 * ATLAS_PHASES);
      const hints = { stationary: true, budgetMs: 10, sceneAtPhase: scene };
      if (atlas.renderDisplay(scene(ph), beam, spec, ph, out, hints, con, display)) return true;
      atlas.render(scene(ph), beam, spec, ph, out, hints);
      return false;
    };
    src.costMs = 20;
    let k = 0;
    while (atlas.stats()['cineFill'] !== `${ATLAS_PHASES}/${ATLAS_PHASES}` && k < 200) frame(k++);
    expect(frame(k++)).toBe(false);
    src.costMs = 2;
    const after: boolean[] = [];
    for (let i = 0; i < REMEASURE_EVERY + 3; i++) after.push(frame(k++));
    expect(after.at(-1)).toBe(true);
  });

  it('hands a source that stays over the budget to the cache', () => {
    const onDisplay = run(Array<number>(ENTER_AFTER_FRAMES + 3).fill(20));
    expect(onDisplay.slice(0, ENTER_AFTER_FRAMES).every(Boolean)).toBe(true);
    expect(onDisplay.at(-1)).toBe(false);
  });
});

describe('atlas acquisition identity', () => {
  const phase = 0.25;
  // frames until a slow source serves from the cache: ENTER_AFTER_FRAMES direct ones, then the slot is rendered and kept
  const SETTLE = ENTER_AFTER_FRAMES + 2;
  const hints = { stationary: true, budgetMs: 0, sceneAtPhase: scene };
  const changes: [string, Partial<Scene['physics']>][] = [
    ['frequency', { frequencyMHz: 4 }],
    ['harmonics', { harmonics: false }],
    ['clutter', { clutterLevel: 0.8 }],
    ['attenuation', { windowAttenuation: 0.6 }],
    ['scatterer seed', { seed: 2 }],
    ['beam width', { beamWidth: 1 }],
  ];

  it.each(changes)('reacquires after changing %s, then reuses the new slot', (_label, patch) => {
    const src = new CountingSource();
    const atlas = new AtlasRenderer(src, 1);
    const beam = beamOf(plax);
    const out = allocPolarFrame(spec);
    for (let i = 0; i < SETTLE; i++) atlas.render(scene(phase), beam, spec, phase, out, hints);
    expect(atlas.stats()['served']).toBe('cache');
    const before = src.calls;
    const changed = (ph: number): Scene => {
      const sc = scene(ph);
      return { ...sc, physics: { ...sc.physics, ...patch } };
    };
    atlas.render(changed(phase), beam, spec, phase, out, { ...hints, sceneAtPhase: changed });
    expect(src.calls).toBe(before + 1);
    expect(atlas.stats()['served']).toBe('direct');
    const direct = allocPolarFrame(spec);
    reference.render(changed(phase), beam, spec, phase, direct);
    expect(meanAbsDiff(out.amplitude, direct.amplitude)).toBeLessThan(1e-9);
    expect(out.structure).toEqual(direct.structure);
    expect(out.tissue).toEqual(direct.tissue);
    expect(out.transmission).toEqual(direct.transmission);
    atlas.render(changed(phase), beam, spec, phase, out, { ...hints, sceneAtPhase: changed });
    expect(atlas.stats()['served']).toBe('cache');
    expect(src.calls).toBe(before + 1);
    expect(meanAbsDiff(out.amplitude, direct.amplitude)).toBeLessThanOrEqual(1 / 2048);
  });

  it('does not serve a complete cine acquired at another frequency', { timeout: 60_000 }, () => {
    const src = new CountingSource();
    const atlas = new AtlasRenderer(src, 1);
    const beam = beamOf(plax);
    const out = allocPolarFrame(spec);
    fillCine(atlas, beam, out);
    expect(atlas.stats()['cineFill']).toBe(FULL);
    const before = src.calls;
    const changed = (ph: number): Scene => {
      const sc = scene(ph);
      return { ...sc, physics: { ...sc.physics, frequencyMHz: 4 } };
    };
    atlas.render(changed(phase), beam, spec, phase, out, { ...hints, sceneAtPhase: changed });
    expect(src.calls).toBe(before + 1);
    expect(atlas.stats()['served']).toBe('direct');
    const direct = allocPolarFrame(spec);
    reference.render(changed(phase), beam, spec, phase, direct);
    expect(out.amplitude).toEqual(direct.amplitude);
  });

  it('includes coupling even when the geometric pose is unchanged', () => {
    const src = new CountingSource();
    const atlas = new AtlasRenderer(src, 1);
    const beam = beamOf(plax);
    const out = allocPolarFrame(spec);
    for (let i = 0; i < SETTLE; i++) atlas.render(scene(phase), beam, spec, phase, out, hints);
    expect(atlas.stats()['served']).toBe('cache');
    const before = src.calls;
    const changedBeam = { ...beam, contact: 0.2 };
    atlas.render(scene(phase), changedBeam, spec, phase, out, hints);
    expect(src.calls).toBe(before + 1);
    const direct = allocPolarFrame(spec);
    reference.render(scene(phase), changedBeam, spec, phase, direct);
    expect(out.amplitude).toEqual(direct.amplitude);
    atlas.render(scene(phase), changedBeam, spec, phase, out, hints);
    expect(atlas.stats()['served']).toBe('cache');
    expect(src.calls).toBe(before + 1);
  });

  it('keeps a snapshot when the caller mutates the physics object', () => {
    const src = new CountingSource();
    const atlas = new AtlasRenderer(src, 1);
    const beam = beamOf(plax);
    const out = allocPolarFrame(spec);
    const sc = scene(phase);
    const sameScene = { ...hints, sceneAtPhase: () => sc };
    for (let i = 0; i < SETTLE; i++) atlas.render(sc, beam, spec, phase, out, sameScene);
    expect(atlas.stats()['served']).toBe('cache');
    const before = src.calls;
    sc.physics.frequencyMHz = 4;
    atlas.render(sc, beam, spec, phase, out, sameScene);
    expect(src.calls).toBe(before + 1);
    const direct = allocPolarFrame(spec);
    reference.render(sc, beam, spec, phase, direct);
    expect(out.amplitude).toEqual(direct.amplitude);
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
