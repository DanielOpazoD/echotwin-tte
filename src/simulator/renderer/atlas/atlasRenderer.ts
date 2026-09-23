import type { BeamFrame } from '@/simulator/probe/pose';
import type {
  DisplayConsole,
  PolarFrame,
  PolarFrameSpec,
  RenderHints,
  RendererBackend,
  Scene,
  ScenePhysics,
} from '../types';
import { qAngleBetween, qFromBasis } from '@/core/quat';
import { distance } from '@/core/vec3';
import { decodeTransmission, encodeTransmission, TRANS_DECODE } from '../transmissionCode';

/**
 * Render cache for slow sources (spec 0.2, 0.3, 33; decision 50).
 *
 * The image on screen must always be the image of the current probe pose. The atlas therefore never
 * substitutes a nearby pose and never blends anchors: it keeps cines (ATLAS_PHASES pre-console frames)
 * for an *identical* pose (within POSE_EPS = 0.1 mm or 0.08°).
 *
 * Policy per frame:
 *  - direct: the source (WebGL2 or CPU tracer) renders the exact pose and phase whenever its measured
 *    cost fits the frame budget (hysteresis ×1.25 / ×0.75). With WebGL2 this is the normal case and no
 *    cine is kept.
 *  - cache: only when the source is slower than the budget (CPU fallback). While the probe rests every
 *    frame is the frame of its phase slot (ATLAS_PHASES per beat, the ≤ ½-slot quantisation the cine plays
 *    back with): a slot already kept is served without rendering, an empty one is rendered once at the slot
 *    phase and kept, so the cine fills within about one beat at no more than one render per frame. Any
 *    movement beyond POSE_EPS renders the new pose at the exact phase. Up to four cines are kept;
 *    incomplete ones are evicted before complete ones.
 *
 * Frames are stored compactly (amplitude as 16-bit fixed point, transmission as 8-bit log) and are
 * pre-console, so every console control stays causal on top of the cache.
 *
 * `renderDisplay` (GPU console, decision 54) is delegated to the source only for frames rendered directly;
 * in cache mode it declines and the simulator uses `render` and the CPU console.
 */
interface Anchor {
  beam: BeamFrame;
  spec: PolarFrameSpec;
  physics: ScenePhysics;
  contact: number;
  amp: (Uint16Array | undefined)[];
  trans: (Uint8Array | undefined)[];
  structure: (Uint8Array | undefined)[];
  tissue: (Uint8Array | undefined)[];
  segment: (Uint8Array | undefined)[];
  filled: number;
  lastUse: number;
}

export const ATLAS_PHASES = 32;
/** Poses closer than this weighted distance (cm + 0.12·deg) are the same pose: 0.1 mm or 0.08°. */
export const POSE_EPS = 0.01;
const MAX_ANCHORS = 4;
/** Without `sceneAtPhase`, a directly rendered frame is kept for a slot when rendered within ±¼ slot of it (±7 ms at 65 bpm). */
const SLOT_TOLERANCE = 0.25;
const COST_EMA = 0.25;
/** Hysteresis on the measured source cost relative to the frame budget: noisy costs near the budget must not flap. */
const ENTER_CACHE = 1.25;
const LEAVE_CACHE = 0.75;
/**
 * Consecutive frames whose own cost is over ENTER_CACHE × the budget before the cache takes over (decision 179). The
 * WebGL2 source costs 9–18 ms a frame; a few frames slowed by contention (returning from another screen, a loaded
 * machine) lifted the moving average past the threshold, and the atlas sent frames through the CPU console while the
 * GPU was not slow: the E2E «GPU frames keep arriving after visiting another screen» failed on it in the main pipeline
 * and in 1 of 6 isolated runs. A source that is slow (the CPU tracer, 40–300 ms) is over the budget in every frame and
 * enters the cache four frames later.
 */
export const ENTER_AFTER_FRAMES = 4;
/**
 * Frames served from a complete cine between two direct renders that measure the source again (decision 179). At rest
 * the cache rendered nothing, so the cost it had measured stayed as it was: a source that had been slow for a moment
 * never showed it was fast again, and the GPU image did not come back while the probe rested.
 */
export const REMEASURE_EVERY = 16;
/** Consecutive direct frames after which kept cines are released. */
const RELEASE_AFTER_FRAMES = 120;
const AMP_SCALE = 2048; // amplitude 0..31.99 → uint16
export { decodeTransmission, encodeTransmission };

export type AtlasMode = 'direct' | 'cache';

export class AtlasRenderer implements RendererBackend {
  readonly id = 'atlas' as const;
  readonly seed: number;
  private anchors: Anchor[] = [];
  private useCounter = 0;
  /** Exponential moving average of the source render cost (ms); −1 until measured. */
  private sourceMs = -1;
  private mode: AtlasMode = 'direct';
  private directFrames = 0;
  /** Consecutive measured frames over ENTER_CACHE × the budget of their frame. */
  private overBudget = 0;
  /** Frames served from the cache since the source was last measured. */
  private servedSinceMeasure = 0;
  private budgetMs = Infinity;
  private lastStats: Record<string, number | string> = {};

  constructor(
    private source: RendererBackend,
    seed: number,
  ) {
    this.seed = seed;
  }

  invalidate(): void {
    this.anchors = [];
  }

  stats(): Record<string, number | string> {
    return this.lastStats;
  }

  dispose(): void {
    this.anchors = [];
  }

  /** Weighted pose distance: cm of origin offset + orientation angle scaled to cm-equivalents (1 cm ≈ 8°). */
  static poseDistance(a: BeamFrame, b: BeamFrame): number {
    const dPos = distance(a.origin, b.origin);
    const qa = qFromBasis(a.lateral, a.normal, a.forward);
    const qb = qFromBasis(b.lateral, b.normal, b.forward);
    const dAng = (qAngleBetween(qa, qb) * 180) / Math.PI;
    return dPos + dAng * 0.12;
  }

  private static sameSpec(a: PolarFrameSpec, b: PolarFrameSpec): boolean {
    return (
      a.lines === b.lines &&
      a.samples === b.samples &&
      a.depthCm === b.depthCm &&
      Math.abs(a.sectorRad - b.sectorRad) < 1e-6 &&
      a.elevationSamples === b.elevationSamples &&
      a.focusCm === b.focusCm
    );
  }

  private static samePhysics(a: ScenePhysics, b: ScenePhysics): boolean {
    return (
      a.frequencyMHz === b.frequencyMHz &&
      a.harmonics === b.harmonics &&
      a.clutterLevel === b.clutterLevel &&
      a.windowAttenuation === b.windowAttenuation &&
      a.seed === b.seed &&
      (a.beamWidth ?? 0) === (b.beamWidth ?? 0) &&
      (a.sideLobe ?? 0) === (b.sideLobe ?? 0)
    );
  }

  /** Mode of the next frame under the cost hysteresis, without changing any state. */
  private nextMode(budget: number): AtlasMode {
    if (this.sourceMs < 0) return this.mode;
    if (
      this.mode === 'direct' &&
      this.sourceMs > ENTER_CACHE * budget &&
      this.overBudget >= ENTER_AFTER_FRAMES
    )
      return 'cache';
    if (this.mode === 'cache' && this.sourceMs < LEAVE_CACHE * budget) return 'direct';
    return this.mode;
  }

  private advanceMode(budget: number): void {
    this.budgetMs = budget;
    this.mode = this.nextMode(budget);
    // a source that stays fast needs no cache: release it
    this.directFrames = this.mode === 'direct' ? this.directFrames + 1 : 0;
    if (this.directFrames > RELEASE_AFTER_FRAMES && this.anchors.length) this.anchors = [];
  }

  private measureSource(cost: number): void {
    // a measurement after a stretch served from the cache replaces the stale average
    const stale = this.servedSinceMeasure >= REMEASURE_EVERY;
    this.servedSinceMeasure = 0;
    this.sourceMs =
      this.sourceMs < 0 || stale ? cost : this.sourceMs + COST_EMA * (cost - this.sourceMs);
    this.overBudget = cost > ENTER_CACHE * this.budgetMs ? this.overBudget + 1 : 0;
  }

  renderDisplay(
    scene: Scene,
    beam: BeamFrame,
    spec: PolarFrameSpec,
    phase: number,
    out: PolarFrame,
    hints: RenderHints | undefined,
    con: DisplayConsole,
    display: Uint8ClampedArray,
  ): boolean {
    const budget = hints?.budgetMs ?? Infinity;
    if (!this.source.renderDisplay || this.nextMode(budget) !== 'direct') return false;
    const t0 = performance.now();
    this.advanceMode(budget);
    if (!this.source.renderDisplay(scene, beam, spec, phase, out, hints, con, display))
      return false;
    this.measureSource(performance.now() - t0);
    this.composeStats('direct', Infinity, null, t0, hints);
    return true;
  }

  render(
    scene: Scene,
    beam: BeamFrame,
    spec: PolarFrameSpec,
    phase: number,
    out: PolarFrame,
    hints?: RenderHints,
  ): void {
    const t0 = performance.now();
    const n = spec.lines * spec.samples;
    this.advanceMode(hints?.budgetMs ?? Infinity);

    let best: Anchor | null = null;
    let nearest = Infinity;
    for (const a of this.anchors) {
      if (
        !AtlasRenderer.sameSpec(a.spec, spec) ||
        !AtlasRenderer.samePhysics(a.physics, scene.physics) ||
        a.contact !== beam.contact
      )
        continue;
      const d = AtlasRenderer.poseDistance(a.beam, beam);
      if (d < nearest) {
        nearest = d;
        best = a;
      }
    }
    let cine: Anchor | null = best && nearest <= POSE_EPS ? best : null;
    const slotF = phase * ATLAS_PHASES;
    const slot = ((Math.round(slotF) % ATLAS_PHASES) + ATLAS_PHASES) % ATLAS_PHASES;
    let served: 'direct' | 'cache' = 'direct';
    // now and then a frame of the cache is rendered by the source instead, to measure it again
    const remeasure = this.servedSinceMeasure >= REMEASURE_EVERY;

    if (!remeasure && this.mode === 'cache' && cine && cine.filled === ATLAS_PHASES) {
      this.serve(cine, slot, out, n);
      cine.lastUse = ++this.useCounter;
      served = 'cache';
      this.servedSinceMeasure++;
    } else if (this.mode === 'cache' && hints?.stationary && hints.sceneAtPhase) {
      // slow source at rest: the frame of this phase slot — served when kept, otherwise rendered once and kept; a
      // frame that measures the source again is the slot's too, so every frame of the cache mode keeps its phase
      cine ??= this.addAnchor(beam, spec, scene.physics);
      if (cine.amp[slot] && !remeasure) {
        this.serve(cine, slot, out, n);
        served = 'cache';
        this.servedSinceMeasure++;
      } else {
        const slotPhase = slot / ATLAS_PHASES;
        const ts = performance.now();
        this.source.render(hints.sceneAtPhase(slotPhase), beam, spec, slotPhase, out);
        this.measureSource(performance.now() - ts);
        if (!cine.amp[slot]) cine.filled++;
        this.store(cine, slot, out, n);
      }
      cine.lastUse = ++this.useCounter;
    } else {
      const ts = performance.now();
      this.source.render(scene, beam, spec, phase, out);
      this.measureSource(performance.now() - ts);
      // without a scene for arbitrary phases, keep frames that happen to fall on their slot (±¼ slot)
      if (
        this.mode === 'cache' &&
        hints?.stationary &&
        Math.abs(slotF - Math.round(slotF)) <= SLOT_TOLERANCE
      ) {
        cine ??= this.addAnchor(beam, spec, scene.physics);
        if (!cine.amp[slot]) {
          this.store(cine, slot, out, n);
          cine.filled++;
        }
        cine.lastUse = ++this.useCounter;
      }
    }

    this.composeStats(served, nearest, cine, t0, hints);
  }

  private composeStats(
    served: 'direct' | 'cache',
    nearest: number,
    cine: Anchor | null,
    t0: number,
    hints: RenderHints | undefined,
  ): void {
    const src = this.source.stats();
    this.lastStats = {
      source: this.source.id,
      ...(typeof src['gpuMs'] === 'number'
        ? { gpuMs: src['gpuMs'], readMs: src['readMs'] ?? 0, output: src['output'] ?? 'float' }
        : {}),
      mode: this.mode,
      served,
      atlasAnchors: this.anchors.length,
      nearestAnchorDist: Number.isFinite(nearest) ? Number(nearest.toFixed(3)) : -1,
      cineFill: cine ? `${cine.filled}/${ATLAS_PHASES}` : '-',
      sourceMs: Number(this.sourceMs.toFixed(2)),
      renderMs: Number((performance.now() - t0).toFixed(2)),
      building:
        this.mode === 'direct'
          ? 'direct'
          : !hints?.stationary
            ? 'moving'
            : cine && cine.filled === ATLAS_PHASES
              ? 'idle'
              : `${cine?.filled ?? 0}/${ATLAS_PHASES}`,
    };
  }

  private addAnchor(beam: BeamFrame, spec: PolarFrameSpec, physics: ScenePhysics): Anchor {
    const a: Anchor = {
      beam,
      spec: { ...spec },
      physics: { ...physics },
      contact: beam.contact,
      amp: new Array<Uint16Array | undefined>(ATLAS_PHASES),
      trans: new Array<Uint8Array | undefined>(ATLAS_PHASES),
      structure: new Array<Uint8Array | undefined>(ATLAS_PHASES),
      tissue: new Array<Uint8Array | undefined>(ATLAS_PHASES),
      segment: new Array<Uint8Array | undefined>(ATLAS_PHASES),
      filled: 0,
      lastUse: ++this.useCounter,
    };
    this.anchors.push(a);
    while (this.anchors.length > MAX_ANCHORS) {
      // evict the least recently used incomplete cine first (never the one just created), then the oldest complete one
      let victim: Anchor | null = null;
      for (const c of this.anchors) {
        if (c === a) continue;
        if (!victim) {
          victim = c;
          continue;
        }
        const cDone = c.filled === ATLAS_PHASES;
        const vDone = victim.filled === ATLAS_PHASES;
        if (cDone !== vDone ? !cDone : c.lastUse < victim.lastUse) victim = c;
      }
      if (!victim) break;
      this.anchors.splice(this.anchors.indexOf(victim), 1);
    }
    return a;
  }

  private store(a: Anchor, slot: number, f: PolarFrame, n: number): void {
    const amp = new Uint16Array(n);
    const tr = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const v = (f.amplitude[i] ?? 0) * AMP_SCALE;
      amp[i] = v > 65535 ? 65535 : v < 0 ? 0 : v;
      tr[i] = encodeTransmission(f.transmission[i] ?? 0);
    }
    a.amp[slot] = amp;
    a.trans[slot] = tr;
    a.structure[slot] = f.structure.slice(0, n);
    a.tissue[slot] = f.tissue.slice(0, n);
    a.segment[slot] = f.segment.slice(0, n);
  }

  private serve(a: Anchor, slot: number, out: PolarFrame, n: number): void {
    const amp = a.amp[slot];
    const tr = a.trans[slot];
    const st = a.structure[slot];
    const ti = a.tissue[slot];
    const sg = a.segment[slot];
    if (!amp || !tr || !st || !ti || !sg) return;
    const oa = out.amplitude;
    const ot = out.transmission;
    for (let k = 0; k < n; k++) {
      oa[k] = (amp[k] ?? 0) / AMP_SCALE;
      ot[k] = TRANS_DECODE[tr[k] ?? 255] ?? 0;
    }
    out.structure.set(st);
    out.tissue.set(ti);
    out.segment.set(sg);
  }
}
