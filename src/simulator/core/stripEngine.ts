import { StripTimeGrid } from './stripTimeGrid';
import { accumulatePulsedSpectrum } from '@/simulator/doppler/spectral/pulsedIq';
import { sceneClassifier } from '@/simulator/anatomy/sceneClassifier';
import { DUPLEX_BMODE_SHARE } from '@/simulator/renderer/pulseTiming';
import { acousticAccess } from '@/simulator/doppler/acousticAccess';
import type { CaseDefinition } from '@/cases/schema';
import { computeHeartPose, type HeartModel } from '@/simulator/anatomy/heartModel';
import { cycleStateAt, type BeatTables } from '@/simulator/cardiac-cycle/cycleModel';
import type { ProceduralSliceRenderer } from '@/simulator/renderer/procedural/sliceRenderer';
import type { PolarFrame, PolarFrameSpec, Scene, ScenePhysics } from '@/simulator/renderer/types';
import {
  applyConsole,
  createConsoleState,
  NO_ARTIFACTS,
} from '@/simulator/renderer/postprocess/consolePipeline';
import type { BeamFrame } from '@/simulator/probe/pose';
import {
  sampleFlow,
  sampleTissueVelocity,
  type FlowFieldParams,
  type FlowSample,
} from '@/simulator/doppler/flow-primitives/flowField';
import { type ColorSettings, colorMap } from '@/simulator/doppler/color/colorDoppler';
import { aliasVelocity } from '@/clinical/formulas';
import { MODALITIES } from '@/simulator/renderer/modality';
import {
  buildSpectralColumn,
  presentSpectralColumn,
  CLICK_SIGMA_S,
  envelopeThreshold,
  isClickColumn,
  SPECTRAL_BINS,
  spectralRange,
  type VelocitySample,
  type SpectralSettings,
} from '@/simulator/doppler/spectral/spectrum';
import { valveClickWeight } from '@/simulator/doppler/spectral/valveClicks';
import { makeSample, Tissue } from '@/simulator/anatomy/tissue';
import { createRng } from '@/core/random';
import type { GateInfo, SimInput, SimRequest, SimResponse, StripInfo } from './protocol';
import {
  binsToTrace,
  buildRowMap,
  columnSource,
  MmodeLineCache,
  mmodeLineSamples,
  mmodePhaseBins,
  mmodePulsesPerColumn,
  type ColumnSource,
  type MmodeLine,
  type RowMap,
} from './mmodeStrip';

const STRIP_MM_WIDTH = 100; // physical width represented by the strip (mm)

/** Core services the strip engine reads per call (the core rebuilds it; mutable state lives on the engine). */
export interface StripCtx {
  input: SimInput;
  caseDef: CaseDefinition;
  heart: HeartModel;
  tables: BeatTables;
  flow: FlowFieldParams;
  timeS: number;
  modelVersion: number;
  tablesVersion: number;
  /** Cycle phase and RR at the moment of the call. */
  phaseNow: number;
  rrS: number;
  procedural: ProceduralSliceRenderer;
  moment(timeS: number): {
    phase: number;
    beatIndex: number;
    tablesVersion: number;
    tables: BeatTables;
    flow: FlowFieldParams;
    scene: Scene;
  };
  scene(phase: number): Scene;
  physics(): ScenePhysics;
}

/**
 * The strip machinery of the simulator: spectral (PW/CW/TDI) and M-mode/colour-M-mode columns, their displayed
 * image and the gate/auto-trace read-outs over them. Columns are written at their own instants (decision 115);
 * M-mode columns are formed from lines traced per phase bin (decision 84).
 */
/**
 * How far one column of an auto-traced envelope may stand above both of its neighbours before it is taken for a line and
 * not a flow (decision 232). A flow rises steeply — up to 0.47 m/s per column (6.3 ms) in the jet of the severe stenosis
 * and 0.75 at the onset of the severe regurgitation — but keeps rising or falls back over several columns; it does not
 * gain and lose half a metre per second within one.
 */
const SPIKE_MPS = 0.5;

export class StripEngine {
  private stripSpectral: Float32Array | null = null;
  /** What the screen shows of the spectral strip (decision 115): the estimate with its grain; the envelope reads `stripSpectral`. */
  private stripDisplay: Float32Array | null = null;
  /** colour M-mode: aliased axial velocity per (sample, column), NaN where no flow */
  private stripCmm: Float32Array | null = null;
  private stripMmode: Uint8ClampedArray | null = null;
  private stripCols = 0;
  private stripHead = 0;
  private acquisitionId = 0;
  private headTimeS: number | undefined;
  private timeline = new StripTimeGrid();
  private stripSampleTime = new Float64Array(0);
  private stripBeatIndex = new Uint32Array(0);
  private stripTablesVersion = new Uint32Array(0);
  private lastColumn: Float32Array | null = null;
  private stripKind: 'spectral' | 'm-mode' | null = null;
  private acquisitionKey = '';
  /** Calibration belongs to the stored signal, never to pending console input. */
  private acquired: {
    spectral: SpectralSettings;
    color: ColorSettings;
    depthCm: number;
    frequencyMHz: number;
  } | null = null;
  private displayCols = 0;
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
  /** Peak flow vector over the cycle at the last gate position (heart frame), keyed by that position. */
  private gateFlow = { key: '', best: 0, bx: 0, by: 0, bz: 0 };
  private flowSample: FlowSample = { vx: 0, vy: 0, vz: 0, dispersion: 0, present: 0 };
  private tissueSample = makeSample();

  /** Reset on a modality or acquisition-calibration change; old columns must not acquire new units. */
  reset(): void {
    this.acquisitionId++;
    this.headTimeS = undefined;
    this.stripHead = 0;
    this.timeline.reset();
    this.stripKind = null;
    this.lastColumn = null;
    this.acquired = null;
  }

  get historyId(): number {
    return this.acquisitionId;
  }

  get velocityRange(): { vMin: number; vMax: number } | null {
    return this.acquired && this.stripKind === 'spectral'
      ? spectralRange(this.acquired.spectral)
      : null;
  }

  get spectrumColumn(): Float32Array | null {
    return this.lastColumn;
  }

  /**
   * The M-mode strip as stored (decision 84): grey levels indexed [sample × columns + column] over `samples` line samples,
   * the cycle phase of each column, the phase bins between the two traced lines it was formed from (1 at full time
   * resolution) and the head (next column to write). Null outside M-mode.
   */
  get mmodeStrip(): {
    samples: number;
    cols: number;
    head: number;
    grey: Uint8ClampedArray;
    phase: Float32Array;
    span: Uint16Array;
    bins: number;
    traced: number;
  } | null {
    if (this.stripKind !== 'm-mode' || !this.stripMmode) return null;
    return {
      samples: this.mmodeSamples,
      cols: this.stripCols,
      head: this.stripHead,
      grey: this.stripMmode,
      phase: this.stripPhase,
      span: this.stripSpan,
      bins: this.mmode.bins,
      traced: this.mmode.filled,
    };
  }

  /** The spectral strip (SPECTRAL_BINS values per column), the cycle phase each column was sampled at, and the head. */
  get spectralStrip(): {
    data: Float32Array | null;
    display: Float32Array | null;
    cols: number;
    head: number;
    phase: Float32Array;
    sampleTimeS: Float64Array;
    beatIndex: Uint32Array;
    tablesVersion: Uint32Array;
  } {
    return {
      data: this.stripSpectral,
      display: this.stripDisplay,
      cols: this.stripCols,
      head: this.stripHead,
      phase: this.stripPhase,
      sampleTimeS: this.stripSampleTime,
      beatIndex: this.stripBeatIndex,
      tablesVersion: this.stripTablesVersion,
    };
  }

  advance(
    dt: number,
    beam: BeamFrame,
    spec: PolarFrameSpec,
    traceBudgetMs: number,
    ctx: StripCtx,
  ): void {
    const inp = ctx.input;
    const key = JSON.stringify([
      inp.modality,
      inp.spectral.sweepSpeedMmPerS,
      inp.settings.depthCm,
      inp.settings.frequencyMHz,
      inp.cursorThetaRad,
      inp.gateDepthCm,
      inp.spectral.scaleMps,
      inp.spectral.baselineShiftMps,
      inp.spectral.invert,
      inp.spectral.wallFilterMps,
      inp.spectral.gainDb,
      inp.spectral.gateLengthCm,
      inp.color.scaleMps,
      inp.color.baselineShiftMps,
      inp.color.invert,
      inp.color.wallFilterMps,
    ]);
    if (key !== this.acquisitionKey || !this.acquired) {
      this.reset();
      this.acquisitionKey = key;
      this.acquired = {
        spectral: { ...inp.spectral },
        color: { ...inp.color },
        depthCm: spec.depthCm,
        frequencyMHz: inp.settings.frequencyMHz,
      };
    }
    const kind: 'spectral' | 'm-mode' = MODALITIES[inp.modality].strip ?? 'spectral';
    const stripWidth = Math.max(64, inp.display.width);
    const secondsShown = STRIP_MM_WIDTH / inp.spectral.sweepSpeedMmPerS;
    const cps = stripWidth / secondsShown;
    const lineSamples = mmodeLineSamples(spec.depthCm);
    const cmm = inp.modality === 'cmm';
    const needMmodeRealloc =
      kind === 'm-mode' &&
      (!this.stripMmode ||
        this.stripMmode.length !== lineSamples * stripWidth ||
        (this.stripCmm !== null) !== cmm ||
        (this.stripCmm !== null && this.stripCmm.length !== spec.samples * stripWidth));
    if (this.stripKind !== kind || this.stripCols !== stripWidth || needMmodeRealloc) {
      this.acquisitionId++;
      this.headTimeS = undefined;
      this.stripKind = kind;
      this.stripCols = stripWidth;
      this.stripHead = 0;
      this.stripSpectral =
        kind === 'spectral' ? new Float32Array(SPECTRAL_BINS * stripWidth) : null;
      this.stripDisplay = kind === 'spectral' ? new Float32Array(SPECTRAL_BINS * stripWidth) : null;
      this.stripMmode = kind === 'm-mode' ? new Uint8ClampedArray(lineSamples * stripWidth) : null;
      this.stripCmm = cmm ? new Float32Array(spec.samples * stripWidth).fill(NaN) : null;
      this.timeline.reset();
      this.stripSampleTime = new Float64Array(stripWidth);
      this.stripBeatIndex = new Uint32Array(stripWidth);
      this.stripTablesVersion = new Uint32Array(stripWidth);
      this.stripPhase = new Float32Array(stripWidth);
      this.stripSpan = new Uint16Array(stripWidth);
      this.stripRgba = null;
      this.stripRgbaKey = '';
      this.mmodeSamples = lineSamples;
    }
    const times = this.timeline.advance(ctx.timeS, dt, cps);
    const rr = ctx.rrS;
    const phaseNow = ctx.phaseNow;
    if (kind === 'm-mode') {
      this.advanceMmode(times, cps, rr, phaseNow, traceBudgetMs, beam, spec, ctx);
      return;
    }
    for (const timeS of times) {
      const moment = ctx.moment(timeS);
      const phase = moment.phase;
      const col = this.stripHead % this.stripCols;
      const signal = this.sampleSpectralColumn(beam, spec, phase, col, timeS, {
        ...ctx,
        heart: moment.scene.heart,
        tables: moment.tables,
        flow: moment.flow,
        scene: () => moment.scene,
      });
      this.stripSpectral!.set(signal.column, col * SPECTRAL_BINS);
      this.stripDisplay!.set(signal.display, col * SPECTRAL_BINS);
      this.lastColumn = signal.column;
      this.stripPhase[col] = phase;
      this.stripSampleTime[col] = timeS;
      this.stripBeatIndex[col] = moment.beatIndex;
      this.stripTablesVersion[col] = moment.tablesVersion;
      this.headTimeS = timeS;
      this.stripHead++;
    }
  }

  /**
   * M-mode columns of this step (decision 84): every column that is due is drawn at its own instant. Lines are traced per
   * phase bin for this probe pose, cursor and imaging settings, as many as the step's budget allows; a column is formed
   * from the traced lines on each side of its instant.
   */
  private advanceMmode(
    times: readonly number[],
    cps: number,
    rr: number,
    phaseNow: number,
    traceBudgetMs: number,
    beam: BeamFrame,
    spec: PolarFrameSpec,
    ctx: StripCtx,
  ): void {
    const n = times.length;
    if (n <= 0) return;
    const inp = ctx.input;
    const theta = Math.max(-spec.sectorRad / 2, Math.min(spec.sectorRad / 2, inp.cursorThetaRad));
    const cmm = inp.modality === 'cmm';
    const bins = mmodePhaseBins(cps, ctx.tables.rrS);
    const ph = ctx.physics();
    const v3 = (v: { x: number; y: number; z: number }): string =>
      `${v.x.toFixed(6)},${v.y.toFixed(6)},${v.z.toFixed(6)}`;
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
      ctx.modelVersion,
      ctx.tablesVersion,
    ].join('|');
    if (this.mmode.key !== key || this.mmode.bins !== bins) this.mmode.reset(key, bins);
    const phases = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const tBack = ctx.timeS - times[i]!;
      phases[i] = (((phaseNow - tBack / rr) % 1) + 1) % 1;
    }
    const maxTraces =
      this.mmode.traceMs > 0 ? Math.max(1, Math.floor(traceBudgetMs / this.mmode.traceMs)) : 1;
    for (const b of binsToTrace(this.mmode, phases, maxTraces)) {
      const t0 = performance.now();
      this.mmode.set(b, this.traceMmodeLine(beam, spec, b, theta, cmm, ctx));
      this.mmode.measure(performance.now() - t0);
    }
    const pulses = mmodePulsesPerColumn(cps);
    for (let i = 0; i < n; i++) {
      const src =
        columnSource(this.mmode, phases[i]!, bins >> 2) ??
        columnSource(this.mmode, phases[i]!, bins >> 1);
      if (src)
        this.writeMmodeColumn(this.stripHead % this.stripCols, src, phases[i]!, pulses, spec, ctx);
      this.headTimeS = times[i]!;
      this.stripHead++;
    }
  }

  /** Trace the M-mode line at `phase`: the fine line envelope and, in colour M-mode, the axial flow velocity on the frame samples. */
  private traceMmodeLine(
    beam: BeamFrame,
    spec: PolarFrameSpec,
    bin: number,
    theta: number,
    cmm: boolean,
    ctx: StripCtx,
  ): MmodeLine {
    const phase = bin / this.mmode.bins;
    const S = this.mmodeSamples;
    if (this.lineAmp.length !== S) {
      this.lineAmp = new Float32Array(S);
      this.lineSt = new Uint8Array(S);
      this.lineTr = new Float32Array(S);
      this.lineTi = new Uint8Array(S);
    }
    const scene = ctx.scene(phase);
    ctx.procedural.renderMmodeLine(
      scene,
      beam,
      spec,
      S,
      theta,
      bin,
      this.lineAmp,
      this.lineSt,
      this.lineTr,
      this.lineTi,
    );
    return {
      amp: this.lineAmp.slice(),
      velocity: cmm ? this.cmmVelocity(beam, spec, phase, theta, scene, ctx) : null,
    };
  }

  /** Colour M-mode: axial flow velocity (m/s, + toward the transducer) on the frame samples of the traced line, NaN where no flow. */
  private cmmVelocity(
    beam: BeamFrame,
    spec: PolarFrameSpec,
    phase: number,
    theta: number,
    scene: Scene,
    ctx: StripCtx,
  ): Float32Array {
    const hf = ctx.heart.frame;
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
      const hx =
        (px - hf.origin.x) * hf.ex.x + (py - hf.origin.y) * hf.ex.y + (pz - hf.origin.z) * hf.ex.z;
      const hy =
        (px - hf.origin.x) * hf.ey.x + (py - hf.origin.y) * hf.ey.y + (pz - hf.origin.z) * hf.ey.z;
      const hz =
        (px - hf.origin.x) * hf.ez.x + (py - hf.origin.y) * hf.ez.y + (pz - hf.origin.z) * hf.ez.z;
      sampleFlow(ctx.flow, ctx.tables, scene.heartPose, phase, hx, hy, hz, fs);
      out[si] = fs.present ? -(fs.vx * dhx + fs.vy * dhy + fs.vz * dhz) : NaN;
    }
    return out;
  }

  /** Form an M-mode column from its traced lines, pass it through the console (its pulses average the receiver noise) and store it. */
  private writeMmodeColumn(
    col: number,
    src: ColumnSource,
    phase: number,
    pulses: number,
    spec: PolarFrameSpec,
    ctx: StripCtx,
  ): void {
    const inp = ctx.input;
    const S = this.mmodeSamples;
    if (this.mmodeColumn.length !== S) {
      this.mmodeColumn = new Float32Array(S);
      this.mmodeGrey = new Uint8ClampedArray(S);
    }
    if (
      !this.mmodeFrame ||
      this.mmodeFrame.spec.samples !== S ||
      this.mmodeFrame.spec.depthCm !== spec.depthCm
    ) {
      this.mmodeFrame = {
        spec: { ...spec, lines: 1, samples: S },
        amplitude: this.mmodeColumn,
        structure: new Uint8Array(S),
        transmission: new Float32Array(S),
        tissue: new Uint8Array(S),
        segment: new Uint8Array(S),
      };
    }
    const a = src.lo.amp,
      b = src.hi.amp,
      t = src.t;
    const column = this.mmodeColumn;
    for (let s = 0; s < S; s++) column[s] = a[s]! + (b[s]! - a[s]!) * t;
    const st = this.mmodeConsole;
    st.seed = (ctx.caseDef.seed + this.stripHead) | 0; // receiver noise is new in every column and every sweep
    st.frameIndex = 0;
    st.prev = null;
    applyConsole(this.mmodeFrame, inp.settings, st, this.mmodeGrey, NO_ARTIFACTS, {
      noisePulses: pulses,
      edgeStep: S / spec.samples,
    });
    const cols = this.stripCols;
    const strip = this.stripMmode!;
    const grey = this.mmodeGrey;
    for (let s = 0; s < S; s++) strip[s * cols + col] = grey[s]!;
    if (this.stripCmm) {
      const v = (t < 0.5 ? src.lo : src.hi).velocity;
      const cmm = this.stripCmm;
      for (let si = 0; si < spec.samples; si++) {
        const x = v ? v[si]! : NaN;
        cmm[si * cols + col] =
          Number.isNaN(x) || Math.abs(x) < inp.color.wallFilterMps
            ? NaN
            : aliasVelocity(x, inp.color.scaleMps, inp.color.baselineShiftMps);
      }
    }
    this.stripPhase[col] = phase;
    this.stripSpan[col] = Math.min(65535, src.span);
    if (this.stripRgba) this.paintStripColumn(col);
  }

  private sampleSpectralColumn(
    beam: BeamFrame,
    spec: PolarFrameSpec,
    phase: number,
    col: number,
    timeS: number,
    ctx: StripCtx,
  ): { column: Float32Array; display: Float32Array } {
    const inp = ctx.input;
    const hf = ctx.heart.frame;
    const theta = Math.max(-spec.sectorRad / 2, Math.min(spec.sectorRad / 2, inp.cursorThetaRad));
    const ct = Math.cos(theta),
      sn = Math.sin(theta);
    const dx = beam.forward.x * ct + beam.lateral.x * sn;
    const dy = beam.forward.y * ct + beam.lateral.y * sn;
    const dz = beam.forward.z * ct + beam.lateral.z * sn;
    const dhx = dx * hf.ex.x + dy * hf.ex.y + dz * hf.ex.z;
    const dhy = dx * hf.ey.x + dy * hf.ey.y + dz * hf.ey.z;
    const dhz = dx * hf.ez.x + dy * hf.ez.y + dz * hf.ez.z;
    const scene = ctx.scene(phase);
    const hp = scene.heartPose;
    const classifyScene = sceneClassifier(scene);
    const accessible = acousticAccess(scene, beam.origin, { x: dx, y: dy, z: dz }, beam.contact);
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
      const hx =
        (px - hf.origin.x) * hf.ex.x + (py - hf.origin.y) * hf.ex.y + (pz - hf.origin.z) * hf.ex.z;
      const hy =
        (px - hf.origin.x) * hf.ey.x + (py - hf.origin.y) * hf.ey.y + (pz - hf.origin.z) * hf.ey.z;
      const hz =
        (px - hf.origin.x) * hf.ez.x + (py - hf.origin.y) * hf.ez.y + (pz - hf.origin.z) * hf.ez.z;
      const inScene = classifyScene(px, py, pz, ts) !== 0;
      if (inp.modality === 'tdi') {
        if (inScene && ts.tissue === Tissue.Myocardium) {
          if (!accessible(r)) return;
          const tv = sampleTissueVelocity(ctx.heart, ctx.tables, phase, hx, hy, hz, ts.structure);
          const axial = tv.vx * dhx + tv.vy * dhy + tv.vz * dhz;
          const vPerp = Math.sqrt(
            Math.max(0, tv.vx * tv.vx + tv.vy * tv.vy + tv.vz * tv.vz - axial * axial),
          );
          samples.push({ v: -axial, weight: 1, dispersion: 0.05, vPerp, depthCm: r });
        }
        return;
      }
      if (!inScene || ts.tissue !== Tissue.Blood) return;
      if (!accessible(r)) return;
      sampleFlow(ctx.flow, ctx.tables, hp, phase, hx, hy, hz, fs);
      if (!fs.present) {
        samples.push({ v: 0, weight: 0.3, dispersion: 0.05 });
        return;
      }
      const axial = fs.vx * dhx + fs.vy * dhy + fs.vz * dhz;
      const vPerp = Math.sqrt(
        Math.max(0, fs.vx * fs.vx + fs.vy * fs.vy + fs.vz * fs.vz - axial * axial),
      );
      samples.push({ v: -axial, weight: 1, dispersion: fs.dispersion, vPerp, depthCm: r });
    };
    const aliasing = MODALITIES[inp.modality].aliasing;
    // heart-frame points where the sample volume can meet a valve's leaflets: along the CW line, or the PW gate
    const clickPoints: number[] = [];
    const clickPoint = (r: number): void => {
      const px = beam.origin.x + dx * r,
        py = beam.origin.y + dy * r,
        pz = beam.origin.z + dz * r;
      const point = [
        (px - hf.origin.x) * hf.ex.x + (py - hf.origin.y) * hf.ex.y + (pz - hf.origin.z) * hf.ex.z,
        (px - hf.origin.x) * hf.ey.x + (py - hf.origin.y) * hf.ey.y + (pz - hf.origin.z) * hf.ey.z,
        (px - hf.origin.x) * hf.ez.x + (py - hf.origin.y) * hf.ez.y + (pz - hf.origin.z) * hf.ez.z,
      ];
      // Most instants have no valve click: trace only a source that could contribute to the column.
      if (
        valveClickWeight(ctx.heart, hp, ctx.tables, phase * ctx.tables.rrS, point) === 0 ||
        !accessible(r)
      )
        return;
      clickPoints.push(...point);
    };
    if (inp.modality === 'cw') {
      for (let r = 1.0; r < spec.depthCm; r += 0.25) {
        if (!accessible(r)) break;
        classify(r, 0, 0);
        clickPoint(r);
      }
    } else {
      const g = inp.spectral.gateLengthCm;
      if (inp.modality === 'pw')
        for (const k of [-0.5, 0, 0.5]) clickPoint(inp.gateDepthCm + k * g);
      const rng = createRng(ctx.caseDef.seed ^ (col * 7919));
      for (let i = 0; i < 20; i++) {
        const r = inp.gateDepthCm + (rng.next() - 0.5) * g;
        classify(r, (rng.next() - 0.5) * 0.35, (rng.next() - 0.5) * 0.35);
      }
    }
    const column = new Float32Array(SPECTRAL_BINS);
    const display = new Float32Array(SPECTRAL_BINS);
    const click = clickPoints.length
      ? valveClickWeight(ctx.heart, hp, ctx.tables, phase * ctx.tables.rrS, clickPoints)
      : 0;
    if (aliasing) {
      accumulatePulsedSpectrum(
        samples,
        inp.spectral,
        inp.settings.frequencyMHz,
        ctx.caseDef.seed,
        timeS,
        column,
      );
      presentSpectralColumn(
        column,
        inp.spectral,
        this.stripHead,
        ctx.caseDef.seed,
        inp.settings.frequencyMHz,
        1 - DUPLEX_BMODE_SHARE,
        click,
        display,
        timeS,
        false,
      );
    } else
      buildSpectralColumn(
        samples,
        inp.spectral,
        this.stripHead,
        ctx.caseDef.seed,
        aliasing,
        column,
        inp.settings.frequencyMHz,
        1 - DUPLEX_BMODE_SHARE,
        click,
        display,
        timeS,
      );
    return { column, display };
  }

  /** Structures at the Doppler/M-mode cursor and the beam–flow angle at the PW/TDI gate (technique checks). */
  gateInfo(
    beam: BeamFrame,
    spec: PolarFrameSpec,
    phase: number,
    structure: Uint8Array,
    ctx: StripCtx,
  ): GateInfo {
    const inp = ctx.input;
    const theta = Math.max(-spec.sectorRad / 2, Math.min(spec.sectorRad / 2, inp.cursorThetaRad));
    const li = Math.min(
      spec.lines - 1,
      Math.max(0, Math.round(((theta + spec.sectorRad / 2) / spec.sectorRad) * spec.lines - 0.5)),
    );
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
    const hf = ctx.heart.frame;
    const hx =
      (px - hf.origin.x) * hf.ex.x + (py - hf.origin.y) * hf.ex.y + (pz - hf.origin.z) * hf.ex.z;
    const hy =
      (px - hf.origin.x) * hf.ey.x + (py - hf.origin.y) * hf.ey.y + (pz - hf.origin.z) * hf.ey.z;
    const hz =
      (px - hf.origin.x) * hf.ez.x + (py - hf.origin.y) * hf.ez.y + (pz - hf.origin.z) * hf.ez.z;
    const ts = this.tissueSample;
    const inScene = sceneClassifier(ctx.scene(phase))(px, py, pz, ts) !== 0;
    let flowPresent = false;
    let flowAngleDeg: number | null = null;
    if (inScene && ts.tissue === Tissue.Blood) {
      // flow direction at the gate over the cycle: use the instant of maximal speed so the angle does not depend on the frame.
      // It depends only on where the gate sits in the heart, so it is kept until the gate or the models change: sixteen
      // heart poses per composite were most of the cost of every strip frame.
      const gateKey = `${hx.toFixed(5)},${hy.toFixed(5)},${hz.toFixed(5)}|${ctx.modelVersion}|${ctx.tablesVersion}`;
      if (this.gateFlow.key !== gateKey) {
        let best = 0;
        let bx = 0,
          by = 0,
          bz = 0;
        const fs = this.flowSample;
        for (let k = 0; k < 16; k++) {
          const ph = k / 16;
          sampleFlow(
            ctx.flow,
            ctx.tables,
            computeHeartPose(ctx.heart, cycleStateAt(ctx.tables, ph)),
            ph,
            hx,
            hy,
            hz,
            fs,
          );
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
    } else if (inScene && ts.tissue === Tissue.Myocardium && inp.modality === 'tdi') {
      flowPresent = true;
      // tissue moves along the LV long axis: angle between the beam and the heart z axis
      const dhz = dx * hf.ez.x + dy * hf.ez.y + dz * hf.ez.z;
      flowAngleDeg = (Math.acos(Math.min(1, Math.abs(dhz))) * 180) / Math.PI;
    }
    return {
      thetaRad: theta,
      depthCm: r,
      structure: inScene ? ts.structure : 0,
      tissue: inScene ? ts.tissue : 0,
      flowPresent,
      flowAngleDeg,
      lineStructures,
    };
  }

  /** Answer an on-demand request (auto-trace of the spectral envelope between two strip columns). */
  request(req: SimRequest): SimResponse | null {
    if (req.kind === 'autoTrace') {
      const strip = this.stripSpectral;
      if (!strip || this.stripKind !== 'spectral' || !this.acquired) return null;
      const spectral = this.acquired.spectral;
      const { vMin, vMax } = spectralRange(spectral);
      const cols = this.stripCols;
      const pixelsPerColumn = (this.displayCols || cols) / cols;
      const secondsShown = STRIP_MM_WIDTH / spectral.sweepSpeedMmPerS;
      const spc = cols ? secondsShown / cols : 0;
      const x0 = Math.max(
        0,
        Math.min(cols - 1, Math.floor(Math.min(req.x0, req.x1) / pixelsPerColumn)),
      );
      const x1 = Math.max(
        0,
        Math.min(cols - 1, Math.floor(Math.max(req.x0, req.x1) / pixelsPerColumn)),
      );
      const baselineBin = (vMax / (vMax - vMin)) * SPECTRAL_BINS;
      /** Outer edge (m/s) of the envelope of column x on one side of the baseline; 0 without signal there. */
      const edgeOn = (x: number, above: boolean): number => {
        let max = 0;
        for (let b = 0; b < SPECTRAL_BINS; b++)
          max = Math.max(max, strip[x * SPECTRAL_BINS + b] ?? 0);
        const thr = envelopeThreshold(max, spectral);
        // walk outward from the brightest bin of that side through the contiguous signal (gaps ≤ 2 bins), so that isolated
        // noise far from it does not pull the envelope to the top of the scale. It used to start at the baseline and stop at
        // the gap the wall filter leaves under a narrow laminar spectrum (decision 96).
        let edgeBin = baselineBin;
        if (above) {
          let peak = -1;
          for (let b = Math.floor(baselineBin) - 1, best = thr; b >= 0; b--)
            if ((strip[x * SPECTRAL_BINS + b] ?? 0) > best)
              best = strip[x * SPECTRAL_BINS + (peak = b)]!;
          let gap = 0;
          for (let b = peak; peak >= 0 && b >= 0; b--) {
            if ((strip[x * SPECTRAL_BINS + b] ?? 0) > thr) {
              edgeBin = b;
              gap = 0;
            } else if (++gap > 2) break;
          }
        } else {
          let peak = -1;
          for (let b = Math.ceil(baselineBin), best = thr; b < SPECTRAL_BINS; b++)
            if ((strip[x * SPECTRAL_BINS + b] ?? 0) > best)
              best = strip[x * SPECTRAL_BINS + (peak = b)]!;
          let gap = 0;
          for (let b = peak; peak >= 0 && b < SPECTRAL_BINS; b++) {
            if ((strip[x * SPECTRAL_BINS + b] ?? 0) > thr) {
              edgeBin = b + 1;
              gap = 0;
            } else if (++gap > 2) break;
          }
        }
        const v = vMax - (edgeBin / SPECTRAL_BINS) * (vMax - vMin);
        // an edge inside the band the wall filter removes, one bin beyond it, is not a flow (decision 232)
        return Math.abs(v) <= spectral.wallFilterMps + (vMax - vMin) / SPECTRAL_BINS ? 0 : v;
      };
      // valve clicks have no envelope: across a click the trace joins the columns on either side (decision 103), as a
      // sonographer ignores the line; the VTI would otherwise add a spike to the top of the scale at each one
      const core = Array.from({ length: x1 - x0 + 1 }, (_, i) =>
        isClickColumn(
          strip.subarray((x0 + i) * SPECTRAL_BINS, (x0 + i + 1) * SPECTRAL_BINS),
          spectral,
        ),
      );
      // the click's tails, too faint to fill the scale, still lift the envelope: bridge 2.5 click widths on each side
      const reach = Math.ceil((2.5 * CLICK_SIGMA_S) / Math.max(1e-6, spc));
      const click = core.map((_, i) =>
        core.slice(Math.max(0, i - reach), i + reach + 1).some(Boolean),
      );
      // one side for the whole selection, the side that holds more flow outside the valve clicks (decision 232): picked
      // column by column, the trace of a beat across a stenotic jet added the mitral inflow of diastole to the jet of
      // systole; picked by the single fastest column, a click tail left beyond the bridge (one column of −2.44 m/s before
      // the mitral opening of the severe stenosis) took a whole filling to the other side
      const up: number[] = [],
        down: number[] = [];
      for (let x = x0; x <= x1; x++) {
        up.push(edgeOn(x, true));
        down.push(edgeOn(x, false));
      }
      // a column that stands above both of its neighbours by more than SPIKE_MPS is a line, not a flow: the part of a
      // valve click that fell between two columns and is too faint to be found as one (the mitral opening of the severe
      // stenosis, 2 ms wide, between columns 6.3 ms apart, read 2.44 m/s on one side and 1.59 on the other among zeros)
      for (const side of [up, down])
        for (let i = 0; i < side.length; i++) {
          const prev = i > 0 ? side[i - 1]! : side[i + 1];
          const next = i < side.length - 1 ? side[i + 1]! : prev;
          if (prev === undefined || next === undefined) continue;
          if (Math.abs(side[i]!) - Math.max(Math.abs(prev), Math.abs(next)) > SPIKE_MPS)
            side[i] = (prev + next) / 2;
        }
      let flowUp = 0,
        flowDown = 0;
      for (let i = 0; i < up.length; i++) {
        if (click[i]) continue;
        flowUp += up[i]!;
        flowDown -= down[i]!;
      }
      const velocitiesMps = flowUp >= flowDown ? up : down;
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
      // Measure on the original samples; resizing must not duplicate spikes, smooth peaks or change VTI.
      return {
        kind: 'autoTrace',
        velocitiesMps,
        secondsPerColumn: spc,
        x0: x0 * pixelsPerColumn,
        pixelsPerColumn,
      };
    }
    return null;
  }

  drawStrip(rgba: Uint8ClampedArray, W: number, H: number, sectorH: number): StripInfo {
    const acquired = this.acquired;
    this.displayCols = W;
    const y0 = sectorH + 2;
    const h = H - y0 - 4;
    const cols = this.stripCols;
    const secondsShown = STRIP_MM_WIDTH / (this.acquired?.spectral.sweepSpeedMmPerS ?? 50);
    const spc = cols ? secondsShown / W : 0;
    const kind = this.stripKind;
    const head = Math.floor(((this.stripHead % Math.max(1, cols)) / Math.max(1, cols)) * W);
    if (kind === 'm-mode' && this.stripMmode && acquired && h > 0) {
      // the strip image is kept between frames and repainted column by column as columns are written (decision 84)
      const layout = `${cols}x${h}|${this.mmodeSamples}`;
      if (this.stripRgbaKey !== layout || !this.stripRgba) {
        this.stripRgba = new Uint8ClampedArray(cols * h * 4);
        this.rowMap = buildRowMap(h, this.mmodeSamples);
        this.stripRgbaKey = layout;
        for (let c = 0; c < cols; c++) this.paintStripColumn(c);
      }
      if (cols === W) rgba.set(this.stripRgba, y0 * W * 4);
      else {
        // Resize presentation only: retain the acquired time span and depth samples.
        for (let y = 0; y < h; y++)
          for (let x = 0; x < W; x++) {
            const src = (y * cols + Math.floor((x * cols) / W)) * 4;
            const dst = ((y0 + y) * W + x) * 4;
            for (let c = 0; c < 4; c++) rgba[dst + c] = this.stripRgba[src + c]!;
          }
      }
      this.drawSweepMarker(rgba, W, y0, h, head);
      return {
        x: 0,
        y: y0,
        width: W,
        height: h,
        secondsPerColumn: spc,
        acquisitionId: this.acquisitionId,
        headTimeS: this.headTimeS,
        headColumn: head,
        columns: W,
        sweepSpeedMmPerS: acquired.spectral.sweepSpeedMmPerS,
        topValue: 0,
        bottomValue: acquired.depthCm,
        kind: 'm-mode',
      };
    }
    if (kind === 'spectral' && this.stripDisplay && acquired) {
      const { vMin, vMax } = spectralRange(acquired.spectral);
      for (let y = 0; y < h; y++) {
        const b = Math.min(SPECTRAL_BINS - 1, Math.floor((y / h) * SPECTRAL_BINS));
        for (let x = 0; x < W; x++) {
          const col = Math.min(cols - 1, Math.floor((x * cols) / W));
          const v = this.stripDisplay[col * SPECTRAL_BINS + b] ?? 0;
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
      return {
        x: 0,
        y: y0,
        width: W,
        height: h,
        secondsPerColumn: spc,
        acquisitionId: this.acquisitionId,
        headTimeS: this.headTimeS,
        headColumn: head,
        columns: W,
        sweepSpeedMmPerS: acquired.spectral.sweepSpeedMmPerS,
        wallFilterMps: acquired.spectral.wallFilterMps,
        frequencyMHz: acquired.frequencyMHz,
        estimatorIntervalS: secondsShown / cols,
        topValue: vMax,
        bottomValue: vMin,
        kind: 'spectral',
      };
    }
    return {
      x: 0,
      y: y0,
      width: W,
      height: h,
      secondsPerColumn: spc,
      headColumn: 0,
      columns: 0,
      topValue: 0,
      bottomValue: 0,
      kind: null,
    };
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
    if (cmm && this.acquired) {
      const color = this.acquired.color;
      const F = cmm.length / cols;
      const rgb: [number, number, number] = [0, 0, 0];
      for (let y = 0; y < rows; y++) {
        const v = cmm[Math.min(F - 1, Math.floor((y / rows) * F)) * cols + col]!;
        if (Number.isNaN(v)) continue;
        colorMap(color.invert ? -v : v, color.scaleMps, 0, false, rgb);
        const o = (y * cols + col) * 4;
        img[o] = rgb[0];
        img[o + 1] = rgb[1];
        img[o + 2] = rgb[2];
      }
    }
  }

  private drawSweepMarker(
    rgba: Uint8ClampedArray,
    W: number,
    y0: number,
    h: number,
    head: number,
  ): void {
    const x = Math.min(W - 1, head);
    for (let y = 0; y < h; y++) {
      const o = ((y0 + y) * W + x) * 4;
      rgba[o] = 120;
      rgba[o + 1] = 200;
      rgba[o + 2] = 120;
    }
  }
}
