import { add, scale } from '@/core/vec3';
import type { BeamFrame } from '@/simulator/probe/pose';
import { Tissue } from '@/simulator/anatomy/tissue';
import type { ProceduralSliceRenderer } from '@/simulator/renderer/procedural/sliceRenderer';
import {
  allocPolarFrame,
  type PolarFrame,
  type PolarFrameSpec,
  type Scene,
  type ScenePhysics,
} from '@/simulator/renderer/types';
import type { EchoSourceId, PointExplanation } from './protocol';

/** Lines of the wedge re-formed around the point: enough for the lateral PSF and its side lobes to act as in the frame. */
export const EXPLAIN_LINES = 31;
/** The echo energy is read over ±1 line and ±EXPLAIN_HALF_SAMPLES samples around the point. */
const EXPLAIN_HALF_SAMPLES = 2;
/** A loss counts as the point's shadow when it reaches this many dB within EXPLAIN_SHADOW_WINDOW_CM. */
export const EXPLAIN_SHADOW_DB = 3;
const EXPLAIN_SHADOW_WINDOW_CM = 0.5;
/** Past this loss nothing comes back (the tracer floors the transmission): the report says so instead of a number. */
export const EXPLAIN_DROP_CAP_DB = 60;

/** Each switchable source and the physics without it. */
const ABLATIONS: { id: EchoSourceId; off: Partial<ScenePhysics> }[] = [
  { id: 'clutter', off: { clutterLevel: 0 } },
  { id: 'chestWall', off: { windowAttenuation: 0 } },
  { id: 'sideLobe', off: { sideLobe: 0 } },
  { id: 'beamWidth', off: { beamWidth: 0 } },
];

/** The beam turned by `thetaRad` in its plane, so the line through the point is the wedge's centre line. */
export function beamTowards(beam: BeamFrame, thetaRad: number): BeamFrame {
  const c = Math.cos(thetaRad),
    s = Math.sin(thetaRad);
  return {
    ...beam,
    forward: add(scale(beam.forward, c), scale(beam.lateral, s)),
    lateral: add(scale(beam.lateral, c), scale(beam.forward, -s)),
  };
}

/**
 * Where the echo at (rCm, thetaRad) of a frame comes from (decision 340). The CPU tracer forms a wedge of EXPLAIN_LINES
 * lines with the frame's line spacing, depth and sampling around the point, as shown and once without each switchable
 * source (the same scatterers in every pass, so the difference is the source and not the speckle). What a source takes
 * away from the echo energy at the point is its share. The two-way transmission down the centre line gives the shadow,
 * and the tissue at the point says whether it lies behind the pleura.
 */
export function explainPointAt(
  renderer: ProceduralSliceRenderer,
  scene: Scene,
  beam: BeamFrame,
  frameSpec: PolarFrameSpec,
  rCm: number,
  thetaRad: number,
  mirrorLevel: number,
): PointExplanation {
  const lineStep = frameSpec.sectorRad / frameSpec.lines;
  const spec: PolarFrameSpec = {
    ...frameSpec,
    lines: EXPLAIN_LINES,
    sectorRad: lineStep * EXPLAIN_LINES,
  };
  const wedge = beamTowards(beam, thetaRad);
  const centre = (EXPLAIN_LINES - 1) >> 1;
  const si = Math.min(
    spec.samples - 1,
    Math.max(0, Math.floor((rCm / spec.depthCm) * spec.samples)),
  );
  const energy = (f: PolarFrame): number => {
    let e = 0,
      n = 0;
    for (let li = centre - 1; li <= centre + 1; li++)
      for (let k = si - EXPLAIN_HALF_SAMPLES; k <= si + EXPLAIN_HALF_SAMPLES; k++) {
        if (k < 0 || k >= spec.samples) continue;
        const a = f.amplitude[li * spec.samples + k]!;
        e += a * a;
        n++;
      }
    return n ? e / n : 0;
  };
  const base = allocPolarFrame(spec);
  renderer.render(scene, wedge, spec, 0, base);
  const e0 = energy(base);
  const idx = centre * spec.samples + si;
  const structure = base.structure[idx]!;
  const tissue = base.tissue[idx]!;

  const sources: PointExplanation['sources'] = [];
  const scratch = allocPolarFrame(spec);
  for (const a of ABLATIONS) {
    const physics = { ...scene.physics, ...a.off };
    const unchanged = (Object.keys(a.off) as (keyof ScenePhysics)[]).every(
      (k) => (scene.physics[k] ?? 0) === (physics[k] ?? 0),
    );
    if (unchanged) continue;
    renderer.render({ ...scene, physics }, wedge, spec, 0, scratch);
    const e = energy(scratch);
    const share = e0 > 0 ? Math.max(0, Math.min(1, 1 - e / e0)) : 0;
    if (share > 0.005)
      sources.push({ id: a.id, share, db: e > 0 ? 10 * Math.log10(e0 / e) : Infinity });
  }
  sources.sort((p, q) => q.share - p.share);
  // shares are measured one source at a time: they can overlap, so what is left is bounded below by zero
  const ownShare = Math.max(0, 1 - sources.reduce((m, x) => m + x.share, 0));

  // the two-way transmission down the centre line (an amplitude factor, soft-tissue loss included), and its steepest
  // loss over the shadow window before the point: soft tissue loses about 1 dB in 5 mm, a rib, the lung or calcium more
  const tDb = (k: number): number =>
    20 * Math.log10(Math.max(1e-12, base.transmission[centre * spec.samples + k]!));
  const dr = spec.depthCm / spec.samples;
  const win = Math.max(1, Math.round(EXPLAIN_SHADOW_WINDOW_CM / dr));
  let shadow: PointExplanation['shadow'] = null;
  for (let k = win; k <= si; k++) {
    const drop = tDb(k - win) - tDb(k);
    if (drop < EXPLAIN_SHADOW_DB || (shadow && drop <= shadow.dropDb)) continue;
    // the loss is the structure where the transmission falls most within the window, not the window's middle
    let at = k,
      step = -Infinity;
    for (let j = k - win + 1; j <= k; j++) {
      const d = tDb(j - 1) - tDb(j);
      if (d > step) {
        step = d;
        at = j;
      }
    }
    const c = centre * spec.samples + at;
    shadow = {
      structure: base.structure[c]!,
      tissue: base.tissue[c]!,
      atCm: (at + 0.5) * dr,
      dropDb: Math.min(EXPLAIN_DROP_CAP_DB, drop),
    };
  }
  return {
    rCm,
    thetaRad,
    structure,
    tissue,
    behindPleura: tissue === Tissue.Lung,
    transmissionDb: tDb(si),
    shadow,
    sources,
    ownShare,
    mirrorLevel,
  };
}
