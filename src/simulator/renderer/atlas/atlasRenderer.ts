import type { BeamFrame } from '@/simulator/probe/pose';
import type { PolarFrame, PolarFrameSpec, RenderHints, RendererBackend, Scene } from '../types';
import { allocPolarFrame } from '../types';
import type { ProceduralSliceRenderer } from '../procedural/sliceRenderer';
import { qAngleBetween } from '@/core/quat';
import { qFromBasis } from '@/core/quat';
import { distance } from '@/core/vec3';

/**
 * Pose-conditioned cine atlas renderer (spec 0.2, 0.3, 33).
 *
 * Anchors are cines (PHASES raw polar frames) at quantised probe poses. For a query pose the
 * renderer selects the k nearest complete anchors by a weighted pose distance (position + orientation)
 * and blends their nearest-phase frames with normalised inverse-distance (RBF) weights. Anchors are
 * produced by an anchor source — here the procedural slice renderer of the same synthetic patient —
 * only while the probe rests (a sweep is rendered directly, so it never pays for anchor building),
 * and kept in a small LRU. When no anchor is close enough the source fills in directly, with a weight
 * that fades as anchors become available, so the image never jumps.
 *
 * Frames are stored compactly (amplitude as 16-bit fixed point, transmission as 8-bit log) and are
 * *pre-console*, so every console control stays causal on top of the atlas. Real recorded cines
 * could replace the source without changing this class.
 */
interface Anchor {
  key: string;
  beam: BeamFrame;
  spec: PolarFrameSpec;
  amp: Uint16Array[]; // per phase
  trans: Uint8Array[];
  structure: Uint8Array[];
  tissue: Uint8Array[];
  lastUse: number;
  built: number; // phases built so far
}

export const ATLAS_PHASES = 32;
const MAX_ANCHORS = 16;
const POS_QUANT_CM = 0.5;
const ANG_QUANT_DEG = 5;
const AMP_SCALE = 2048; // amplitude 0..31.99 → uint16
const TRANS_K = 9.2; // transmission 1e-4..1 → uint8 via −ln

export function encodeTransmission(t: number): number {
  const v = Math.round((-Math.log(Math.max(1e-4, Math.min(1, t))) / TRANS_K) * 255);
  return v < 0 ? 0 : v > 255 ? 255 : v;
}
export function decodeTransmission(u: number): number {
  return Math.exp((-u * TRANS_K) / 255);
}

export class AtlasRenderer implements RendererBackend {
  readonly id = 'atlas' as const;
  readonly seed: number;
  private anchors = new Map<string, Anchor>();
  private useCounter = 0;
  private lastStats: Record<string, number | string> = {};
  private fill: PolarFrame | null = null;
  private scratch: PolarFrame | null = null;

  constructor(
    private source: ProceduralSliceRenderer,
    seed: number,
  ) {
    this.seed = seed;
  }

  invalidate(): void {
    this.anchors.clear();
    this.fill = null;
  }

  stats(): Record<string, number | string> {
    return this.lastStats;
  }
  dispose(): void {
    this.anchors.clear();
  }

  private quantKey(beam: BeamFrame, spec: PolarFrameSpec): string {
    const q = (v: number, s: number): number => Math.round(v / s);
    const rot = qFromBasis(beam.lateral, beam.normal, beam.forward);
    const ang = (2 * Math.acos(Math.min(1, Math.abs(rot.w))) * 180) / Math.PI;
    const l = Math.hypot(rot.x, rot.y, rot.z) || 1;
    return [
      spec.lines,
      spec.samples,
      spec.depthCm,
      spec.sectorRad.toFixed(3),
      q(beam.origin.x, POS_QUANT_CM),
      q(beam.origin.y, POS_QUANT_CM),
      q(beam.origin.z, POS_QUANT_CM),
      q((rot.x / l) * ang, ANG_QUANT_DEG),
      q((rot.y / l) * ang, ANG_QUANT_DEG),
      q((rot.z / l) * ang, ANG_QUANT_DEG),
    ].join(',');
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
    return a.lines === b.lines && a.samples === b.samples && a.depthCm === b.depthCm && Math.abs(a.sectorRad - b.sectorRad) < 1e-6;
  }

  private buildPhase(anchor: Anchor, scene: Scene, spec: PolarFrameSpec): void {
    const p = anchor.built;
    if (!this.scratch || !AtlasRenderer.sameSpec(this.scratch.spec, spec)) this.scratch = allocPolarFrame(spec);
    const f = this.scratch;
    // the anchor cine must be rendered at the anchor pose for phase p/PHASES; the scene's heart pose is
    // rebuilt by the source from the requested phase through `scene.heartPose` provided by the caller
    this.source.render(scene, anchor.beam, spec, p / ATLAS_PHASES, f);
    const n = spec.lines * spec.samples;
    const amp = new Uint16Array(n);
    const tr = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const a = (f.amplitude[i] ?? 0) * AMP_SCALE;
      amp[i] = a > 65535 ? 65535 : a < 0 ? 0 : a;
      tr[i] = encodeTransmission(f.transmission[i] ?? 0);
    }
    anchor.amp[p] = amp;
    anchor.trans[p] = tr;
    anchor.structure[p] = new Uint8Array(f.structure);
    anchor.tissue[p] = new Uint8Array(f.tissue);
    anchor.built++;
  }

  render(scene: Scene, beam: BeamFrame, spec: PolarFrameSpec, phase: number, out: PolarFrame, hints?: RenderHints): void {
    const t0 = performance.now();
    const n = spec.lines * spec.samples;
    const candidates: { a: Anchor; d: number }[] = [];
    for (const a of this.anchors.values()) {
      if (!AtlasRenderer.sameSpec(a.spec, spec) || a.built < ATLAS_PHASES) continue;
      candidates.push({ a, d: AtlasRenderer.poseDistance(a.beam, beam) });
    }
    candidates.sort((x, y) => x.d - y.d);
    const near = candidates.slice(0, 4).filter((c) => c.d < 2.5);
    const nearest = near[0]?.d ?? Infinity;

    // Build anchors only while the probe rests: sweeps are rendered directly (one render per frame).
    const key = this.quantKey(beam, spec);
    let building: Anchor | null = null;
    if (hints?.stationary && nearest > 0.05) {
      let a = this.anchors.get(key);
      if (!a) {
        a = { key, beam, spec, amp: [], trans: [], structure: [], tissue: [], lastUse: this.useCounter, built: 0 };
        this.anchors.set(key, a);
        this.evict();
      }
      if (a.built < ATLAS_PHASES) {
        building = a;
        // the caller renders the *current* phase through `phaseScene`; anchor phases need their own heart pose
        const phasesPerFrame = hints.budgetMs && hints.budgetMs > 40 ? 2 : 1;
        for (let k = 0; k < phasesPerFrame && a.built < ATLAS_PHASES; k++) {
          const ph = a.built / ATLAS_PHASES;
          const sc = hints.sceneAtPhase ? hints.sceneAtPhase(ph) : scene;
          this.buildPhase(a, sc, spec);
        }
      }
    }

    const fillWeight = nearest === Infinity ? 1 : Math.min(1, Math.max(0, (nearest - 0.35) / 0.9));
    out.amplitude.fill(0);
    out.transmission.fill(0);
    let wsum = 0;
    const weights: number[] = [];
    for (const c of near) {
      const w = 1 / (c.d * c.d + 0.02);
      weights.push(w);
      wsum += w;
      c.a.lastUse = ++this.useCounter;
    }
    const anchorShare = 1 - fillWeight;
    const pIdx = Math.round(phase * ATLAS_PHASES) % ATLAS_PHASES; // nearest phase: crisp motion in 32 steps, no cross-fade ghosting
    if (wsum > 0 && anchorShare > 0) {
      near.forEach((c, i) => {
        const w = ((weights[i] ?? 0) / wsum) * anchorShare;
        const amp = c.a.amp[pIdx]!,
          tr = c.a.trans[pIdx]!;
        for (let k = 0; k < n; k++) {
          out.amplitude[k] = (out.amplitude[k] ?? 0) + (w * (amp[k] ?? 0)) / AMP_SCALE;
          out.transmission[k] = (out.transmission[k] ?? 0) + w * decodeTransmission(tr[k] ?? 255);
        }
        if (i === 0) {
          out.structure.set(c.a.structure[pIdx]!);
          out.tissue.set(c.a.tissue[pIdx]!);
        }
      });
    }
    if (fillWeight > 0) {
      if (!this.fill || !AtlasRenderer.sameSpec(this.fill.spec, spec)) this.fill = allocPolarFrame(spec);
      const F = this.fill;
      this.source.render(scene, beam, spec, phase, F);
      for (let k = 0; k < n; k++) {
        out.amplitude[k] = (out.amplitude[k] ?? 0) + fillWeight * (F.amplitude[k] ?? 0);
        out.transmission[k] = (out.transmission[k] ?? 0) + fillWeight * (F.transmission[k] ?? 0);
      }
      if (fillWeight > 0.5 || wsum === 0) {
        out.structure.set(F.structure);
        out.tissue.set(F.tissue);
      }
    }
    this.lastStats = {
      atlasAnchors: this.anchors.size,
      nearestAnchorDist: Number.isFinite(nearest) ? Number(nearest.toFixed(2)) : -1,
      blendedAnchors: near.length,
      fillWeight: Number(fillWeight.toFixed(2)),
      renderMs: Number((performance.now() - t0).toFixed(2)),
      building: building ? `${building.built}/${ATLAS_PHASES}` : hints?.stationary ? 'idle' : 'moving',
    };
  }

  private evict(): void {
    while (this.anchors.size > MAX_ANCHORS) {
      let oldest: Anchor | null = null;
      for (const a of this.anchors.values()) if (!oldest || a.lastUse < oldest.lastUse) oldest = a;
      if (!oldest) break;
      this.anchors.delete(oldest.key);
    }
  }
}
