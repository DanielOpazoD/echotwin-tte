import type { CaseDefinition } from '@/cases/schema';
import { classifyHeart, computeHeartPose, createHeartModel, heartLandmarks, type HeartModel, type HeartPose } from '@/simulator/anatomy/heartModel';
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
import { applyConsole, createConsoleState, NO_ARTIFACTS, persistenceOverTime, type ArtifactSettings, type ConsoleState } from '@/simulator/renderer/postprocess/consolePipeline';
import { buildScanLut, computeSectorMapping, lutKey, scanConvertLut, type ScanLut, type SectorMapping } from '@/simulator/renderer/scanConvert';
import { simulatedFrameRate } from '@/simulator/renderer/frameRate';
import { beamFrameFromPose, contactQuality, poseFromControl, type BeamFrame } from '@/simulator/probe/pose';
import { analyzeView, type ViewAnalysis } from '@/simulator/view-recognition/viewQuality';
import { buildFlowParams, sampleFlow, sampleTissueVelocity, type FlowFieldParams, type FlowSample } from '@/simulator/doppler/flow-primitives/flowField';
import { allocColorField, colorMap, computeColorField, DOPPLER_SHADOW_TRANSMISSION, overlayColorField, relativeTransmission, type ColorField } from '@/simulator/doppler/color/colorDoppler';
import { aliasVelocity } from '@/clinical/formulas';
import { buildSpectralColumn, CLICK_SIGMA_S, envelopeThreshold, isClickColumn, SPECTRAL_BINS, spectralRange, type VelocitySample } from '@/simulator/doppler/spectral/spectrum';
import { valveClickWeight } from '@/simulator/doppler/spectral/valveClicks';
import { computeGroundTruth, type StructuredEchoTruth } from '@/simulator/hemodynamics/groundTruth';
import { makeSample, Tissue } from '@/simulator/anatomy/tissue';
import { createRng } from '@/core/random';
import type { EcgPoint, GateInfo, PhaseMarks, SimInput, SimOutput, SimRequest, SimResponse, StripInfo } from './protocol';
import { binsToTrace, buildRowMap, columnSource, MMODE_TRACE_SHARE, MmodeLineCache, mmodeLineSamples, mmodePhaseBins, mmodePulsesPerColumn, type ColumnSource, type MmodeLine, type RowMap } from './mmodeStrip';

/**
 * Headless simulator (spec 32 data flow). Runs in a Web Worker in the app and directly in tests.
 * Owns: case models, cardiac clock, renderer backend, console state, cine ring, Doppler strips,
 * ECG ring and view analysis. The UI only sends inputs and draws outputs + overlays.
 */
const ECG_HZ = 200;
const CINE_FRAMES = 96;
const STRIP_MM_WIDTH = 100; // physical width represented by the strip (mm)

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
  private stripSpectral: Float32Array | null = null;
  /** colour M-mode: aliased axial velocity per (sample, column), NaN where no flow */
  private stripCmm: Float32Array | null = null;
  private stripMmode: Uint8ClampedArray | null = null;
  private stripCols = 0;
  private stripHead = 0;
  private stripAccum = 0;
  private lastColumn: Float32Array | null = null;
  private stripKind: 'spectral' | 'm-mode' | null = null;
  private patientKey = '';
  private rgbaPool: ArrayBuffer[] = [];
  private lineAmp = new Float32Array(0);
  private lineSt = new Uint8Array(0);
  private lineTr = new Float32Array(0);
  private lineTi = new Uint8Array(0);
  /** M-mode (decision 84): traced lines per phase bin, line samples, and the strip columns' instants and bin spans. */
  private mmode = new MmodeLineCache();
  private mmodeSamples = 0;
  private stripPhase = new Float32Array(0);
  private stripSpan = new Uint16Array(0);
  private mmodeColumn = new Float32Array(0);
  private mmodeGrey = new Uint8ClampedArray(0);
  private mmodeFrame: PolarFrame | null = null;
  private mmodeConsole = createConsoleState(0);
  /** The strip as displayed (RGBA, strip rows × columns), repainted one column at a time; its layout key. */
  private stripRgba: Uint8ClampedArray | null = null;
  private stripRgbaKey = '';
  private rowMap: RowMap | null = null;
  /** Bumped when the patient models are rebuilt: traced lines and gate flow of the old models are stale. */
  private modelVersion = 0;
  /** Peak flow vector over the cycle at the last gate position (heart frame), keyed by that position. */
  private gateFlow = { key: '', best: 0, bx: 0, by: 0, bz: 0 };
  private flowSample: FlowSample = { vx: 0, vy: 0, vz: 0, dispersion: 0, present: 0 };
  private tissueSample = makeSample();
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
      this.stripHead = 0;
      this.stripAccum = 0;
      this.stripKind = null;
      this.colorPrev = null;
      this.lastColumn = null;
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
    if (isStrip) this.advanceStrip(dt, beam, spec, (MMODE_TRACE_SHARE * 1000) / fps);
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
    );
    this.colorPrev = out;
    this.colorVersion++;
  }

  private advanceStrip(dt: number, beam: BeamFrame, spec: PolarFrameSpec, traceBudgetMs: number): void {
    const inp = this.input;
    const kind: 'spectral' | 'm-mode' = inp.modality === 'm-mode' || inp.modality === 'cmm' ? 'm-mode' : 'spectral';
    const stripWidth = Math.max(64, inp.display.width);
    const secondsShown = STRIP_MM_WIDTH / inp.spectral.sweepSpeedMmPerS;
    const cps = stripWidth / secondsShown;
    const lineSamples = mmodeLineSamples(spec.depthCm);
    const cmm = inp.modality === 'cmm';
    const needMmodeRealloc =
      kind === 'm-mode' && (!this.stripMmode || this.stripMmode.length !== lineSamples * stripWidth || (this.stripCmm !== null) !== cmm || (this.stripCmm !== null && this.stripCmm.length !== spec.samples * stripWidth));
    if (this.stripKind !== kind || this.stripCols !== stripWidth || needMmodeRealloc) {
      this.stripKind = kind;
      this.stripCols = stripWidth;
      this.stripHead = 0;
      this.stripSpectral = kind === 'spectral' ? new Float32Array(SPECTRAL_BINS * stripWidth) : null;
      this.stripMmode = kind === 'm-mode' ? new Uint8ClampedArray(lineSamples * stripWidth) : null;
      this.stripCmm = cmm ? new Float32Array(spec.samples * stripWidth).fill(NaN) : null;
      this.stripPhase = new Float32Array(stripWidth);
      this.stripSpan = new Uint16Array(stripWidth);
      this.stripRgba = null;
      this.stripRgbaKey = '';
      this.mmodeSamples = lineSamples;
    }
    this.stripAccum += dt * cps;
    let n = Math.floor(this.stripAccum);
    // spectral columns are sampled one by one and bounded per step; M-mode columns all come from traced lines (decision 84)
    if (kind === 'spectral' && n > 10) n = 10;
    this.stripAccum -= n;
    const rr = this.clock.current.rrS;
    const phaseNow = this.clock.current.phase;
    if (kind === 'm-mode') {
      this.advanceMmode(n, cps, rr, phaseNow, traceBudgetMs, beam, spec);
      return;
    }
    for (let k = n - 1; k >= 0; k--) {
      const tBack = (k + 0.5) / cps;
      const phase = (((phaseNow - tBack / rr) % 1) + 1) % 1;
      const col = this.stripHead % this.stripCols;
      this.sampleSpectralColumn(beam, spec, phase, col);
      this.stripPhase[col] = phase;
      this.stripHead++;
    }
  }

  /**
   * M-mode columns of this step (decision 84): every column that is due is drawn at its own instant. Lines are traced per
   * phase bin for this probe pose, cursor and imaging settings, as many as the step's budget allows; a column is formed
   * from the traced lines on each side of its instant.
   */
  private advanceMmode(n: number, cps: number, rr: number, phaseNow: number, traceBudgetMs: number, beam: BeamFrame, spec: PolarFrameSpec): void {
    if (n <= 0) return;
    const inp = this.input;
    const theta = Math.max(-spec.sectorRad / 2, Math.min(spec.sectorRad / 2, inp.cursorThetaRad));
    const cmm = inp.modality === 'cmm';
    const bins = mmodePhaseBins(cps, this.tables.rrS);
    const ph = this.physics();
    const v3 = (v: { x: number; y: number; z: number }): string => `${v.x.toFixed(6)},${v.y.toFixed(6)},${v.z.toFixed(6)}`;
    const key = [
      v3(beam.origin),
      v3(beam.forward),
      v3(beam.lateral),
      v3(beam.normal),
      beam.contact.toFixed(4),
      theta.toFixed(6),
      spec.lines,
      spec.samples,
      spec.depthCm,
      spec.sectorRad.toFixed(6),
      spec.focusCm,
      this.mmodeSamples,
      ph.frequencyMHz,
      ph.harmonics,
      ph.clutterLevel.toFixed(4),
      ph.windowAttenuation.toFixed(4),
      (ph.beamWidth ?? 0).toFixed(4),
      cmm,
      this.modelVersion,
      this.tablesVersion,
    ].join('|');
    if (this.mmode.key !== key || this.mmode.bins !== bins) this.mmode.reset(key, bins);
    const phases = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const tBack = (n - 1 - i + 0.5) / cps;
      phases[i] = (((phaseNow - tBack / rr) % 1) + 1) % 1;
    }
    const maxTraces = this.mmode.traceMs > 0 ? Math.max(1, Math.floor(traceBudgetMs / this.mmode.traceMs)) : 1;
    for (const b of binsToTrace(this.mmode, phases, maxTraces)) {
      const t0 = performance.now();
      this.mmode.set(b, this.traceMmodeLine(beam, spec, b, theta, cmm));
      this.mmode.measure(performance.now() - t0);
    }
    const pulses = mmodePulsesPerColumn(cps);
    for (let i = 0; i < n; i++) {
      const src = columnSource(this.mmode, phases[i]!, bins >> 2) ?? columnSource(this.mmode, phases[i]!, bins >> 1);
      if (src) this.writeMmodeColumn(this.stripHead % this.stripCols, src, phases[i]!, pulses, spec);
      this.stripHead++;
    }
  }

  /** Trace the M-mode line at `phase`: the fine line envelope and, in colour M-mode, the axial flow velocity on the frame samples. */
  private traceMmodeLine(beam: BeamFrame, spec: PolarFrameSpec, bin: number, theta: number, cmm: boolean): MmodeLine {
    const phase = bin / this.mmode.bins;
    const S = this.mmodeSamples;
    if (this.lineAmp.length !== S) {
      this.lineAmp = new Float32Array(S);
      this.lineSt = new Uint8Array(S);
      this.lineTr = new Float32Array(S);
      this.lineTi = new Uint8Array(S);
    }
    const scene = this.scene(phase);
    this.procedural.renderMmodeLine(scene, beam, spec, S, theta, bin, this.lineAmp, this.lineSt, this.lineTr, this.lineTi);
    return { amp: this.lineAmp.slice(), velocity: cmm ? this.cmmVelocity(beam, spec, phase, theta, scene) : null };
  }

  /** Colour M-mode: axial flow velocity (m/s, + toward the transducer) on the frame samples of the traced line, NaN where no flow. */
  private cmmVelocity(beam: BeamFrame, spec: PolarFrameSpec, phase: number, theta: number, scene: Scene): Float32Array {
    const hf = this.heart.frame;
    const ct = Math.cos(theta),
      sn = Math.sin(theta);
    const dx = beam.forward.x * ct + beam.lateral.x * sn;
    const dy = beam.forward.y * ct + beam.lateral.y * sn;
    const dz = beam.forward.z * ct + beam.lateral.z * sn;
    const dhx = dx * hf.ex.x + dy * hf.ex.y + dz * hf.ex.z;
    const dhy = dx * hf.ey.x + dy * hf.ey.y + dz * hf.ey.z;
    const dhz = dx * hf.ez.x + dy * hf.ez.y + dz * hf.ez.z;
    const fs = this.flowSample;
    const F = spec.samples;
    const S = this.mmodeSamples;
    const out = new Float32Array(F);
    const dr = spec.depthCm / F;
    for (let si = 0; si < F; si++) {
      // the line sample at the centre of this frame sample
      const li = Math.min(S - 1, Math.floor(((si + 0.5) / F) * S));
      if (this.lineTi[li] !== Tissue.Blood || (this.lineTr[li] ?? 0) < 0.05) {
        out[si] = NaN;
        continue;
      }
      const r = (si + 0.5) * dr;
      const px = beam.origin.x + dx * r,
        py = beam.origin.y + dy * r,
        pz = beam.origin.z + dz * r;
      const hx = (px - hf.origin.x) * hf.ex.x + (py - hf.origin.y) * hf.ex.y + (pz - hf.origin.z) * hf.ex.z;
      const hy = (px - hf.origin.x) * hf.ey.x + (py - hf.origin.y) * hf.ey.y + (pz - hf.origin.z) * hf.ey.z;
      const hz = (px - hf.origin.x) * hf.ez.x + (py - hf.origin.y) * hf.ez.y + (pz - hf.origin.z) * hf.ez.z;
      sampleFlow(this.flow, this.tables, scene.heartPose, phase, hx, hy, hz, fs);
      out[si] = fs.present ? -(fs.vx * dhx + fs.vy * dhy + fs.vz * dhz) : NaN;
    }
    return out;
  }

  /** Form an M-mode column from its traced lines, pass it through the console (its pulses average the receiver noise) and store it. */
  private writeMmodeColumn(col: number, src: ColumnSource, phase: number, pulses: number, spec: PolarFrameSpec): void {
    const inp = this.input;
    const S = this.mmodeSamples;
    if (this.mmodeColumn.length !== S) {
      this.mmodeColumn = new Float32Array(S);
      this.mmodeGrey = new Uint8ClampedArray(S);
    }
    if (!this.mmodeFrame || this.mmodeFrame.spec.samples !== S || this.mmodeFrame.spec.depthCm !== spec.depthCm) {
      this.mmodeFrame = { spec: { ...spec, lines: 1, samples: S }, amplitude: this.mmodeColumn, structure: new Uint8Array(S), transmission: new Float32Array(S), tissue: new Uint8Array(S) };
    }
    const a = src.lo.amp,
      b = src.hi.amp,
      t = src.t;
    const column = this.mmodeColumn;
    for (let s = 0; s < S; s++) column[s] = a[s]! + (b[s]! - a[s]!) * t;
    const st = this.mmodeConsole;
    st.seed = (this.caseDef.seed + this.stripHead) | 0; // receiver noise is new in every column and every sweep
    st.frameIndex = 0;
    st.prev = null;
    applyConsole(this.mmodeFrame, inp.settings, st, this.mmodeGrey, NO_ARTIFACTS, { noisePulses: pulses, edgeStep: S / spec.samples });
    const cols = this.stripCols;
    const strip = this.stripMmode!;
    const grey = this.mmodeGrey;
    for (let s = 0; s < S; s++) strip[s * cols + col] = grey[s]!;
    if (this.stripCmm) {
      const v = (t < 0.5 ? src.lo : src.hi).velocity;
      const cmm = this.stripCmm;
      for (let si = 0; si < spec.samples; si++) {
        const x = v ? v[si]! : NaN;
        cmm[si * cols + col] = Number.isNaN(x) || Math.abs(x) < inp.color.wallFilterMps ? NaN : aliasVelocity(x, inp.color.scaleMps, inp.color.baselineShiftMps);
      }
    }
    this.stripPhase[col] = phase;
    this.stripSpan[col] = Math.min(65535, src.span);
    if (this.stripRgba) this.paintStripColumn(col);
  }

  private sampleSpectralColumn(beam: BeamFrame, spec: PolarFrameSpec, phase: number, col: number): void {
    const inp = this.input;
    const hf = this.heart.frame;
    const theta = Math.max(-spec.sectorRad / 2, Math.min(spec.sectorRad / 2, inp.cursorThetaRad));
    const ct = Math.cos(theta),
      sn = Math.sin(theta);
    const dx = beam.forward.x * ct + beam.lateral.x * sn;
    const dy = beam.forward.y * ct + beam.lateral.y * sn;
    const dz = beam.forward.z * ct + beam.lateral.z * sn;
    const dhx = dx * hf.ex.x + dy * hf.ex.y + dz * hf.ex.z;
    const dhy = dx * hf.ey.x + dy * hf.ey.y + dz * hf.ey.z;
    const dhz = dx * hf.ez.x + dy * hf.ez.y + dz * hf.ez.z;
    const hp = computeHeartPose(this.heart, cycleStateAt(this.tables, phase));
    const samples: VelocitySample[] = [];
    const fs = this.flowSample;
    const ts = this.tissueSample;
    const lx = beam.lateral.x * ct - beam.forward.x * sn,
      ly = beam.lateral.y * ct - beam.forward.y * sn,
      lz = beam.lateral.z * ct - beam.forward.z * sn;
    const classify = (r: number, du: number, dv: number): void => {
      const px = beam.origin.x + dx * r + lx * du + beam.normal.x * dv;
      const py = beam.origin.y + dy * r + ly * du + beam.normal.y * dv;
      const pz = beam.origin.z + dz * r + lz * du + beam.normal.z * dv;
      const hx = (px - hf.origin.x) * hf.ex.x + (py - hf.origin.y) * hf.ex.y + (pz - hf.origin.z) * hf.ex.z;
      const hy = (px - hf.origin.x) * hf.ey.x + (py - hf.origin.y) * hf.ey.y + (pz - hf.origin.z) * hf.ey.z;
      const hz = (px - hf.origin.x) * hf.ez.x + (py - hf.origin.y) * hf.ez.y + (pz - hf.origin.z) * hf.ez.z;
      const inHeart = classifyHeart(this.heart, hp, hx, hy, hz, ts);
      if (inp.modality === 'tdi') {
        if (inHeart && ts.tissue === Tissue.Myocardium) {
          const tv = sampleTissueVelocity(this.heart, this.tables, phase, hx, hy, hz, ts.structure);
          const axial = tv.vx * dhx + tv.vy * dhy + tv.vz * dhz;
          const vPerp = Math.sqrt(Math.max(0, tv.vx * tv.vx + tv.vy * tv.vy + tv.vz * tv.vz - axial * axial));
          samples.push({ v: -axial, weight: 1, dispersion: 0.05, vPerp, depthCm: r });
        }
        return;
      }
      if (!inHeart || ts.tissue !== Tissue.Blood) return;
      sampleFlow(this.flow, this.tables, hp, phase, hx, hy, hz, fs);
      if (!fs.present) {
        samples.push({ v: 0, weight: 0.3, dispersion: 0.05 });
        return;
      }
      const axial = fs.vx * dhx + fs.vy * dhy + fs.vz * dhz;
      const vPerp = Math.sqrt(Math.max(0, fs.vx * fs.vx + fs.vy * fs.vy + fs.vz * fs.vz - axial * axial));
      samples.push({ v: -axial, weight: 1, dispersion: fs.dispersion, vPerp, depthCm: r });
    };
    const aliasing = inp.modality !== 'cw';
    // heart-frame points where the sample volume can meet a valve's leaflets: along the CW line, or the PW gate
    const clickPoints: number[] = [];
    const clickPoint = (r: number): void => {
      const px = beam.origin.x + dx * r,
        py = beam.origin.y + dy * r,
        pz = beam.origin.z + dz * r;
      clickPoints.push(
        (px - hf.origin.x) * hf.ex.x + (py - hf.origin.y) * hf.ex.y + (pz - hf.origin.z) * hf.ex.z,
        (px - hf.origin.x) * hf.ey.x + (py - hf.origin.y) * hf.ey.y + (pz - hf.origin.z) * hf.ey.z,
        (px - hf.origin.x) * hf.ez.x + (py - hf.origin.y) * hf.ez.y + (pz - hf.origin.z) * hf.ez.z,
      );
    };
    if (inp.modality === 'cw') {
      const frame = this.frame;
      const li = frame ? Math.min(spec.lines - 1, Math.max(0, Math.round(((theta + spec.sectorRad / 2) / spec.sectorRad) * spec.lines))) : 0;
      const acquisition = { frequencyMHz: inp.settings.frequencyMHz, harmonics: inp.settings.harmonics };
      for (let r = 1.0; r < spec.depthCm; r += 0.25) {
        if (frame) {
          // a shadow stops the line, depth does not (decision 96): an absolute 2% cut stopped lines from the apical window
          // at 9–12 cm, before the jet of a stenotic aortic valve
          const si = Math.min(spec.samples - 1, Math.floor((r / spec.depthCm) * spec.samples));
          if (relativeTransmission(frame.transmission[li * spec.samples + si] ?? 1, r, acquisition) < DOPPLER_SHADOW_TRANSMISSION) break;
        }
        classify(r, 0, 0);
        clickPoint(r);
      }
    } else {
      const g = inp.spectral.gateLengthCm;
      if (inp.modality === 'pw') for (const k of [-0.5, 0, 0.5]) clickPoint(inp.gateDepthCm + k * g);
      const rng = createRng(this.caseDef.seed ^ (col * 7919));
      for (let i = 0; i < 20; i++) {
        const r = inp.gateDepthCm + (rng.next() - 0.5) * g;
        classify(r, (rng.next() - 0.5) * 0.35, (rng.next() - 0.5) * 0.35);
      }
    }
    const column = new Float32Array(SPECTRAL_BINS);
    const click = clickPoints.length ? valveClickWeight(this.heart, hp, this.tables, phase * this.tables.rrS, clickPoints) : 0;
    buildSpectralColumn(samples, inp.spectral, this.stripHead, this.caseDef.seed, aliasing, column, click);
    this.stripSpectral!.set(column, col * SPECTRAL_BINS);
    this.lastColumn = column;
  }

  /** Structures at the Doppler/M-mode cursor and the beam–flow angle at the PW/TDI gate (technique checks). */
  private gateInfo(beam: BeamFrame, spec: PolarFrameSpec, phase: number, structure: Uint8Array): GateInfo {
    const inp = this.input;
    const theta = Math.max(-spec.sectorRad / 2, Math.min(spec.sectorRad / 2, inp.cursorThetaRad));
    const li = Math.min(spec.lines - 1, Math.max(0, Math.round(((theta + spec.sectorRad / 2) / spec.sectorRad) * spec.lines - 0.5)));
    const lineStructures: number[] = [];
    if (structure.length === spec.lines * spec.samples) {
      for (let si = 0; si < spec.samples; si++) {
        const st = structure[li * spec.samples + si]!;
        if (st !== 0 && !lineStructures.includes(st)) lineStructures.push(st);
      }
    }
    const ct = Math.cos(theta),
      sn = Math.sin(theta);
    const r = inp.gateDepthCm;
    const dx = beam.forward.x * ct + beam.lateral.x * sn;
    const dy = beam.forward.y * ct + beam.lateral.y * sn;
    const dz = beam.forward.z * ct + beam.lateral.z * sn;
    const px = beam.origin.x + dx * r,
      py = beam.origin.y + dy * r,
      pz = beam.origin.z + dz * r;
    const hf = this.heart.frame;
    const hx = (px - hf.origin.x) * hf.ex.x + (py - hf.origin.y) * hf.ex.y + (pz - hf.origin.z) * hf.ex.z;
    const hy = (px - hf.origin.x) * hf.ey.x + (py - hf.origin.y) * hf.ey.y + (pz - hf.origin.z) * hf.ey.z;
    const hz = (px - hf.origin.x) * hf.ez.x + (py - hf.origin.y) * hf.ez.y + (pz - hf.origin.z) * hf.ez.z;
    const hp = computeHeartPose(this.heart, cycleStateAt(this.tables, phase));
    const ts = this.tissueSample;
    const inHeart = classifyHeart(this.heart, hp, hx, hy, hz, ts);
    let flowPresent = false;
    let flowAngleDeg: number | null = null;
    if (inHeart && ts.tissue === Tissue.Blood) {
      // flow direction at the gate over the cycle: use the instant of maximal speed so the angle does not depend on the frame.
      // It depends only on where the gate sits in the heart, so it is kept until the gate or the models change: sixteen
      // heart poses per composite were most of the cost of every strip frame.
      const gateKey = `${hx.toFixed(5)},${hy.toFixed(5)},${hz.toFixed(5)}|${this.modelVersion}`;
      if (this.gateFlow.key !== gateKey) {
        let best = 0;
        let bx = 0,
          by = 0,
          bz = 0;
        const fs = this.flowSample;
        for (let k = 0; k < 16; k++) {
          const ph = k / 16;
          sampleFlow(this.flow, this.tables, computeHeartPose(this.heart, cycleStateAt(this.tables, ph)), ph, hx, hy, hz, fs);
          const sp = Math.hypot(fs.vx, fs.vy, fs.vz);
          if (fs.present && sp > best) {
            best = sp;
            bx = fs.vx;
            by = fs.vy;
            bz = fs.vz;
          }
        }
        this.gateFlow = { key: gateKey, best, bx, by, bz };
      }
      const { best, bx, by, bz } = this.gateFlow;
      if (best > 0.05) {
        flowPresent = true;
        const dhx = dx * hf.ex.x + dy * hf.ex.y + dz * hf.ex.z;
        const dhy = dx * hf.ey.x + dy * hf.ey.y + dz * hf.ey.z;
        const dhz = dx * hf.ez.x + dy * hf.ez.y + dz * hf.ez.z;
        const cos = Math.abs((bx * dhx + by * dhy + bz * dhz) / best);
        flowAngleDeg = (Math.acos(Math.min(1, cos)) * 180) / Math.PI;
      }
    } else if (inHeart && ts.tissue === Tissue.Myocardium && inp.modality === 'tdi') {
      flowPresent = true;
      // tissue moves along the LV long axis: angle between the beam and the heart z axis
      const dhz = dx * hf.ez.x + dy * hf.ez.y + dz * hf.ez.z;
      flowAngleDeg = (Math.acos(Math.min(1, Math.abs(dhz))) * 180) / Math.PI;
    }
    return { thetaRad: theta, depthCm: r, structure: inHeart ? ts.structure : 0, tissue: inHeart ? ts.tissue : 0, flowPresent, flowAngleDeg, lineStructures };
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
    if (req.kind === 'autoTrace') {
      const strip = this.stripSpectral;
      if (!strip || this.stripKind !== 'spectral') return null;
      const { vMin, vMax } = spectralRange(this.input.spectral);
      const cols = this.stripCols;
      const secondsShown = STRIP_MM_WIDTH / this.input.spectral.sweepSpeedMmPerS;
      const spc = cols ? secondsShown / cols : 0;
      const x0 = Math.max(0, Math.min(cols - 1, Math.round(Math.min(req.x0, req.x1))));
      const x1 = Math.max(0, Math.min(cols - 1, Math.round(Math.max(req.x0, req.x1))));
      const baselineBin = ((vMax / (vMax - vMin)) * SPECTRAL_BINS);
      const velocitiesMps: number[] = [];
      for (let x = x0; x <= x1; x++) {
        let max = 0;
        for (let b = 0; b < SPECTRAL_BINS; b++) max = Math.max(max, strip[x * SPECTRAL_BINS + b] ?? 0);
        const thr = envelopeThreshold(max, this.input.spectral);
        // dominant side: the side of the baseline with more energy
        let above = 0,
          below = 0;
        for (let b = 0; b < SPECTRAL_BINS; b++) {
          const v = strip[x * SPECTRAL_BINS + b] ?? 0;
          if (b < baselineBin) above += v;
          else below += v;
        }
        // walk outward from the brightest bin of that side through the contiguous signal (gaps ≤ 2 bins), so that isolated
        // noise far from it does not pull the envelope to the top of the scale. It used to start at the baseline and stop at
        // the gap the wall filter leaves under a narrow laminar spectrum (decision 96).
        let edgeBin = baselineBin;
        if (above >= below) {
          let peak = -1;
          for (let b = Math.floor(baselineBin) - 1, best = thr; b >= 0; b--) if ((strip[x * SPECTRAL_BINS + b] ?? 0) > best) best = strip[x * SPECTRAL_BINS + (peak = b)]!;
          let gap = 0;
          for (let b = peak; peak >= 0 && b >= 0; b--) {
            if ((strip[x * SPECTRAL_BINS + b] ?? 0) > thr) {
              edgeBin = b;
              gap = 0;
            } else if (++gap > 2) break;
          }
        } else {
          let peak = -1;
          for (let b = Math.ceil(baselineBin), best = thr; b < SPECTRAL_BINS; b++) if ((strip[x * SPECTRAL_BINS + b] ?? 0) > best) best = strip[x * SPECTRAL_BINS + (peak = b)]!;
          let gap = 0;
          for (let b = peak; peak >= 0 && b < SPECTRAL_BINS; b++) {
            if ((strip[x * SPECTRAL_BINS + b] ?? 0) > thr) {
              edgeBin = b + 1;
              gap = 0;
            } else if (++gap > 2) break;
          }
        }
        velocitiesMps.push(vMax - (edgeBin / SPECTRAL_BINS) * (vMax - vMin));
      }
      // valve clicks have no envelope: across a click the trace joins the columns on either side (decision 103), as a
      // sonographer ignores the line; the VTI would otherwise add a spike to the top of the scale at each one
      const core = velocitiesMps.map((_, i) => isClickColumn(strip.subarray((x0 + i) * SPECTRAL_BINS, (x0 + i + 1) * SPECTRAL_BINS), this.input.spectral));
      // the click's tails, too faint to fill the scale, still lift the envelope: bridge 2.5 click widths on each side
      const reach = Math.ceil((2.5 * CLICK_SIGMA_S) / Math.max(1e-6, spc));
      const click = core.map((_, i) => core.slice(Math.max(0, i - reach), i + reach + 1).some(Boolean));
      for (let i = 0; i < velocitiesMps.length; i++) {
        if (!click[i]) continue;
        let a = i - 1,
          b = i + 1;
        while (a >= 0 && click[a]) a--;
        while (b < velocitiesMps.length && click[b]) b++;
        const va = a >= 0 ? velocitiesMps[a]! : b < velocitiesMps.length ? velocitiesMps[b]! : 0;
        const vb = b < velocitiesMps.length ? velocitiesMps[b]! : va;
        for (let k = a + 1; k < b; k++) velocitiesMps[k] = va + ((vb - va) * (k - a)) / (b - a);
        i = b - 1;
      }
      return { kind: 'autoTrace', velocitiesMps, secondsPerColumn: spc, x0 };
    }
    return null;
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
    if (isStrip) strip = this.drawStrip(rgba, W, H, sectorH, fspec);
    const view = cf ? cf.analysis : this.lastAnalysis;
    const c = this.clock.current;
    const structure = cf ? cf.structure : this.frame ? this.frame.structure : new Uint8Array(0);
    const gate = isStrip ? this.gateInfo(beam, fspec, cf ? cf.phase : c.phase, structure) : null;
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
      spectrumColumn: this.lastColumn,
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

  private drawStrip(rgba: Uint8ClampedArray, W: number, H: number, sectorH: number, spec: PolarFrameSpec): StripInfo {
    const inp = this.input;
    const y0 = sectorH + 2;
    const h = H - y0 - 4;
    const cols = this.stripCols;
    const secondsShown = STRIP_MM_WIDTH / inp.spectral.sweepSpeedMmPerS;
    const spc = cols ? secondsShown / cols : 0;
    const kind = this.stripKind;
    const head = this.stripHead % Math.max(1, cols);
    if (kind === 'm-mode' && this.stripMmode && cols === W && h > 0) {
      // the strip image is kept between frames and repainted column by column as columns are written (decision 84)
      const layout = `${W}x${h}|${this.mmodeSamples}|${spec.samples}|${this.stripCmm ? 1 : 0}|${inp.color.invert ? 1 : 0}|${inp.color.scaleMps}`;
      if (this.stripRgbaKey !== layout || !this.stripRgba) {
        this.stripRgba = new Uint8ClampedArray(W * h * 4);
        this.rowMap = buildRowMap(h, this.mmodeSamples);
        this.stripRgbaKey = layout;
        for (let c = 0; c < cols; c++) this.paintStripColumn(c);
      }
      rgba.set(this.stripRgba, y0 * W * 4);
      this.drawSweepMarker(rgba, W, y0, h, head);
      return { x: 0, y: y0, width: W, height: h, secondsPerColumn: spc, topValue: 0, bottomValue: spec.depthCm, kind: 'm-mode' };
    }
    if (kind === 'spectral' && this.stripSpectral) {
      const { vMin, vMax } = spectralRange(inp.spectral);
      for (let y = 0; y < h; y++) {
        const b = Math.min(SPECTRAL_BINS - 1, Math.floor((y / h) * SPECTRAL_BINS));
        for (let x = 0; x < W; x++) {
          const col = x < cols ? x : cols - 1;
          const v = this.stripSpectral[col * SPECTRAL_BINS + b] ?? 0;
          const g = Math.round(Math.min(1, v) * 255);
          const o = ((y0 + y) * W + x) * 4;
          rgba[o] = g;
          rgba[o + 1] = Math.round(g * 0.93);
          rgba[o + 2] = Math.round(g * 0.8);
          rgba[o + 3] = 255;
        }
      }
      const yb = y0 + Math.round((vMax / (vMax - vMin)) * h);
      for (let x = 0; x < W; x++) {
        const o = (Math.min(H - 1, yb) * W + x) * 4;
        rgba[o] = 90;
        rgba[o + 1] = 160;
        rgba[o + 2] = 90;
      }
      this.drawSweepMarker(rgba, W, y0, h, head);
      return { x: 0, y: y0, width: W, height: h, secondsPerColumn: spc, topValue: vMax, bottomValue: vMin, kind: 'spectral' };
    }
    return { x: 0, y: y0, width: W, height: h, secondsPerColumn: spc, topValue: 0, bottomValue: 0, kind: null };
  }

  /** Paint one column of the displayed M-mode strip: grey rows from the line samples they cover, then the colour M-mode velocities. */
  private paintStripColumn(col: number): void {
    const img = this.stripRgba,
      map = this.rowMap,
      strip = this.stripMmode;
    if (!img || !map || !strip || map.samples !== this.mmodeSamples) return;
    const cols = this.stripCols;
    const S = this.mmodeSamples;
    const { rows, taps, first, weights } = map;
    for (let y = 0; y < rows; y++) {
      let g = 0;
      const i0 = first[y]!;
      for (let k = 0; k < taps; k++) {
        const w = weights[y * taps + k]!;
        if (w > 0 && i0 + k < S) g += w * strip[(i0 + k) * cols + col]!;
      }
      const o = (y * cols + col) * 4;
      img[o] = g;
      img[o + 1] = g;
      img[o + 2] = g;
      img[o + 3] = 255;
    }
    const cmm = this.stripCmm;
    if (cmm) {
      const inp = this.input;
      const F = cmm.length / cols;
      const rgb: [number, number, number] = [0, 0, 0];
      for (let y = 0; y < rows; y++) {
        const v = cmm[Math.min(F - 1, Math.floor((y / rows) * F)) * cols + col]!;
        if (Number.isNaN(v)) continue;
        colorMap(inp.color.invert ? -v : v, inp.color.scaleMps, 0, false, rgb);
        const o = (y * cols + col) * 4;
        img[o] = rgb[0];
        img[o + 1] = rgb[1];
        img[o + 2] = rgb[2];
      }
    }
  }

  private drawSweepMarker(rgba: Uint8ClampedArray, W: number, y0: number, h: number, head: number): void {
    const x = Math.min(W - 1, head);
    for (let y = 0; y < h; y++) {
      const o = ((y0 + y) * W + x) * 4;
      rgba[o] = 120;
      rgba[o + 1] = 200;
      rgba[o + 2] = 120;
    }
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
    if (this.stripKind !== 'm-mode' || !this.stripMmode) return null;
    return { samples: this.mmodeSamples, cols: this.stripCols, head: this.stripHead, grey: this.stripMmode, phase: this.stripPhase, span: this.stripSpan, bins: this.mmode.bins, traced: this.mmode.filled };
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
  get spectralStrip(): { data: Float32Array | null; cols: number; head: number; phase: Float32Array } {
    return { data: this.stripSpectral, cols: this.stripCols, head: this.stripHead, phase: this.stripPhase };
  }
  heartPoseNow(): HeartPose {
    return computeHeartPose(this.heart, cycleStateAt(this.tables, this.clock.current.phase));
  }
}
