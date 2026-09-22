import { loadCaseById } from '@/cases';
import { computeHeartPose } from '@/simulator/anatomy/heartModel';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { buildCaseModels } from '@/simulator/anatomy/caseModels';
import { ProceduralSliceRenderer } from '@/simulator/renderer/procedural/sliceRenderer';
import { createWebgl2Renderer } from '@/simulator/renderer/gpu/webgl2Renderer';
import { enumDefinesGlsl } from '@/simulator/renderer/gpu/glslCommon';
import {
  allocPolarFrame,
  DEFAULT_ACQUISITION,
  polarSpecFor,
  type AcquisitionSettings,
  type Scene,
} from '@/simulator/renderer/types';
import { applyConsole, createConsoleState } from '@/simulator/renderer/postprocess/consolePipeline';
import {
  buildScanLut,
  computeSectorMapping,
  scanConvertLut,
} from '@/simulator/renderer/scanConvert';
import {
  DEFAULT_COLOR,
  overlayColorField,
  type ColorSettings,
} from '@/simulator/doppler/color/colorDoppler';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';

export interface BackendComparison {
  error?: string;
  lines: number;
  samples: number;
  structureAgreement: number;
  tissueAgreement: number;
  /**
   * Σ|a − b| / Σa over the samples both backends label alike: the parity of the acoustic chain. The boundary samples
   * that float precision labels differently on the two sides are counted by the structure/tissue agreement and left
   * out here — with them in, the ratio followed the composition of the frame (a bright pericardium in the near field
   * of the tamponade PLAX took it from 0.65 % to 1.0 % at decision 111 and past 1 % once the beam had its focusing
   * profile, decision 144) rather than any drift of the chain.
   */
  ampRelDiff: number;
  /** The same ratio over every sample, boundary flips included (information). */
  ampRelDiffAll: number;
  /** mean |Δtransmission| */
  transDiff: number;
  cpuMs: number;
  gpuMs: number;
  /** Most frequent structure disagreements as "cpu>gpu": count (diagnostic). */
  mismatches?: Record<string, number>;
  /**
   * Per CPU structure (by GLSL name, e.g. S_MV_ANT): how many samples it has and how many the GPU labels
   * differently. The frame-wide agreement hides a whole leaflet or annulus (< 0.5 % of the samples), so the
   * equivalence test bounds the disagreement of each structure separately.
   */
  perStructure?: Record<string, { samples: number; mismatched: number }>;
  /** A few mismatched samples with their heart-frame coordinates (diagnostic). */
  examples?: {
    line: number;
    sample: number;
    cpu: number;
    gpu: number;
    hx: number;
    hy: number;
    hz: number;
  }[];
}

type Tier = 'low' | 'medium' | 'high';

/** Canonical view of a case at a phase, with the scene the renderers take. */
function canonicalSetup(
  viewId: string,
  phase: number,
  caseId: string,
  tier: Tier,
  settings: AcquisitionSettings,
  probeOffsetV = 0,
) {
  const c = loadCaseById(caseId);
  const { thorax, heart, tables } = buildCaseModels(c, {
    position: 'left-lateral',
    respiration: 'expiration',
    headElevationDeg: 0,
  });
  const canonical = canonicalControl(getViewTarget(viewId), heart, thorax);
  // an offset along the ribs' spacing puts a rib under the probe, which the presets avoid
  const ctrl = { ...canonical, v: canonical.v + probeOffsetV };
  const beam = beamFrameFromPose(poseFromControl(thorax, ctrl), 1);
  const spec = polarSpecFor(settings, tier);
  const sceneAt = (ph: number): Scene => ({
    heart,
    heartPose: computeHeartPose(heart, cycleStateAt(tables, ph)),
    thorax,
    physics: {
      frequencyMHz: settings.frequencyMHz,
      harmonics: settings.harmonics,
      clutterLevel: c.acousticWindow.clutterLevel,
      windowAttenuation: c.acousticWindow.chestWallAttenuation,
      seed: c.seed,
    },
  });
  return { c, heart, beam, spec, scene: sceneAt(phase), sceneAt };
}

/**
 * Debug/QA hook (window.__echotwin.compareBackends): renders the same canonical view with the CPU
 * reference renderer and the WebGL2 port on the main thread and reports agreement metrics. Used by
 * e2e/gpu-equivalence.spec.ts.
 */
export function compareBackends(
  viewId: string,
  phase: number,
  caseId = 'normal-excellent-window',
  tier: Tier = 'medium',
  probeOffsetV = 0,
): BackendComparison {
  const { heart, beam, spec, scene } = canonicalSetup(
    viewId,
    phase,
    caseId,
    tier,
    DEFAULT_ACQUISITION,
    probeOffsetV,
  );
  const empty: BackendComparison = {
    lines: spec.lines,
    samples: spec.samples,
    structureAgreement: 0,
    tissueAgreement: 0,
    ampRelDiff: 1,
    ampRelDiffAll: 1,
    transDiff: 1,
    cpuMs: 0,
    gpuMs: 0,
  };
  const cpu = new ProceduralSliceRenderer();
  const fa = allocPolarFrame(spec);
  const t0 = performance.now();
  cpu.render(scene, beam, spec, phase, fa);
  const cpuMs = performance.now() - t0;
  const g = createWebgl2Renderer(undefined, { allowSoftware: true }); // the check runs on SwiftShader in Playwright
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
    ampDiffSame = 0,
    ampSumSame = 0,
    trDiff = 0;
  const mm = new Map<string, number>();
  const per = new Map<number, { samples: number; mismatched: number }>();
  const examples: NonNullable<BackendComparison['examples']> = [];
  for (let i = 0; i < n; i++) {
    const sa = fa.structure[i]!;
    let ps = per.get(sa);
    if (!ps) per.set(sa, (ps = { samples: 0, mismatched: 0 }));
    ps.samples++;
    if (sa === fb.structure[i]) sAgree++;
    else {
      ps.mismatched++;
      const k = `${fa.structure[i]}>${fb.structure[i]}`;
      mm.set(k, (mm.get(k) ?? 0) + 1);
      if (examples.length < 40 && i % 3 === 0) {
        const li = Math.floor(i / spec.samples),
          si = i % spec.samples;
        const theta = -spec.sectorRad / 2 + (spec.sectorRad * (li + 0.5)) / spec.lines;
        const r = (si + 0.5) * (spec.depthCm / spec.samples);
        const ct = Math.cos(theta),
          sn = Math.sin(theta);
        const px = beam.origin.x + (beam.forward.x * ct + beam.lateral.x * sn) * r;
        const py = beam.origin.y + (beam.forward.y * ct + beam.lateral.y * sn) * r;
        const pz = beam.origin.z + (beam.forward.z * ct + beam.lateral.z * sn) * r;
        const hf = heart.frame;
        const dx = px - hf.origin.x,
          dy = py - hf.origin.y,
          dz = pz - hf.origin.z;
        examples.push({
          line: li,
          sample: si,
          cpu: fa.structure[i]!,
          gpu: fb.structure[i]!,
          hx: +(dx * hf.ex.x + dy * hf.ex.y + dz * hf.ex.z).toFixed(2),
          hy: +(dx * hf.ey.x + dy * hf.ey.y + dz * hf.ey.z).toFixed(2),
          hz: +(dx * hf.ez.x + dy * hf.ez.y + dz * hf.ez.z).toFixed(2),
        });
      }
    }
    const sameTissue = fa.tissue[i] === fb.tissue[i];
    if (sameTissue) tAgree++;
    const d = Math.abs(fa.amplitude[i]! - fb.amplitude[i]!);
    ampDiff += d;
    ampSum += fa.amplitude[i]!;
    if (sameTissue && sa === fb.structure[i]) {
      ampDiffSame += d;
      ampSumSame += fa.amplitude[i]!;
    }
    trDiff += Math.abs(fa.transmission[i]! - fb.transmission[i]!);
  }
  const mismatches = Object.fromEntries([...mm.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8));
  const names = structureNames();
  const perStructure = Object.fromEntries(
    [...per.entries()].map(([id, v]) => [names.get(id) ?? `S_${id}`, v]),
  );
  return {
    lines: spec.lines,
    samples: spec.samples,
    structureAgreement: sAgree / n,
    tissueAgreement: tAgree / n,
    ampRelDiff: ampDiffSame / Math.max(ampSumSame, 1e-6),
    ampRelDiffAll: ampDiff / Math.max(ampSum, 1e-6),
    transDiff: trDiff / n,
    cpuMs,
    gpuMs,
    mismatches,
    examples,
    perStructure,
  };
}

/** Structure id → GLSL name, from the same define list the shaders use (`S_LV_CAV 1` …). */
function structureNames(): Map<number, string> {
  const out = new Map<number, string>();
  for (const m of enumDefinesGlsl().matchAll(/#define (S_[A-Z0-9_]+) (\d+)/g))
    out.set(Number(m[2]), m[1]!);
  return out;
}

export interface ImageChainComparison {
  error?: string;
  lines: number;
  samples: number;
  /** Console path of each frame of the mixed chain compared with the all-CPU reference chain. */
  framePaths: string[];
  /** Mixed chain vs the CPU console on every frame, per frame (persistence carries across the switches). */
  displayMeanAbsDiff: number[];
  displayMaxDiff: number[];
  displayFracOver1: number[];
  /** Structure and tissue ids of the packed read-back vs the float read-back. */
  idsAgreement: number;
  /** Largest relative error of the 8-bit transmission code where the transmission is ≥ 1e-4. */
  transMaxRelErr: number;
  /** GPU present pass vs CPU scan conversion + colour overlay of the same display (RGB channels, every pixel). */
  presentMaxDiff: number;
  /** Pixels differing by more than one level, as a fraction of the pixels inside the sector. */
  presentFracOver1: number;
  presentColorPixels: number;
  /** Pixels coloured on one side and grey on the other (a colour box edge placed differently). */
  presentColourFlips: number;
  gpuDisplayMs: number;
  cpuConsoleMs: number;
}

/**
 * Debug/QA hook (window.__echotwin.compareImageChain, decision 54): the GPU console and present pass must
 * reproduce the CPU console, scan conversion and colour overlay. Four frames form a mixed chain (GPU, GPU, CPU,
 * GPU) compared with the CPU console on every frame, so persistence is checked within the GPU and across both
 * switches. The present pass is compared on a mirrored sector with a synthetic colour field that has sign jumps
 * like aliasing, saturated values, variance and holes.
 */
export function compareImageChain(
  viewId: string,
  phase: number,
  caseId = 'normal-excellent-window',
  tier: Tier = 'medium',
  overrides: Partial<AcquisitionSettings> = {},
): ImageChainComparison {
  const settings: AcquisitionSettings = { ...DEFAULT_ACQUISITION, ...overrides };
  const { c, beam, spec, sceneAt } = canonicalSetup(viewId, phase, caseId, tier, settings);
  const n = spec.lines * spec.samples;
  const result: ImageChainComparison = {
    lines: spec.lines,
    samples: spec.samples,
    framePaths: [],
    displayMeanAbsDiff: [],
    displayMaxDiff: [],
    displayFracOver1: [],
    idsAgreement: 0,
    transMaxRelErr: 1,
    presentMaxDiff: 255,
    presentFracOver1: 1,
    presentColorPixels: 0,
    presentColourFlips: 0,
    gpuDisplayMs: 0,
    cpuConsoleMs: 0,
  };
  const g = createWebgl2Renderer(undefined, { allowSoftware: true });
  if (!g.renderer) return { ...result, error: g.reason };
  const gpu = g.renderer;
  const refState = createConsoleState(c.seed);
  const mixState = createConsoleState(c.seed);
  const fFloat = allocPolarFrame(spec);
  const fGpu = allocPolarFrame(spec);
  const dispRef = new Uint8ClampedArray(n);
  const dispMix = new Uint8ClampedArray(n);
  const dispGpu = new Uint8ClampedArray(n); // last display formed on the GPU (input of the present comparison)
  for (const [k, path] of (['gpu', 'gpu', 'cpu', 'gpu'] as const).entries()) {
    const ph = (phase + 0.05 * k) % 1;
    const scene = sceneAt(ph);
    gpu.render(scene, beam, spec, ph, fFloat); // the float envelope both CPU consoles read
    const tc = performance.now();
    applyConsole(fFloat, settings, refState, dispRef);
    result.cpuConsoleMs = performance.now() - tc;
    if (path === 'gpu') {
      const tg = performance.now();
      gpu.renderDisplay(
        scene,
        beam,
        spec,
        ph,
        fGpu,
        undefined,
        { settings, state: mixState },
        dispMix,
      );
      result.gpuDisplayMs = performance.now() - tg;
      dispGpu.set(dispMix);
    } else {
      if (mixState.gpuHistory) gpu.restoreCpuHistory(mixState, spec);
      applyConsole(fFloat, settings, mixState, dispMix);
    }
    result.framePaths.push(path);
    let sum = 0,
      max = 0,
      over = 0;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(dispRef[i]! - dispMix[i]!);
      sum += d;
      if (d > max) max = d;
      if (d > 1) over++;
    }
    result.displayMeanAbsDiff.push(sum / n);
    result.displayMaxDiff.push(max);
    result.displayFracOver1.push(over / n);
  }
  let ids = 0,
    trErr = 0;
  for (let i = 0; i < n; i++) {
    if (fFloat.structure[i] === fGpu.structure[i] && fFloat.tissue[i] === fGpu.tissue[i]) ids++;
    const t = fFloat.transmission[i]!;
    if (t >= 1e-4) trErr = Math.max(trErr, Math.abs(fGpu.transmission[i]! - t) / t);
  }
  result.idsAgreement = ids / n;
  result.transMaxRelErr = trErr;
  // present: mirrored sector, synthetic colour field with aliasing and variance
  const W = 640,
    H = 520;
  const mapping = computeSectorMapping(spec, W, H, true, 1);
  const lut = buildScanLut(spec, mapping);
  const vel = new Float32Array(n).fill(NaN);
  const variance = new Float32Array(n);
  for (let li = Math.floor(spec.lines * 0.2); li < Math.floor(spec.lines * 0.8); li++)
    for (let si = Math.floor(spec.samples * 0.25); si < Math.floor(spec.samples * 0.7); si++) {
      if ((li + si) % 7 === 0) continue; // holes: samples without colour
      const i = li * spec.samples + si;
      vel[i] = ((((li * 7 + si * 3) % 41) - 20) / 20) * 0.8; // ±0.8 m/s against a 0.62 m/s scale
      variance[i] = (si % 11) / 10;
    }
  const colorSettings: ColorSettings = {
    ...DEFAULT_COLOR,
    boxRMinCm: 4,
    boxRMaxCm: 12.5,
    boxThetaMinRad: -0.35,
    boxThetaMaxRad: 0.28,
    showVariance: true,
  };
  const cpuRgba = new Uint8ClampedArray(W * H * 4);
  scanConvertLut(dispGpu, lut, cpuRgba);
  overlayColorField(cpuRgba, lut, vel, variance, colorSettings);
  const gpuRgba = new Uint8Array(W * H * 4);
  gpu.present({
    lut,
    width: W,
    height: H,
    color: { vel, variance, version: 1, settings: colorSettings },
    readback: gpuRgba,
  });
  gpu.dispose();
  let pMax = 0,
    pOver = 0,
    colored = 0,
    flips = 0,
    inside = 0;
  for (let p = 0; p < W * H; p++) {
    const o = p * 4;
    if ((lut.idx[p] ?? -1) >= 0) inside++;
    let d = 0;
    for (let ch = 0; ch < 3; ch++) d = Math.max(d, Math.abs(cpuRgba[o + ch]! - gpuRgba[o + ch]!));
    if (d > pMax) pMax = d;
    if (d > 1) pOver++;
    const cpuColoured = cpuRgba[o]! !== cpuRgba[o + 1]! || cpuRgba[o + 1]! !== cpuRgba[o + 2]!;
    const gpuColoured = gpuRgba[o]! !== gpuRgba[o + 1]! || gpuRgba[o + 1]! !== gpuRgba[o + 2]!;
    if (cpuColoured) colored++;
    if (cpuColoured !== gpuColoured) flips++;
  }
  result.presentMaxDiff = pMax;
  result.presentFracOver1 = pOver / Math.max(1, inside);
  result.presentColorPixels = colored;
  result.presentColourFlips = flips;
  return result;
}
