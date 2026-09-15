import type { CaseDefinition } from '@/cases/schema';
import { computeHeartPose, createHeartModel, heartLandmarks, type HeartModel, type HeartPose } from '@/simulator/anatomy/heartModel';
import { createThoraxModel, type ThoraxModel } from '@/simulator/anatomy/thoraxModel';
import { buildBeatTables, cycleStateAt, type BeatTables } from '@/simulator/cardiac-cycle/cycleModel';
import { inflowRespiratoryVariation, respiratoryDepth } from '@/simulator/cardiac-cycle/respiration';
import { ejectionTimeS, ELECTROMECHANICAL_DELAY_S } from '@/simulator/cardiac-cycle/timing';
import { CardiacClock } from '@/simulator/cardiac-cycle/clock';
import { ecgSample } from '@/simulator/cardiac-cycle/ecg';
import { ProceduralSliceRenderer } from '@/simulator/renderer/procedural/sliceRenderer';
import { createWebgl2Renderer, type Webgl2Renderer } from '@/simulator/renderer/gpu/webgl2Renderer';
import { AtlasRenderer } from '@/simulator/renderer/atlas/atlasRenderer';
import { allocPolarFrame, polarSpecFor, type AcquisitionSettings, type PolarFrame, type PolarFrameSpec, type RendererBackend, type RenderHints, type Scene, type ScenePhysics } from '@/simulator/renderer/types';
import { AtlasRenderer as AtlasBackend } from '@/simulator/renderer/atlas/atlasRenderer';
import { applyConsole, createConsoleState, persistenceOverTime, type ArtifactSettings, type ConsoleState } from '@/simulator/renderer/postprocess/consolePipeline';
import { buildScanLut, computeSectorMapping, lutKey, scanConvertLut, type ScanLut, type SectorMapping } from '@/simulator/renderer/scanConvert';
import { simulatedFrameRate } from '@/simulator/renderer/frameRate';
import { beamFrameFromPose, contactQuality, poseFromControl, type BeamFrame } from '@/simulator/probe/pose';
import { analyzeView, type ViewAnalysis } from '@/simulator/view-recognition/viewQuality';
import { buildFlowParams, sampleFlow, type FlowFieldParams, type FlowSample } from '@/simulator/doppler/flow-primitives/flowField';
import { allocColorField, computeColorField, overlayColorField, type ColorField } from '@/simulator/doppler/color/colorDoppler';
import { spectralRange } from '@/simulator/doppler/spectral/spectrum';
import { computeGroundTruth, type StructuredEchoTruth } from '@/simulator/hemodynamics/groundTruth';
import type { EcgPoint, PhaseMarks, SimInput, SimOutput, SimRequest, SimResponse, StripInfo } from './protocol';
import { MMODE_TRACE_SHARE } from './mmodeStrip';
import { StripEngine, type StripCtx } from './stripEngine';

/**
 * Headless simulator (spec 32 data flow). Runs in a Web Worker in the app and directly in tests.
 * Owns: case models, cardiac clock, renderer backend, console state, cine ring, Doppler strips,
 * ECG ring and view analysis. The UI only sends inputs and draws outputs + overlays.
 */
const ECG_HZ = 200;
const CINE_FRAMES = 96;

interface CineFrame {
  display: Uint8ClampedArray;
  structure: Uint8Array;
  spec: PolarFrameSpec;
  phase: number;
  timeS: number;
  beatIndex: number;
  colorVel: Float32Array | null;
  colorVar: Float32Array | null;
  beam: BeamFrame;
  analysis: ViewAnalysis | null;
}

export class SimulatorCore {
  readonly caseDef: CaseDefinition;
  readonly truth: StructuredEchoTruth;
  private thorax: ThoraxModel;
  private heart: HeartModel;
  private tables: BeatTables;
  /** Tables at the case's heart rate: the ground truth and, in atrial fibrillation, the orifice every beat fills through. */
  private nominalTables: BeatTables;
  /** Beat the tables belong to, and a counter of table changes (it keys the traced M-mode lines). */
  private tablesBeat = -1;
  private tablesVersion = 0;
  private clock: CardiacClock;
  private flow: FlowFieldParams;
  private procedural = new ProceduralSliceRenderer();
  private atlas: AtlasRenderer;
  private backend: RendererBackend;
  /** WebGL2 port of the procedural renderer; null when unavailable (reason in `gpuReason`). */
  private gpu: Webgl2Renderer | null;
  private gpuReason: string;
  private consoleState: ConsoleState;
  private artifacts: ArtifactSettings = { sideLobe: 0, mirror: 0, beamWidth: 0 };
  private clutterBoost = 0;
  private caseArtifacts = { sideLobe: 0, mirror: 0, beamWidth: 0, clutter: 0 };

  private applyArtifactOverrides(o: SimInput['artifactOverrides']): void {
    const a = o ?? this.caseArtifacts;
    this.artifacts = { sideLobe: a.sideLobe, mirror: a.mirror, beamWidth: a.beamWidth };
    this.clutterBoost = a.clutter;
  }
  private input: SimInput;
  private frame: PolarFrame | null = null;
  private display: Uint8ClampedArray | null = null;
  /** The two colour field buffers: each update writes the one that does not hold `colorPrev` (decision 56). */
  private colorBuffers: [ColorField, ColorField] | null = null;
  /**
   * Field of the latest colour update: the composite, the cine and the GPU present pass show it, and the next update
   * blends it (persistence). Null until the first update after a polar spec or modality change.
   */
  private colorPrev: ColorField | null = null;
  private colorFrameCounter = 0;
  private colorFps = 0;
  /** Incremented whenever the colour field is recomputed (the GPU present pass uploads it only then). */
  private colorVersion = 0;
  /** The display of the last rendered frame was formed on the GPU and is still there (decision 54). */
  private displayOnGpu = false;
  private cine: CineFrame[] = [];
  private frameId = 0;
  private timeS = 0;
  private frameAccumulator = 0;
  /** Simulated frame interval of the current step, and the simulation time of the last B-mode and colour frames (decision 94). */
  private frameIntervalS = 1 / 30;
  private lastFrameTimeS = NaN;
  private lastColorTimeS = NaN;
  private lastPersistence = 0;
  private lastAnalysis: ViewAnalysis | null = null;
  private analysisCounter = 0;
  private ecg: EcgPoint[] = [];
  private ecgAccum = 0;
  /** Spectral and M-mode strips: columns, displayed image, gate/auto-trace read-outs (decisions 84, 115). */
  private strips = new StripEngine();
  private patientKey = '';
  private rgbaPool: ArrayBuffer[] = [];
  /** Bumped when the patient models are rebuilt: traced lines and gate flow of the old models are stale. */
  private modelVersion = 0;
  private flowSample: FlowSample = { vx: 0, vy: 0, vz: 0, dispersion: 0, present: 0 };
  private lastOutputBeam: BeamFrame | null = null;
  private lastSector: (SectorMapping & { x: number; y: number }) | null = null;
  private lastStrip: StripInfo | null = null;
  private timing = { renderFrameMs: 0, compositeMs: 0, analysisMs: 0, consoleMs: 0, cineMs: 0, presentMs: 0 };
  private lut: ScanLut | null = null;
  private prevBeam: BeamFrame | null = null;
  private stationaryFrames = 0;
  /** Render budget of the current frame (ms): 0.6 of the simulated frame interval. */
  private frameBudgetMs = 25;

  constructor(caseDef: CaseDefinition, input: SimInput) {
    this.caseDef = caseDef;
    this.input = input;
    this.thorax = createThoraxModel(caseDef.bodyHabitus, caseDef.acousticWindow, input.patient, caseDef.anatomy.ivc.collapsePct);
    this.patientKey = JSON.stringify(input.patient);
    this.heart = createHeartModel(caseDef.anatomy, caseDef.physiology, this.thorax.heartOffset, caseDef.seed, this.thorax.ivcCollapse);
    this.tables = buildBeatTables(60 / caseDef.rhythm.heartRateBpm, caseDef.physiology, caseDef.rhythm, caseDef.hemodynamics);
    this.nominalTables = this.tables;
    this.clock = new CardiacClock(caseDef.rhythm, caseDef.seed);
    this.truth = computeGroundTruth(caseDef, this.tables);
    this.syncBeatTables(false);
    this.consoleState = createConsoleState(caseDef.seed);
    // case-configurable artifacts (spec 12): geometric ones (rib/lung/calcium shadow) come from the anatomy;
    // these three are applied in the console pipeline and the near-field clutter boosts the physics term
    const art = (type: string) => caseDef.artifacts.filter((x) => x.enabled && x.type === type).reduce((m, x) => Math.max(m, x.intensity), 0);
    this.caseArtifacts = { sideLobe: art('side-lobe'), mirror: art('mirror'), beamWidth: art('beam-width'), clutter: art('near-field-clutter') };
    this.applyArtifactOverrides(input.artifactOverrides);
    // the GPU port (same frames, ~10× faster) feeds the atlas when available; the CPU renderer stays the
    // reference and the fallback (Node tests, browsers without WebGL2 float targets)
    const g = createWebgl2Renderer();
    this.gpu = g.renderer;
    this.gpuReason = g.reason;
    this.atlas = new AtlasRenderer(this.gpu ?? this.procedural, caseDef.seed);
    this.backend = this.pickBackend(input.rendererBackend);
    this.flow = this.buildFlow();
  }

  private pickBackend(kind: SimInput['rendererBackend']): RendererBackend {
    if (kind === 'procedural') return this.procedural;
    if (kind === 'webgl2') return this.gpu ?? this.procedural;
    return this.atlas;
  }

  /**
   * Atrial fibrillation (decision 107): every beat gets tables of its own RR instead of the case tables stretched to it. It
   * ejects what the diastole before it filled — through the case's orifice with the case's E wave, cut by its QRS — with
   * the ejection time of the RR before it, and starts where that beat left the volume and the annuli. Stretched, the
   * deceleration time went from 123 to 276 ms with the RR and the LVOT VTI followed the current RR instead of the one before.
   */
  private syncBeatTables(rebuildFlow = true): void {
    const c = this.clock.current;
    const breathing = this.input.patient.respiration === 'free-breathing';
    if ((this.caseDef.rhythm.type !== 'atrial-fibrillation' && !breathing) || c.beatIndex === this.tablesBeat) return;
    const prev = this.tables;
    const first = prev === this.nominalTables;
    const phys = this.caseDef.physiology;
    const svNominal = phys.edvMl - phys.esvMl;
    const clampSv = (ml: number): number => Math.min(1.2 * svNominal, Math.max(0.2 * svNominal, ml));
    const ejectMl = first ? svNominal : clampSv(prev.endVolumeMl - phys.esvMl);
    // Free breathing (decision 108): the early inflow waves of the beat follow the depth of inspiration when its mitral
    // valve opens; each ventricle ejects what its inflow filled in the beat before, so the stroke volumes follow too.
    let mitralEFactor = 1,
      tricuspidEFactor = 1;
    let ivcCollapse: [number, number] | undefined;
    if (breathing) {
      // the inferior vena cava narrows with inspiration by the case's inspiratory collapse (decision 113), linearly across
      // the beat from where the breath has it when the beat starts to where it has it when it ends
      const start = this.timeS - c.timeInBeatS;
      const k = this.caseDef.anatomy.ivc.collapsePct / 100;
      ivcCollapse = [k * respiratoryDepth(start), k * respiratoryDepth(start + c.rrS)];
      const opening = this.timeS - c.timeInBeatS + ELECTROMECHANICAL_DELAY_S + ejectionTimeS(60 / c.previousRrS, phys.contractility) + phys.ivrtMs / 1000;
      const depth = respiratoryDepth(opening);
      const variation = inflowRespiratoryVariation(this.caseDef.anatomy.pericardium.tamponade);
      mitralEFactor = 1 - variation.mitral * depth;
      tricuspidEFactor = 1 + variation.tricuspid * depth;
    }
    this.tables = buildBeatTables(c.rrS, phys, this.caseDef.rhythm, this.caseDef.hemodynamics, {
      chain: {
        ejectMl,
        rvEjectMl: breathing ? (first ? svNominal : clampSv(prev.tricuspidFillMl)) : undefined,
        mvAreaCm2: this.nominalTables.mvEffectiveAreaCm2,
        previousRrS: c.previousRrS,
        startLongitudinal: first ? 0 : prev.endLongitudinal,
        startRvLongitudinal: first ? 0 : prev.endRvLongitudinal,
        mitralEFactor,
        tricuspidEFactor,
        ivcCollapse,
      },
    });
    this.tablesBeat = c.beatIndex;
    this.tablesVersion++;
    if (rebuildFlow) this.flow = buildFlowParams(this.caseDef, this.heart, this.tables);
  }

  private buildFlow(): FlowFieldParams {
    heartLandmarks(this.heart);
    computeHeartPose(this.heart, cycleStateAt(this.tables, 0)); // initialises anchors
    return buildFlowParams(this.caseDef, this.heart, this.tables);
  }

  /** Services the strip engine reads per call; its mutable state stays on the engine. */
  private stripCtx(): StripCtx {
    const c = this.clock.current;
    return {
      input: this.input,
      caseDef: this.caseDef,
      heart: this.heart,
      tables: this.tables,
      flow: this.flow,
      timeS: this.timeS,
      modelVersion: this.modelVersion,
      tablesVersion: this.tablesVersion,
      phaseNow: c.phase,
      rrS: c.rrS,
      frame: this.frame,
      procedural: this.procedural,
      scene: (ph) => this.scene(ph),
      physics: () => this.physics(),
    };
  }

  setInput(input: SimInput): void {
    const key = JSON.stringify(input.patient);
    if (key !== this.patientKey) {
      this.thorax = createThoraxModel(this.caseDef.bodyHabitus, this.caseDef.acousticWindow, input.patient, this.caseDef.anatomy.ivc.collapsePct);
      this.heart = createHeartModel(this.caseDef.anatomy, this.caseDef.physiology, this.thorax.heartOffset, this.caseDef.seed, this.thorax.ivcCollapse);
      // chained beats start again from the case tables with the new breathing (decision 108)
      if (input.patient.respiration !== this.input.patient.respiration && this.caseDef.rhythm.type !== 'atrial-fibrillation') {
        this.tables = this.nominalTables;
        this.tablesBeat = -1;
        this.tablesVersion++;
      }
      this.flow = this.buildFlow();
      this.atlas.invalidate();
      this.patientKey = key;
      this.modelVersion++;
    }
    if (input.rendererBackend !== this.input.rendererBackend) {
      this.backend = this.pickBackend(input.rendererBackend);
    }
    if (JSON.stringify(input.artifactOverrides) !== JSON.stringify(this.input.artifactOverrides)) this.applyArtifactOverrides(input.artifactOverrides);
    if (input.modality !== this.input.modality) {
      this.strips.reset();
      this.colorPrev = null;
    }
    this.input = input;
  }

  recycle(buffer: ArrayBuffer): void {
    // frames drawn on the GPU travel with an empty buffer: nothing to reuse
    if (buffer.byteLength > 0 && this.rgbaPool.length < 3) this.rgbaPool.push(buffer);
  }

  /** Advance simulation by dt seconds. Returns an output when a new composite frame is ready. */
  step(dtS: number): SimOutput | null {
    const inp = this.input;
    const dt = Math.min(0.1, Math.max(0, dtS));
    if (inp.frozen) return this.frozenOutput();
    const spec = polarSpecFor(inp.settings, inp.quality);
    const isStrip = inp.modality === 'm-mode' || inp.modality === 'cmm' || inp.modality === 'pw' || inp.modality === 'cw' || inp.modality === 'tdi';
    const colorLines = inp.modality === 'color' ? Math.round(((inp.color.boxThetaMaxRad - inp.color.boxThetaMinRad) / spec.sectorRad) * spec.lines) : 0;
    const fps = simulatedFrameRate(spec, { colorLines, packetSize: 8 });
    this.colorFps = inp.modality === 'color' ? fps : 0;
    const beam = beamFrameFromPose(poseFromControl(this.thorax, inp.probe), contactQuality(inp.probe.pressure));
    const pre = this.clock.current;
    this.clock.advance(dt);
    this.syncBeatTables();
    this.timeS += dt;
    this.accumulateEcg(pre.timeInBeatS, pre.rrS, dt);
    // the trace budget of the M-mode lines follows the frame interval, not the step: a late step must not buy a longer one
    if (isStrip) this.strips.advance(dt, beam, spec, (MMODE_TRACE_SHARE * 1000) / fps, this.stripCtx());
    this.frameAccumulator += dt;
    const frameInterval = 1 / fps;
    this.frameIntervalS = frameInterval;
    this.frameBudgetMs = 600 * frameInterval;
    let produced = false;
    // the worker paces itself at the simulated frame interval; tolerate timer jitter so the cadence
    // stays even instead of skipping every few frames
    if (this.frameAccumulator >= frameInterval * 0.85 || !this.frame) {
      // keep the remainder (at most one interval): a late tick followed by an early one still yields two frames,
      // so the long-run rate is the simulated rate
      this.frameAccumulator = Math.min(frameInterval, Math.max(0, this.frameAccumulator - frameInterval));
      const t0 = performance.now();
      this.renderFrame(beam, spec);
      this.timing.renderFrameMs = performance.now() - t0;
      produced = true;
    }
    if (!produced && !isStrip) return null;
    const t1 = performance.now();
    const out = this.composite(beam, spec, false);
    this.timing.compositeMs = performance.now() - t1;
    return out;
  }

  /** Continue without the GPU port (context lost): the atlas feeds from the CPU tracer again. */
  private dropGpu(reason: string): void {
    this.gpu = null;
    this.gpuReason = reason;
    this.atlas = new AtlasRenderer(this.procedural, this.caseDef.seed);
    this.backend = this.pickBackend(this.input.rendererBackend);
    this.displayOnGpu = false;
  }

  private accumulateEcg(timeInBeatStart: number, rrS: number, dt: number): void {
    this.ecgAccum += dt;
    const step = 1 / ECG_HZ;
    let t = timeInBeatStart;
    while (this.ecgAccum >= step) {
      this.ecgAccum -= step;
      t += step;
      const tb = t % rrS;
      const v = ecgSample(tb, rrS, this.caseDef.rhythm, this.clock.current.beatIndex, this.caseDef.seed);
      this.ecg.push({ t: this.timeS - this.ecgAccum, v });
    }
    const cutoff = this.timeS - 6;
    while (this.ecg.length && (this.ecg[0]?.t ?? 0) < cutoff) this.ecg.shift();
  }

  private physics(): ScenePhysics {
    const s = this.input.settings;
    return {
      frequencyMHz: s.frequencyMHz,
      harmonics: s.harmonics,
      clutterLevel: Math.min(1, this.caseDef.acousticWindow.clutterLevel + 0.6 * this.clutterBoost) + this.caseDef.acousticWindow.emphysemaScatter * 0.5,
      windowAttenuation: this.caseDef.acousticWindow.chestWallAttenuation,
      seed: this.caseDef.seed,
      beamWidth: this.artifacts.beamWidth,
    };
  }

  private scene(phase: number): Scene {
    const state = cycleStateAt(this.tables, phase);
    return { heart: this.heart, heartPose: computeHeartPose(this.heart, state), thorax: this.thorax, physics: this.physics() };
  }

  private renderFrame(beam: BeamFrame, spec: PolarFrameSpec): void {
    const inp = this.input;
    if (!this.frame || this.frame.spec.lines !== spec.lines || this.frame.spec.samples !== spec.samples || this.frame.spec.depthCm !== spec.depthCm || this.frame.spec.sectorRad !== spec.sectorRad) {
      this.frame = allocPolarFrame(spec);
      this.display = new Uint8ClampedArray(spec.lines * spec.samples);
      this.consoleState = createConsoleState(this.caseDef.seed);
      this.colorBuffers = [allocColorField(spec.lines * spec.samples), allocColorField(spec.lines * spec.samples)];
      this.colorPrev = null;
      this.lastFrameTimeS = this.lastColorTimeS = NaN;
    }
    // persistence decays with simulated time, not per frame the renderer managed to produce (decision 94)
    const elapsed = Number.isFinite(this.lastFrameTimeS) ? this.timeS - this.lastFrameTimeS : this.frameIntervalS;
    this.lastFrameTimeS = this.timeS;
    this.lastPersistence = persistenceOverTime(inp.settings.persistence, elapsed, this.frameIntervalS);
    const settings = { ...inp.settings, persistence: this.lastPersistence };
    const phase = this.clock.current.phase;
    const scene = this.scene(phase);
    // stationary detection: a render cache (atlas) may keep frames only while the probe rests
    const moved = this.prevBeam ? AtlasBackend.poseDistance(this.prevBeam, beam) : Infinity;
    this.stationaryFrames = moved < 0.03 ? this.stationaryFrames + 1 : 0;
    this.prevBeam = beam;
    const hints: RenderHints = { stationary: this.stationaryFrames >= 6, budgetMs: this.frameBudgetMs, sceneAtPhase: (ph) => this.scene(ph) };
    if (this.gpu?.contextLost) this.dropGpu('WebGL context lost: CPU tracer');
    let onGpu = this.formDisplay(scene, beam, spec, phase, hints, settings);
    if (this.gpu?.contextLost) {
      // lost while forming this frame: nothing valid was read back, so form it again with the CPU tracer
      this.dropGpu('WebGL context lost: CPU tracer');
      onGpu = this.formDisplay(scene, beam, spec, phase, hints, settings);
    }
    this.displayOnGpu = onGpu;
    let colorVel: Float32Array | null = null;
    let colorVar: Float32Array | null = null;
    if (inp.modality === 'color') {
      this.colorFrameCounter++;
      // colour packets cost frames: update the colour field every other B-mode frame
      if (this.colorFrameCounter % 2 === 0 || !this.colorPrev) this.computeColor(scene, beam, spec, phase);
      if (this.colorPrev) {
        colorVel = this.colorPrev.vel;
        colorVar = this.colorPrev.variance;
      }
    }
    this.analysisCounter++;
    if (this.analysisCounter % 5 === 1) {
      const ta = performance.now();
      this.lastAnalysis = analyzeView({ heart: this.heart, thorax: this.thorax, control: inp.probe, beam, frame: this.frame, display: this.display, settings: inp.settings });
      this.timing.analysisMs = performance.now() - ta;
    }
    const tCine = performance.now();
    const cf: CineFrame = {
      structure: new Uint8Array(this.frame!.structure),
      display: new Uint8ClampedArray(this.display!),
      spec,
      phase,
      timeS: this.timeS,
      beatIndex: this.clock.current.beatIndex,
      colorVel: colorVel ? new Float32Array(colorVel) : null,
      colorVar: colorVar ? new Float32Array(colorVar) : null,
      beam,
      analysis: this.lastAnalysis,
    };
    this.cine.push(cf);
    if (this.cine.length > CINE_FRAMES) this.cine.shift();
    this.timing.cineMs = performance.now() - tCine;
    this.frameId++;
  }

  /**
   * Render the frame and form its display. On the GPU when the backend can (decision 54): every console step
   * except the mirror and side-lobe artifacts, and the atlas declines while it serves a cache. Otherwise render
   * and the CPU console. Persistence continues across a switch in either direction. True when formed on the GPU.
   */
  private formDisplay(scene: Scene, beam: BeamFrame, spec: PolarFrameSpec, phase: number, hints: RenderHints, settings: AcquisitionSettings): boolean {
    const frame = this.frame!;
    const display = this.display!;
    if (this.artifacts.mirror <= 0 && this.artifacts.sideLobe <= 0 && this.backend.renderDisplay?.(scene, beam, spec, phase, frame, hints, { settings, state: this.consoleState }, display) === true) {
      this.timing.consoleMs = 0;
      return true;
    }
    this.backend.render(scene, beam, spec, phase, frame, hints);
    const tc = performance.now();
    // the previous output of this console state was formed on the GPU: carry its persistence over
    if (this.consoleState.gpuHistory) this.gpu?.restoreCpuHistory(this.consoleState, spec);
    applyConsole(frame, settings, this.consoleState, display, this.artifacts);
    this.timing.consoleMs = performance.now() - tc;
    return false;
  }

  private computeColor(scene: Scene, beam: BeamFrame, spec: PolarFrameSpec, phase: number): void {
    const frame = this.frame!;
    const hf = this.heart.frame;
    const fs = this.flowSample;
    const { samples, sectorRad, lines, depthCm } = spec;
    const dr = depthCm / samples;
    const flow = this.flow;
    const tables = this.tables;
    const hp = scene.heartPose;
    // write into the buffer that does not hold the previous field, which persistence blends
    const [a, b] = this.colorBuffers!;
    const out = this.colorPrev === a ? b : a;
    // the colour field updates every other B-mode frame: its persistence decays over that nominal interval (decision 94)
    const colorElapsed = Number.isFinite(this.lastColorTimeS) ? this.timeS - this.lastColorTimeS : 2 * this.frameIntervalS;
    this.lastColorTimeS = this.timeS;
    computeColorField(
      frame,
      { ...this.input.color, persistence: persistenceOverTime(this.input.color.persistence, colorElapsed, 2 * this.frameIntervalS) },
      this.colorPrev,
      (_idx, li, si, o) => {
        const theta = -sectorRad / 2 + (sectorRad * (li + 0.5)) / lines;
        const ct = Math.cos(theta),
          sn = Math.sin(theta);
        const dx = beam.forward.x * ct + beam.lateral.x * sn;
        const dy = beam.forward.y * ct + beam.lateral.y * sn;
        const dz = beam.forward.z * ct + beam.lateral.z * sn;
        const r = (si + 0.5) * dr;
        const px = beam.origin.x + dx * r,
          py = beam.origin.y + dy * r,
          pz = beam.origin.z + dz * r;
        const hx = (px - hf.origin.x) * hf.ex.x + (py - hf.origin.y) * hf.ex.y + (pz - hf.origin.z) * hf.ex.z;
        const hy = (px - hf.origin.x) * hf.ey.x + (py - hf.origin.y) * hf.ey.y + (pz - hf.origin.z) * hf.ey.z;
        const hz = (px - hf.origin.x) * hf.ez.x + (py - hf.origin.y) * hf.ez.y + (pz - hf.origin.z) * hf.ez.z;
        sampleFlow(flow, tables, hp, phase, hx, hy, hz, fs);
        const dhx = dx * hf.ex.x + dy * hf.ex.y + dz * hf.ex.z;
        const dhy = dx * hf.ey.x + dy * hf.ey.y + dz * hf.ey.z;
        const dhz = dx * hf.ez.x + dy * hf.ez.y + dz * hf.ez.z;
        o.v = -(fs.vx * dhx + fs.vy * dhy + fs.vz * dhz); // + = toward the transducer
        o.disp = fs.dispersion;
        o.present = fs.present;
      },
      out,
      { frequencyMHz: this.input.settings.frequencyMHz, harmonics: this.input.settings.harmonics },
      // every update is a new estimate from new echoes (decision 116)
      { realization: this.colorVersion, seed: this.caseDef.seed },
    );
    this.colorPrev = out;
    this.colorVersion++;
  }

  /** Cardiac phase landmarks as fractions of RR (for phase checks in the technique engine). */
  phaseMarks(): PhaseMarks {
    const t = this.tables.timings;
    const rr = this.tables.rrS;
    return {
      ejectionStart: t.ejectionStartS / rr,
      ejectionEnd: t.ejectionEndS / rr,
      mitralOpen: t.mitralOpenS / rr,
      eEnd: (t.mitralOpenS + t.eAccelS + t.eDecelS) / rr,
      aStart: t.hasAWave ? t.aStartS / rr : 1,
      aEnd: t.hasAWave ? t.aEndS / rr : 1,
      hasAWave: t.hasAWave,
    };
  }

  /** LV length at end-diastole (cm), the reference for Simpson foreshortening checks. */
  lvLengthCm(): number {
    return this.heart.lv.lengthCm;
  }

  /** Answer an on-demand request (auto-trace of the spectral envelope between two strip columns). */
  request(req: SimRequest): SimResponse | null {
    return this.strips.request(req, this.stripCtx());
  }

  private frozenOutput(): SimOutput | null {
    const inp = this.input;
    if (!this.cine.length) return null;
    const idx = Math.max(0, Math.min(this.cine.length - 1, this.cine.length - 1 + inp.cineOffset));
    const cf = this.cine[idx]!;
    return this.composite(cf.beam, cf.spec, true, cf);
  }

  private takeBuffer(size: number): ArrayBuffer {
    for (let i = 0; i < this.rgbaPool.length; i++) {
      const b = this.rgbaPool[i]!;
      if (b.byteLength === size) {
        this.rgbaPool.splice(i, 1);
        return b;
      }
    }
    return new ArrayBuffer(size);
  }

  private composite(beam: BeamFrame, spec: PolarFrameSpec, frozen: boolean, cf?: CineFrame): SimOutput | null {
    const inp = this.input;
    const W = Math.max(64, inp.display.width);
    const H = Math.max(64, inp.display.height);
    const isStrip = inp.modality === 'm-mode' || inp.modality === 'cmm' || inp.modality === 'pw' || inp.modality === 'cw' || inp.modality === 'tdi';
    const sectorH = isStrip ? Math.round(H * 0.42) : H;
    const display = cf ? cf.display : this.display;
    const fspec = cf ? cf.spec : spec;
    if (!display) return null;
    const mapping = computeSectorMapping(fspec, W, sectorH, inp.settings.invertLR, inp.settings.zoom);
    const key = lutKey(fspec, mapping);
    if (!this.lut || this.lut.key !== key) this.lut = buildScanLut(fspec, mapping);
    const colorVel = cf ? cf.colorVel : inp.modality === 'color' && this.colorPrev ? this.colorPrev.vel : null;
    const colorVar = cf ? cf.colorVar : inp.modality === 'color' && this.colorPrev ? this.colorPrev.variance : null;
    // a live 2D or colour frame whose display was formed on the GPU is scan-converted there as well and travels
    // as an ImageBitmap (decision 54); strips, cine review and the CPU console keep the CPU composite
    let bitmap: ImageBitmap | null = null;
    const tp = performance.now();
    if (!cf && !isStrip && this.displayOnGpu && this.gpu) {
      const color = colorVel && colorVar ? { vel: colorVel, variance: colorVar, version: this.colorVersion, settings: inp.color } : null;
      bitmap = this.gpu.present({ lut: this.lut, width: W, height: sectorH, color });
    }
    this.timing.presentMs = bitmap ? performance.now() - tp : 0;
    const buffer = bitmap ? new ArrayBuffer(0) : this.takeBuffer(W * H * 4);
    const rgba = new Uint8ClampedArray(buffer);
    if (!bitmap) {
      // the sector occupies the top rows of the composite: scan-convert straight into the buffer
      const sectorRgba = new Uint8ClampedArray(buffer, 0, W * sectorH * 4);
      scanConvertLut(display, this.lut, sectorRgba);
      if (colorVel && colorVar) overlayColorField(sectorRgba, this.lut, colorVel, colorVar, inp.color);
    }
    if (isStrip) {
      // clear strip area
      rgba.fill(0, W * sectorH * 4);
      for (let i = W * sectorH * 4 + 3; i < rgba.length; i += 4) rgba[i] = 255;
    }
    let strip: StripInfo = { x: 0, y: sectorH, width: W, height: H - sectorH, secondsPerColumn: 0, topValue: 0, bottomValue: 0, kind: null };
    if (isStrip) strip = this.strips.drawStrip(rgba, W, H, sectorH, fspec, this.stripCtx());
    const view = cf ? cf.analysis : this.lastAnalysis;
    const c = this.clock.current;
    const structure = cf ? cf.structure : this.frame ? this.frame.structure : new Uint8Array(0);
    const gate = isStrip ? this.strips.gateInfo(beam, fspec, cf ? cf.phase : c.phase, structure, this.stripCtx()) : null;
    const ecgTail = this.ecg.slice(Math.max(0, this.ecg.length - 1200));
    this.lastOutputBeam = beam;
    const sector = { ...mapping, x: 0, y: 0 };
    this.lastSector = sector;
    this.lastStrip = strip;
    const colorLines = inp.modality === 'color' ? Math.round(((inp.color.boxThetaMaxRad - inp.color.boxThetaMinRad) / spec.sectorRad) * spec.lines) : 0;
    return {
      frameId: this.frameId,
      width: W,
      height: H,
      rgba: buffer,
      bitmap,
      sector,
      strip,
      polar: { lines: fspec.lines, samples: fspec.samples, sectorRad: fspec.sectorRad, depthCm: fspec.depthCm },
      structure: new Uint8Array(structure),
      gate,
      timeS: this.timeS,
      phase: cf ? cf.phase : c.phase,
      beatIndex: c.beatIndex,
      heartRateBpm: 60 / c.rrS,
      rrS: c.rrS,
      simulatedFps: simulatedFrameRate(spec, { colorLines, packetSize: 8 }),
      ecg: ecgTail,
      ecgHead: this.timeS,
      view,
      spectrumColumn: this.strips.spectrumColumn,
      spectralRange: spectralRange(inp.spectral),
      frozen,
      cineLength: this.cine.length,
      cineOffset: cf ? inp.cineOffset : 0,
      cineFramePhase: cf ? cf.phase : c.phase,
      stats: {
        ...this.backend.stats(),
        backend: this.backend.id,
        gpu: this.gpuReason,
        lines: spec.lines,
        samples: spec.samples,
        renderFrameMs: Number(this.timing.renderFrameMs.toFixed(1)),
        consoleMs: Number(this.timing.consoleMs.toFixed(1)),
        persistence: Number(this.lastPersistence.toFixed(3)),
        analysisMs: Number(this.timing.analysisMs.toFixed(1)),
        compositeMs: Number(this.timing.compositeMs.toFixed(1)),
        cineMs: Number(this.timing.cineMs.toFixed(2)),
        console: this.displayOnGpu ? 'gpu' : 'cpu',
        present: bitmap ? 'gpu' : 'cpu',
        presentMs: Number(this.timing.presentMs.toFixed(2)),
      },
      colorFps: this.colorFps,
      probeBeam: {
        origin: [beam.origin.x, beam.origin.y, beam.origin.z],
        forward: [beam.forward.x, beam.forward.y, beam.forward.z],
        lateral: [beam.lateral.x, beam.lateral.y, beam.lateral.z],
        normal: [beam.normal.x, beam.normal.y, beam.normal.z],
      },
    };
  }

  // ---- accessors for tests / devtools ----
  get models(): { heart: HeartModel; thorax: ThoraxModel; tables: BeatTables } {
    return { heart: this.heart, thorax: this.thorax, tables: this.tables };
  }
  /**
   * The M-mode strip as stored (decision 84): grey levels indexed [sample × columns + column] over `samples` line samples,
   * the cycle phase of each column, the phase bins between the two traced lines it was formed from (1 at full time
   * resolution) and the head (next column to write). Null outside M-mode.
   */
  get mmodeStrip(): { samples: number; cols: number; head: number; grey: Uint8ClampedArray; phase: Float32Array; span: Uint16Array; bins: number; traced: number } | null {
    return this.strips.mmodeStrip;
  }
  get lastView(): ViewAnalysis | null {
    return this.lastAnalysis;
  }
  get lastBeam(): BeamFrame | null {
    return this.lastOutputBeam;
  }
  get lastFrame(): PolarFrame | null {
    return this.frame;
  }
  /** Colour field of the latest update (null before the first) and its version, which keys the GPU present upload. */
  get lastColorField(): { field: ColorField | null; version: number } {
    return { field: this.colorPrev, version: this.colorVersion };
  }
  get currentPhase(): number {
    return this.clock.current.phase;
  }
  get lastSectorMapping(): (SectorMapping & { x: number; y: number }) | null {
    return this.lastSector;
  }
  get lastStripInfo(): StripInfo | null {
    return this.lastStrip;
  }
  /** The spectral strip (SPECTRAL_BINS values per column), the cycle phase each column was sampled at, and the head. */
  get spectralStrip(): { data: Float32Array | null; display: Float32Array | null; cols: number; head: number; phase: Float32Array } {
    return this.strips.spectralStrip;
  }
  heartPoseNow(): HeartPose {
    return computeHeartPose(this.heart, cycleStateAt(this.tables, this.clock.current.phase));
  }
}
