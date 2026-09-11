import type { CaseDefinition } from '@/cases/schema';
import { classifyHeart, computeHeartPose, createHeartModel, heartLandmarks, type HeartModel, type HeartPose } from '@/simulator/anatomy/heartModel';
import { createThoraxModel, type ThoraxModel } from '@/simulator/anatomy/thoraxModel';
import { buildBeatTables, cycleStateAt, type BeatTables } from '@/simulator/cardiac-cycle/cycleModel';
import { CardiacClock } from '@/simulator/cardiac-cycle/clock';
import { ecgSample } from '@/simulator/cardiac-cycle/ecg';
import { ProceduralSliceRenderer } from '@/simulator/renderer/procedural/sliceRenderer';
import { createWebgl2Renderer } from '@/simulator/renderer/gpu/webgl2Renderer';
import { AtlasRenderer } from '@/simulator/renderer/atlas/atlasRenderer';
import { allocPolarFrame, polarSpecFor, type PolarFrame, type PolarFrameSpec, type RendererBackend, type RenderHints, type Scene } from '@/simulator/renderer/types';
import { AtlasRenderer as AtlasBackend } from '@/simulator/renderer/atlas/atlasRenderer';
import { applyConsole, createConsoleState, type ArtifactSettings, type ConsoleState } from '@/simulator/renderer/postprocess/consolePipeline';
import { buildScanLut, computeSectorMapping, lutKey, scanConvertLut, type ScanLut, type SectorMapping } from '@/simulator/renderer/scanConvert';
import { simulatedFrameRate } from '@/simulator/renderer/frameRate';
import { beamFrameFromPose, contactQuality, poseFromControl, type BeamFrame } from '@/simulator/probe/pose';
import { analyzeView, type ViewAnalysis } from '@/simulator/view-recognition/viewQuality';
import { buildFlowParams, sampleFlow, sampleTissueVelocity, type FlowFieldParams, type FlowSample } from '@/simulator/doppler/flow-primitives/flowField';
import { allocColorField, colorMap, computeColorField, type ColorField } from '@/simulator/doppler/color/colorDoppler';
import { aliasVelocity } from '@/clinical/formulas';
import { buildSpectralColumn, SPECTRAL_BINS, spectralRange, type VelocitySample } from '@/simulator/doppler/spectral/spectrum';
import { computeGroundTruth, type StructuredEchoTruth } from '@/simulator/hemodynamics/groundTruth';
import { makeSample, Tissue } from '@/simulator/anatomy/tissue';
import { createRng } from '@/core/random';
import type { EcgPoint, GateInfo, PhaseMarks, SimInput, SimOutput, SimRequest, SimResponse, StripInfo } from './protocol';

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
  private clock: CardiacClock;
  private flow: FlowFieldParams;
  private procedural = new ProceduralSliceRenderer();
  private atlas: AtlasRenderer;
  private backend: RendererBackend;
  /** WebGL2 port of the procedural renderer; null when unavailable (reason in `gpuReason`). */
  private gpu: RendererBackend | null;
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
  private color: ColorField | null = null;
  private colorPrev: ColorField | null = null;
  private colorFrameCounter = 0;
  private colorFps = 0;
  private cine: CineFrame[] = [];
  private frameId = 0;
  private timeS = 0;
  private frameAccumulator = 0;
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
  private flowSample: FlowSample = { vx: 0, vy: 0, vz: 0, dispersion: 0, present: 0 };
  private tissueSample = makeSample();
  private lastOutputBeam: BeamFrame | null = null;
  private lastSector: (SectorMapping & { x: number; y: number }) | null = null;
  private lastStrip: StripInfo | null = null;
  private timing = { renderFrameMs: 0, compositeMs: 0, analysisMs: 0, consoleMs: 0 };
  private lut: ScanLut | null = null;
  private prevBeam: BeamFrame | null = null;
  private stationaryFrames = 0;

  constructor(caseDef: CaseDefinition, input: SimInput) {
    this.caseDef = caseDef;
    this.input = input;
    this.thorax = createThoraxModel(caseDef.bodyHabitus, caseDef.acousticWindow, input.patient, caseDef.anatomy.ivc.collapsePct);
    this.patientKey = JSON.stringify(input.patient);
    this.heart = createHeartModel(caseDef.anatomy, caseDef.physiology, this.thorax.heartOffset, caseDef.seed, this.thorax.ivcCollapse);
    this.tables = buildBeatTables(60 / caseDef.rhythm.heartRateBpm, caseDef.physiology, caseDef.rhythm, caseDef.hemodynamics);
    this.clock = new CardiacClock(caseDef.rhythm, caseDef.seed);
    this.truth = computeGroundTruth(caseDef, this.tables);
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
      this.flow = this.buildFlow();
      this.atlas.invalidate();
      this.patientKey = key;
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
    if (this.rgbaPool.length < 3) this.rgbaPool.push(buffer);
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
    this.timeS += dt;
    this.accumulateEcg(pre.timeInBeatS, pre.rrS, dt);
    if (isStrip) this.advanceStrip(dt, beam, spec);
    this.frameAccumulator += dt;
    const frameInterval = 1 / fps;
    let produced = false;
    // the worker paces itself at the simulated frame interval; tolerate timer jitter so the cadence
    // stays even instead of skipping every few frames
    if (this.frameAccumulator >= frameInterval * 0.85 || !this.frame) {
      this.frameAccumulator = 0;
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

  private scene(phase: number): Scene {
    const state = cycleStateAt(this.tables, phase);
    const s = this.input.settings;
    return {
      heart: this.heart,
      heartPose: computeHeartPose(this.heart, state),
      thorax: this.thorax,
      physics: {
        frequencyMHz: s.frequencyMHz,
        harmonics: s.harmonics,
        clutterLevel: Math.min(1, this.caseDef.acousticWindow.clutterLevel + 0.6 * this.clutterBoost) + this.caseDef.acousticWindow.emphysemaScatter * 0.5,
        windowAttenuation: this.caseDef.acousticWindow.chestWallAttenuation,
        seed: this.caseDef.seed,
      },
    };
  }

  private renderFrame(beam: BeamFrame, spec: PolarFrameSpec): void {
    const inp = this.input;
    if (!this.frame || this.frame.spec.lines !== spec.lines || this.frame.spec.samples !== spec.samples || this.frame.spec.depthCm !== spec.depthCm || this.frame.spec.sectorRad !== spec.sectorRad) {
      this.frame = allocPolarFrame(spec);
      this.display = new Uint8ClampedArray(spec.lines * spec.samples);
      this.consoleState = createConsoleState(this.caseDef.seed);
      this.color = allocColorField(spec.lines * spec.samples);
      this.colorPrev = null;
    }
    const phase = this.clock.current.phase;
    const scene = this.scene(phase);
    // stationary detection for the atlas: build cine anchors only while the probe rests
    const moved = this.prevBeam ? AtlasBackend.poseDistance(this.prevBeam, beam) : Infinity;
    this.stationaryFrames = moved < 0.03 ? this.stationaryFrames + 1 : 0;
    this.prevBeam = beam;
    const hints: RenderHints = {
      stationary: this.stationaryFrames >= 6,
      budgetMs: 25,
      sceneAtPhase: (ph) => this.scene(ph),
    };
    this.backend.render(scene, beam, spec, phase, this.frame, hints);
    const tc = performance.now();
    applyConsole(this.frame, inp.settings, this.consoleState, this.display!, this.artifacts);
    this.timing.consoleMs = performance.now() - tc;
    let colorVel: Float32Array | null = null;
    let colorVar: Float32Array | null = null;
    if (inp.modality === 'color') {
      this.colorFrameCounter++;
      // colour packets cost frames: update the colour field every other B-mode frame
      if (this.colorFrameCounter % 2 === 0 || !this.colorPrev) {
        this.computeColor(scene, beam, spec, phase);
        this.colorPrev = this.color;
      }
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
    this.frameId++;
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
    const out = this.color!;
    computeColorField(
      frame,
      this.input.color,
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
    );
  }

  private advanceStrip(dt: number, beam: BeamFrame, spec: PolarFrameSpec): void {
    const inp = this.input;
    const kind: 'spectral' | 'm-mode' = inp.modality === 'm-mode' || inp.modality === 'cmm' ? 'm-mode' : 'spectral';
    const stripWidth = Math.max(64, inp.display.width);
    const secondsShown = STRIP_MM_WIDTH / inp.spectral.sweepSpeedMmPerS;
    const cps = stripWidth / secondsShown;
    const needMmodeRealloc = kind === 'm-mode' && (!this.stripMmode || this.stripMmode.length !== spec.samples * stripWidth);
    if (this.stripKind !== kind || this.stripCols !== stripWidth || needMmodeRealloc) {
      this.stripKind = kind;
      this.stripCols = stripWidth;
      this.stripHead = 0;
      this.stripSpectral = kind === 'spectral' ? new Float32Array(SPECTRAL_BINS * stripWidth) : null;
      this.stripMmode = kind === 'm-mode' ? new Uint8ClampedArray(spec.samples * stripWidth) : null;
      this.stripCmm = inp.modality === 'cmm' ? new Float32Array(spec.samples * stripWidth).fill(NaN) : null;
      this.lineAmp = new Float32Array(spec.samples);
      this.lineSt = new Uint8Array(spec.samples);
      this.lineTr = new Float32Array(spec.samples);
      this.lineTi = new Uint8Array(spec.samples);
    }
    this.stripAccum += dt * cps;
    let n = Math.floor(this.stripAccum);
    if (n > 10) n = 10; // bounded work per step
    this.stripAccum -= n;
    const rr = this.clock.current.rrS;
    const phaseNow = this.clock.current.phase;
    for (let k = n - 1; k >= 0; k--) {
      const tBack = (k + 0.5) / cps;
      const phase = (((phaseNow - tBack / rr) % 1) + 1) % 1;
      const col = this.stripHead % this.stripCols;
      if (kind === 'm-mode') this.sampleMmodeColumn(beam, spec, phase, col);
      else this.sampleSpectralColumn(beam, spec, phase, col);
      this.stripHead++;
    }
  }

  private sampleMmodeColumn(beam: BeamFrame, spec: PolarFrameSpec, phase: number, col: number): void {
    const scene = this.scene(phase);
    const theta = Math.max(-spec.sectorRad / 2, Math.min(spec.sectorRad / 2, this.input.cursorThetaRad));
    this.procedural.renderSingleLine(scene, beam, spec, theta, this.lineAmp, this.lineSt, this.lineTr, this.lineTi);
    const oneLine: PolarFrame = { spec: { ...spec, lines: 1 }, amplitude: this.lineAmp, structure: this.lineSt, transmission: this.lineTr, tissue: this.lineTi };
    const disp = new Uint8ClampedArray(spec.samples);
    const st = createConsoleState(this.caseDef.seed + col);
    applyConsole(oneLine, { ...this.input.settings, persistence: 0 }, st, disp);
    const strip = this.stripMmode!;
    for (let s = 0; s < spec.samples; s++) strip[s * this.stripCols + col] = disp[s] ?? 0;
    if (this.stripCmm) this.sampleCmmColumn(beam, spec, phase, col, scene);
  }

  /** Colour M-mode: axial flow velocity along the cursor line for this column (aliased at the colour scale). */
  private sampleCmmColumn(beam: BeamFrame, spec: PolarFrameSpec, phase: number, col: number, scene: Scene): void {
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
    const fs = this.flowSample;
    const strip = this.stripCmm!;
    const dr = spec.depthCm / spec.samples;
    const scale = inp.color.scaleMps;
    for (let si = 0; si < spec.samples; si++) {
      const idx = si * this.stripCols + col;
      if (this.lineTi[si] !== Tissue.Blood || (this.lineTr[si] ?? 0) < 0.05) {
        strip[idx] = NaN;
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
      if (!fs.present) {
        strip[idx] = NaN;
        continue;
      }
      const v = -(fs.vx * dhx + fs.vy * dhy + fs.vz * dhz); // + toward the transducer
      strip[idx] = Math.abs(v) < inp.color.wallFilterMps ? NaN : aliasVelocity(v, scale, inp.color.baselineShiftMps);
    }
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
          const tv = sampleTissueVelocity(this.heart, this.tables, phase, hz);
          samples.push({ v: -(tv.vx * dhx + tv.vy * dhy + tv.vz * dhz), weight: 1, dispersion: 0.05 });
        }
        return;
      }
      if (!inHeart || ts.tissue !== Tissue.Blood) return;
      sampleFlow(this.flow, this.tables, hp, phase, hx, hy, hz, fs);
      if (!fs.present) {
        samples.push({ v: 0, weight: 0.3, dispersion: 0.05 });
        return;
      }
      samples.push({ v: -(fs.vx * dhx + fs.vy * dhy + fs.vz * dhz), weight: 1, dispersion: fs.dispersion });
    };
    const aliasing = inp.modality !== 'cw';
    if (inp.modality === 'cw') {
      const frame = this.frame;
      const li = frame ? Math.min(spec.lines - 1, Math.max(0, Math.round(((theta + spec.sectorRad / 2) / spec.sectorRad) * spec.lines))) : 0;
      for (let r = 1.0; r < spec.depthCm; r += 0.25) {
        if (frame) {
          const si = Math.min(spec.samples - 1, Math.floor((r / spec.depthCm) * spec.samples));
          if ((frame.transmission[li * spec.samples + si] ?? 1) < 0.02) break; // shadow: nothing beyond
        }
        classify(r, 0, 0);
      }
    } else {
      const g = inp.spectral.gateLengthCm;
      const rng = createRng(this.caseDef.seed ^ (col * 7919));
      for (let i = 0; i < 20; i++) {
        const r = inp.gateDepthCm + (rng.next() - 0.5) * g;
        classify(r, (rng.next() - 0.5) * 0.35, (rng.next() - 0.5) * 0.35);
      }
    }
    const column = new Float32Array(SPECTRAL_BINS);
    buildSpectralColumn(samples, inp.spectral, this.stripHead, this.caseDef.seed, aliasing, column);
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
      // flow direction at the gate over the cycle: use the instant of maximal speed so the angle does not depend on the frame
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
        const thr = Math.max(0.12, 0.35 * max);
        // dominant side: the side of the baseline with more energy
        let above = 0,
          below = 0;
        for (let b = 0; b < SPECTRAL_BINS; b++) {
          const v = strip[x * SPECTRAL_BINS + b] ?? 0;
          if (b < baselineBin) above += v;
          else below += v;
        }
        // walk from the baseline outward through the contiguous signal blob (gaps ≤ 2 bins), so that
        // isolated noise far from the baseline does not pull the envelope to the top of the scale
        let edgeBin = baselineBin;
        if (above >= below) {
          let gap = 0;
          for (let b = Math.floor(baselineBin) - 1; b >= 0; b--) {
            if ((strip[x * SPECTRAL_BINS + b] ?? 0) > thr) {
              edgeBin = b;
              gap = 0;
            } else if (++gap > 2) break;
          }
        } else {
          let gap = 0;
          for (let b = Math.ceil(baselineBin); b < SPECTRAL_BINS; b++) {
            if ((strip[x * SPECTRAL_BINS + b] ?? 0) > thr) {
              edgeBin = b + 1;
              gap = 0;
            } else if (++gap > 2) break;
          }
        }
        velocitiesMps.push(vMax - (edgeBin / SPECTRAL_BINS) * (vMax - vMin));
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
    const buffer = this.takeBuffer(W * H * 4);
    const rgba = new Uint8ClampedArray(buffer);
    const display = cf ? cf.display : this.display;
    const fspec = cf ? cf.spec : spec;
    if (!display) return null;
    const mapping = computeSectorMapping(fspec, W, sectorH, inp.settings.invertLR, inp.settings.zoom);
    const key = lutKey(fspec, mapping);
    if (!this.lut || this.lut.key !== key) this.lut = buildScanLut(fspec, mapping);
    // the sector occupies the top rows of the composite: scan-convert straight into the buffer
    const sectorRgba = new Uint8ClampedArray(buffer, 0, W * sectorH * 4);
    scanConvertLut(display, this.lut, sectorRgba);
    const colorVel = cf ? cf.colorVel : inp.modality === 'color' && this.colorPrev ? this.colorPrev.vel : null;
    const colorVar = cf ? cf.colorVar : inp.modality === 'color' && this.colorPrev ? this.colorPrev.variance : null;
    if (colorVel && colorVar) this.overlayColor(sectorRgba, this.lut, colorVel, colorVar);
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
        analysisMs: Number(this.timing.analysisMs.toFixed(1)),
        compositeMs: Number(this.timing.compositeMs.toFixed(1)),
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

  private overlayColor(rgba: Uint8ClampedArray, lut: ScanLut, vel: Float32Array, variance: Float32Array): void {
    const c = this.input.color;
    const rgb: [number, number, number] = [0, 0, 0];
    const S = lut.samples;
    const n = lut.idx.length;
    for (let p = 0, o = 0; p < n; p++, o += 4) {
      if ((lut.idx[p] ?? -1) < 0) continue;
      const r = lut.rCm[p] ?? 0;
      if (r < c.boxRMinCm || r > c.boxRMaxCm) continue;
      const th = lut.theta[p] ?? 0;
      if (th < c.boxThetaMinRad || th > c.boxThetaMaxRad) continue;
      const k = (lut.li[p] ?? 0) * S + (lut.si[p] ?? 0);
      const v = vel[k];
      if (v === undefined || Number.isNaN(v)) continue;
      colorMap(v, c.scaleMps, variance[k] ?? 0, c.showVariance, rgb);
      const g = rgba[o] ?? 0;
      rgba[o] = Math.round(rgb[0] * 0.85 + g * 0.15);
      rgba[o + 1] = Math.round(rgb[1] * 0.85 + g * 0.15);
      rgba[o + 2] = Math.round(rgb[2] * 0.85 + g * 0.15);
    }
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
    if (kind === 'm-mode' && this.stripMmode) {
      const rows = spec.samples;
      for (let y = 0; y < h; y++) {
        const s = Math.min(rows - 1, Math.floor((y / h) * rows));
        for (let x = 0; x < W; x++) {
          const col = x < cols ? x : cols - 1;
          const g = this.stripMmode[s * cols + col] ?? 0;
          const o = ((y0 + y) * W + x) * 4;
          rgba[o] = g;
          rgba[o + 1] = g;
          rgba[o + 2] = g;
          rgba[o + 3] = 255;
        }
      }
      if (this.stripCmm) {
        const rgb: [number, number, number] = [0, 0, 0];
        const scale = inp.color.scaleMps;
        for (let y = 0; y < h; y++) {
          const s = Math.min(rows - 1, Math.floor((y / h) * rows));
          for (let x = 0; x < W; x++) {
            const col = x < cols ? x : cols - 1;
            const v = this.stripCmm[s * cols + col];
            if (v === undefined || Number.isNaN(v)) continue;
            colorMap(inp.color.invert ? -v : v, scale, 0, false, rgb);
            const o = ((y0 + y) * W + x) * 4;
            rgba[o] = rgb[0];
            rgba[o + 1] = rgb[1];
            rgba[o + 2] = rgb[2];
          }
        }
      }
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
  get lastView(): ViewAnalysis | null {
    return this.lastAnalysis;
  }
  get lastBeam(): BeamFrame | null {
    return this.lastOutputBeam;
  }
  get lastFrame(): PolarFrame | null {
    return this.frame;
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
  get spectralStrip(): { data: Float32Array | null; cols: number; head: number } {
    return { data: this.stripSpectral, cols: this.stripCols, head: this.stripHead };
  }
  heartPoseNow(): HeartPose {
    return computeHeartPose(this.heart, cycleStateAt(this.tables, this.clock.current.phase));
  }
}
