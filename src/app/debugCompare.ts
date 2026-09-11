import { loadCaseById } from '@/cases';
import { computeHeartPose, createHeartModel, heartLandmarks } from '@/simulator/anatomy/heartModel';
import { createThoraxModel } from '@/simulator/anatomy/thoraxModel';
import { buildBeatTables, cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { ProceduralSliceRenderer } from '@/simulator/renderer/procedural/sliceRenderer';
import { createWebgl2Renderer } from '@/simulator/renderer/gpu/webgl2Renderer';
import { allocPolarFrame, DEFAULT_ACQUISITION, polarSpecFor, type Scene } from '@/simulator/renderer/types';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';

export interface BackendComparison {
  error?: string;
  lines: number;
  samples: number;
  structureAgreement: number;
  tissueAgreement: number;
  /** mean |Δamplitude| / mean amplitude (CPU) */
  ampRelDiff: number;
  /** mean |Δtransmission| */
  transDiff: number;
  cpuMs: number;
  gpuMs: number;
  /** Most frequent structure disagreements as "cpu>gpu": count (diagnostic). */
  mismatches?: Record<string, number>;
  /** A few mismatched samples with their heart-frame coordinates (diagnostic). */
  examples?: { line: number; sample: number; cpu: number; gpu: number; hx: number; hy: number; hz: number }[];
}

/**
 * Debug/QA hook (window.__echotwin.compareBackends): renders the same canonical view with the CPU
 * reference renderer and the WebGL2 port on the main thread and reports agreement metrics. Used by
 * e2e/gpu-equivalence.spec.ts.
 */
export function compareBackends(viewId: string, phase: number, caseId = 'normal-excellent-window', tier: 'low' | 'medium' | 'high' = 'medium'): BackendComparison {
  const c = loadCaseById(caseId);
  const thorax = createThoraxModel(c.bodyHabitus, c.acousticWindow, { position: 'left-lateral', respiration: 'expiration', headElevationDeg: 0 });
  const heart = createHeartModel(c.anatomy, c.physiology, thorax.heartOffset, c.seed);
  heartLandmarks(heart);
  const tables = buildBeatTables(60 / c.rhythm.heartRateBpm, c.physiology, c.rhythm, c.hemodynamics);
  const view = getViewTarget(viewId);
  const ctrl = canonicalControl(view, heart, thorax);
  const beam = beamFrameFromPose(poseFromControl(thorax, ctrl), 1);
  const settings = DEFAULT_ACQUISITION;
  const spec = polarSpecFor(settings, tier);
  const scene: Scene = {
    heart,
    heartPose: computeHeartPose(heart, cycleStateAt(tables, phase)),
    thorax,
    physics: { frequencyMHz: settings.frequencyMHz, harmonics: settings.harmonics, clutterLevel: c.acousticWindow.clutterLevel, windowAttenuation: c.acousticWindow.chestWallAttenuation, seed: c.seed },
  };
  const empty: BackendComparison = { lines: spec.lines, samples: spec.samples, structureAgreement: 0, tissueAgreement: 0, ampRelDiff: 1, transDiff: 1, cpuMs: 0, gpuMs: 0 };
  const cpu = new ProceduralSliceRenderer();
  const fa = allocPolarFrame(spec);
  const t0 = performance.now();
  cpu.render(scene, beam, spec, phase, fa);
  const cpuMs = performance.now() - t0;
  const g = createWebgl2Renderer();
  if (!g.renderer) return { ...empty, error: g.reason, cpuMs };
  const fb = allocPolarFrame(spec);
  g.renderer.render(scene, beam, spec, phase, fb); // warm-up (shader compile, textures)
  const t1 = performance.now();
  g.renderer.render(scene, beam, spec, phase, fb);
  const gpuMs = performance.now() - t1;
  g.renderer.dispose();
  const n = spec.lines * spec.samples;
  let sAgree = 0,
    tAgree = 0,
    ampDiff = 0,
    ampSum = 0,
    trDiff = 0;
  const mm = new Map<string, number>();
  const examples: NonNullable<BackendComparison['examples']> = [];
  for (let i = 0; i < n; i++) {
    if (fa.structure[i] === fb.structure[i]) sAgree++;
    else {
      const k = `${fa.structure[i]}>${fb.structure[i]}`;
      mm.set(k, (mm.get(k) ?? 0) + 1);
      if (examples.length < 40 && i % 3 === 0) {
        const li = Math.floor(i / spec.samples), si = i % spec.samples;
        const theta = -spec.sectorRad / 2 + (spec.sectorRad * (li + 0.5)) / spec.lines;
        const r = (si + 0.5) * (spec.depthCm / spec.samples);
        const ct = Math.cos(theta), sn = Math.sin(theta);
        const px = beam.origin.x + (beam.forward.x * ct + beam.lateral.x * sn) * r;
        const py = beam.origin.y + (beam.forward.y * ct + beam.lateral.y * sn) * r;
        const pz = beam.origin.z + (beam.forward.z * ct + beam.lateral.z * sn) * r;
        const hf = heart.frame;
        const dx = px - hf.origin.x, dy = py - hf.origin.y, dz = pz - hf.origin.z;
        examples.push({ line: li, sample: si, cpu: fa.structure[i]!, gpu: fb.structure[i]!, hx: +(dx * hf.ex.x + dy * hf.ex.y + dz * hf.ex.z).toFixed(2), hy: +(dx * hf.ey.x + dy * hf.ey.y + dz * hf.ey.z).toFixed(2), hz: +(dx * hf.ez.x + dy * hf.ez.y + dz * hf.ez.z).toFixed(2) });
      }
    }
    if (fa.tissue[i] === fb.tissue[i]) tAgree++;
    ampDiff += Math.abs(fa.amplitude[i]! - fb.amplitude[i]!);
    ampSum += fa.amplitude[i]!;
    trDiff += Math.abs(fa.transmission[i]! - fb.transmission[i]!);
  }
  const mismatches = Object.fromEntries([...mm.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8));
  return { lines: spec.lines, samples: spec.samples, structureAgreement: sAgree / n, tissueAgreement: tAgree / n, ampRelDiff: ampDiff / Math.max(ampSum, 1e-6), transDiff: trDiff / n, cpuMs, gpuMs, mismatches, examples };
}
