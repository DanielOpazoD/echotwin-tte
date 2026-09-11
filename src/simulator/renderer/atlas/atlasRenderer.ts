import type { BeamFrame } from '@/simulator/probe/pose';
import type { PolarFrame, PolarFrameSpec, RenderHints, RendererBackend, Scene } from '../types';
import { qAngleBetween, qFromBasis } from '@/core/quat';
import { distance } from '@/core/vec3';

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
 */
interface Anchor {
  beam: BeamFrame;
  spec: PolarFrameSpec;
  amp: (Uint16Array | undefined)[];
  trans: (Uint8Array | undefined)[];
  structure: (Uint8Array | undefined)[];
  tissue: (Uint8Array | undefined)[];
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
/** Consecutive direct frames after which kept cines are released. */
const RELEASE_AFTER_FRAMES = 120;
const AMP_SCALE = 2048; // amplitude 0..31.99 → uint16
const TRANS_K = 9.2; // transmission 1e-4..1 → uint8 via −ln
const TRANS_LUT = Float32Array.from({ length: 256 }, (_, u) => Math.exp((-u * TRANS_K) / 255));

export function encodeTransmission(t: number): number {
  const v = Math.round((-Math.log(Math.max(1e-4, Math.min(1, t))) / TRANS_K) * 255);
  return v < 0 ? 0 : v > 255 ? 255 : v;
}
export function decodeTransmission(u: number): number {
  return Math.exp((-u * TRANS_K) / 255);
}

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
    return a.lines === b.lines && a.samples === b.samples && a.depthCm === b.depthCm && Math.abs(a.sectorRad - b.sectorRad) < 1e-6 && a.elevationSamples === b.elevationSamples && a.focusCm === b.focusCm;
  }

  render(scene: Scene, beam: BeamFrame, spec: PolarFrameSpec, phase: number, out: PolarFrame, hints?: RenderHints): void {
    const t0 = performance.now();
    const n = spec.lines * spec.samples;
    const budget = hints?.budgetMs ?? Infinity;
    if (this.sourceMs >= 0) {
      if (this.mode === 'direct' && this.sourceMs > ENTER_CACHE * budget) this.mode = 'cache';
      else if (this.mode === 'cache' && this.sourceMs < LEAVE_CACHE * budget) this.mode = 'direct';
    }
    // a source that stays fast needs no cache: release it
    this.directFrames = this.mode === 'direct' ? this.directFrames + 1 : 0;
    if (this.directFrames > RELEASE_AFTER_FRAMES && this.anchors.length) this.anchors = [];

    let best: Anchor | null = null;
    let nearest = Infinity;
    for (const a of this.anchors) {
      if (!AtlasRenderer.sameSpec(a.spec, spec)) continue;
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

    if (this.mode === 'cache' && cine && cine.filled === ATLAS_PHASES) {
      this.serve(cine, slot, out, n);
      cine.lastUse = ++this.useCounter;
      served = 'cache';
    } else if (this.mode === 'cache' && hints?.stationary && hints.sceneAtPhase) {
      // slow source at rest: the frame of this phase slot — served when kept, otherwise rendered once and kept
      cine ??= this.addAnchor(beam, spec);
      if (cine.amp[slot]) {
        this.serve(cine, slot, out, n);
        served = 'cache';
      } else {
        const slotPhase = slot / ATLAS_PHASES;
        const ts = performance.now();
        this.source.render(hints.sceneAtPhase(slotPhase), beam, spec, slotPhase, out);
        const cost = performance.now() - ts;
        this.sourceMs = this.sourceMs < 0 ? cost : this.sourceMs + COST_EMA * (cost - this.sourceMs);
        this.store(cine, slot, out, n);
        cine.filled++;
      }
      cine.lastUse = ++this.useCounter;
    } else {
      const ts = performance.now();
      this.source.render(scene, beam, spec, phase, out);
      const cost = performance.now() - ts;
      this.sourceMs = this.sourceMs < 0 ? cost : this.sourceMs + COST_EMA * (cost - this.sourceMs);
      // without a scene for arbitrary phases, keep frames that happen to fall on their slot (±¼ slot)
      if (this.mode === 'cache' && hints?.stationary && Math.abs(slotF - Math.round(slotF)) <= SLOT_TOLERANCE) {
        cine ??= this.addAnchor(beam, spec);
        if (!cine.amp[slot]) {
          this.store(cine, slot, out, n);
          cine.filled++;
        }
        cine.lastUse = ++this.useCounter;
      }
    }

    this.lastStats = {
      mode: this.mode,
      served,
      atlasAnchors: this.anchors.length,
      nearestAnchorDist: Number.isFinite(nearest) ? Number(nearest.toFixed(3)) : -1,
      cineFill: cine ? `${cine.filled}/${ATLAS_PHASES}` : '-',
      sourceMs: Number(this.sourceMs.toFixed(2)),
      renderMs: Number((performance.now() - t0).toFixed(2)),
      building: this.mode === 'direct' ? 'direct' : !hints?.stationary ? 'moving' : cine && cine.filled === ATLAS_PHASES ? 'idle' : `${cine?.filled ?? 0}/${ATLAS_PHASES}`,
    };
  }

  private addAnchor(beam: BeamFrame, spec: PolarFrameSpec): Anchor {
    const a: Anchor = {
      beam,
      spec,
      amp: new Array<Uint16Array | undefined>(ATLAS_PHASES),
      trans: new Array<Uint8Array | undefined>(ATLAS_PHASES),
      structure: new Array<Uint8Array | undefined>(ATLAS_PHASES),
      tissue: new Array<Uint8Array | undefined>(ATLAS_PHASES),
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
  }

  private serve(a: Anchor, slot: number, out: PolarFrame, n: number): void {
    const amp = a.amp[slot];
    const tr = a.trans[slot];
    const st = a.structure[slot];
    const ti = a.tissue[slot];
    if (!amp || !tr || !st || !ti) return;
    const oa = out.amplitude;
    const ot = out.transmission;
    for (let k = 0; k < n; k++) {
      oa[k] = (amp[k] ?? 0) / AMP_SCALE;
      ot[k] = TRANS_LUT[tr[k] ?? 255] ?? 0;
    }
    out.structure.set(st);
    out.tissue.set(ti);
  }
}
