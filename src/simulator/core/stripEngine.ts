import type { CaseDefinition } from '@/cases/schema';
import { classifyHeart, computeHeartPose, type HeartModel } from '@/simulator/anatomy/heartModel';
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
import {
  colorMap,
  DOPPLER_SHADOW_TRANSMISSION,
  relativeTransmission,
} from '@/simulator/doppler/color/colorDoppler';
import { aliasVelocity } from '@/clinical/formulas';
import { MODALITIES } from '@/simulator/renderer/modality';
import {
  buildSpectralColumn,
  CLICK_SIGMA_S,
  envelopeThreshold,
  isClickColumn,
  SPECTRAL_BINS,
  spectralRange,
  type VelocitySample,
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
  /** Latest polar frame (CW lines stop at shadows on it). */
  frame: PolarFrame | null;
  procedural: ProceduralSliceRenderer;
  scene(phase: number): Scene;
  physics(): ScenePhysics;
}

/**
 * The strip machinery of the simulator: spectral (PW/CW/TDI) and M-mode/colour-M-mode columns, their displayed
 * image and the gate/auto-trace read-outs over them. Columns are written at their own instants (decision 115);
 * M-mode columns are formed from lines traced per phase bin (decision 84).
 */
export class StripEngine {
  private stripSpectral: Float32Array | null = null;
  /** What the screen shows of the spectral strip (decision 115): the estimate with its grain; the envelope reads `stripSpectral`. */
  private stripDisplay: Float32Array | null = null;
  /** colour M-mode: aliased axial velocity per (sample, column), NaN where no flow */
  private stripCmm: Float32Array | null = null;
  private stripMmode: Uint8ClampedArray | null = null;
  private stripCols = 0;
  private stripHead = 0;
  private stripAccum = 0;
  private lastColumn: Float32Array | null = null;
  private stripKind: 'spectral' | 'm-mode' | null = null;
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

  /** Reset on a modality change: the next step starts a fresh strip of the new kind. */
  reset(): void {
    this.stripHead = 0;
    this.stripAccum = 0;
    this.stripKind = null;
    this.lastColumn = null;
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
  } {
    return {
      data: this.stripSpectral,
      display: this.stripDisplay,
      cols: this.stripCols,
      head: this.stripHead,
      phase: this.stripPhase,
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
      this.stripKind = kind;
      this.stripCols = stripWidth;
      this.stripHead = 0;
      this.stripSpectral =
        kind === 'spectral' ? new Float32Array(SPECTRAL_BINS * stripWidth) : null;
      this.stripDisplay = kind === 'spectral' ? new Float32Array(SPECTRAL_BINS * stripWidth) : null;
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
    const rr = ctx.rrS;
    const phaseNow = ctx.phaseNow;
    if (kind === 'm-mode') {
      this.advanceMmode(n, cps, rr, phaseNow, traceBudgetMs, beam, spec, ctx);
      return;
    }
    for (let k = n - 1; k >= 0; k--) {
      const tBack = (k + 0.5) / cps;
      const phase = (((phaseNow - tBack / rr) % 1) + 1) % 1;
      const col = this.stripHead % this.stripCols;
      // each column at its own instant: the grain of the estimate lasts its duration, not the step (decision 115)
      this.sampleSpectralColumn(beam, spec, phase, col, ctx.timeS - tBack, ctx);
      this.stripPhase[col] = phase;
      this.stripHead++;
    }
  }

  /**
   * M-mode columns of this step (decision 84): every column that is due is drawn at its own instant. Lines are traced per
   * phase bin for this probe pose, cursor and imaging settings, as many as the step's budget allows; a column is formed
   * from the traced lines on each side of its instant.
   */
  private advanceMmode(
    n: number,
    cps: number,
    rr: number,
    phaseNow: number,
    traceBudgetMs: number,
    beam: BeamFrame,
    spec: PolarFrameSpec,
    ctx: StripCtx,
  ): void {
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
      const tBack = (n - 1 - i + 0.5) / cps;
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
    if (this.stripRgba) this.paintStripColumn(col, ctx);
  }

  private sampleSpectralColumn(
    beam: BeamFrame,
    spec: PolarFrameSpec,
    phase: number,
    col: number,
    timeS: number,
    ctx: StripCtx,
  ): void {
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
    const hp = computeHeartPose(ctx.heart, cycleStateAt(ctx.tables, phase));
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
      const inHeart = classifyHeart(ctx.heart, hp, hx, hy, hz, ts);
      if (inp.modality === 'tdi') {
        if (inHeart && ts.tissue === Tissue.Myocardium) {
          const tv = sampleTissueVelocity(ctx.heart, ctx.tables, phase, hx, hy, hz, ts.structure);
          const axial = tv.vx * dhx + tv.vy * dhy + tv.vz * dhz;
          const vPerp = Math.sqrt(
            Math.max(0, tv.vx * tv.vx + tv.vy * tv.vy + tv.vz * tv.vz - axial * axial),
          );
          samples.push({ v: -axial, weight: 1, dispersion: 0.05, vPerp, depthCm: r });
        }
        return;
      }
      if (!inHeart || ts.tissue !== Tissue.Blood) return;
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
      clickPoints.push(
        (px - hf.origin.x) * hf.ex.x + (py - hf.origin.y) * hf.ex.y + (pz - hf.origin.z) * hf.ex.z,
        (px - hf.origin.x) * hf.ey.x + (py - hf.origin.y) * hf.ey.y + (pz - hf.origin.z) * hf.ey.z,
        (px - hf.origin.x) * hf.ez.x + (py - hf.origin.y) * hf.ez.y + (pz - hf.origin.z) * hf.ez.z,
      );
    };
    if (inp.modality === 'cw') {
      const frame = ctx.frame;
      const li = frame
        ? Math.min(
            spec.lines - 1,
            Math.max(0, Math.round(((theta + spec.sectorRad / 2) / spec.sectorRad) * spec.lines)),
          )
        : 0;
      const acquisition = {
        frequencyMHz: inp.settings.frequencyMHz,
        harmonics: inp.settings.harmonics,
      };
      for (let r = 1.0; r < spec.depthCm; r += 0.25) {
        if (frame) {
          // a shadow stops the line, depth does not (decision 96): an absolute 2% cut stopped lines from the apical window
          // at 9–12 cm, before the jet of a stenotic aortic valve
          const si = Math.min(spec.samples - 1, Math.floor((r / spec.depthCm) * spec.samples));
          if (
            relativeTransmission(frame.transmission[li * spec.samples + si] ?? 1, r, acquisition) <
            DOPPLER_SHADOW_TRANSMISSION
          )
            break;
        }
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
    buildSpectralColumn(
      samples,
      inp.spectral,
      this.stripHead,
      ctx.caseDef.seed,
      aliasing,
      column,
      click,
      display,
      timeS,
    );
    this.stripSpectral!.set(column, col * SPECTRAL_BINS);
    this.stripDisplay!.set(display, col * SPECTRAL_BINS);
    this.lastColumn = column;
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
    const hp = computeHeartPose(ctx.heart, cycleStateAt(ctx.tables, phase));
    const ts = this.tissueSample;
    const inHeart = classifyHeart(ctx.heart, hp, hx, hy, hz, ts);
    let flowPresent = false;
    let flowAngleDeg: number | null = null;
    if (inHeart && ts.tissue === Tissue.Blood) {
      // flow direction at the gate over the cycle: use the instant of maximal speed so the angle does not depend on the frame.
      // It depends only on where the gate sits in the heart, so it is kept until the gate or the models change: sixteen
      // heart poses per composite were most of the cost of every strip frame.
      const gateKey = `${hx.toFixed(5)},${hy.toFixed(5)},${hz.toFixed(5)}|${ctx.modelVersion}`;
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
    } else if (inHeart && ts.tissue === Tissue.Myocardium && inp.modality === 'tdi') {
      flowPresent = true;
      // tissue moves along the LV long axis: angle between the beam and the heart z axis
      const dhz = dx * hf.ez.x + dy * hf.ez.y + dz * hf.ez.z;
      flowAngleDeg = (Math.acos(Math.min(1, Math.abs(dhz))) * 180) / Math.PI;
    }
    return {
      thetaRad: theta,
      depthCm: r,
      structure: inHeart ? ts.structure : 0,
      tissue: inHeart ? ts.tissue : 0,
      flowPresent,
      flowAngleDeg,
      lineStructures,
    };
  }

  /** Answer an on-demand request (auto-trace of the spectral envelope between two strip columns). */
  request(req: SimRequest, ctx: StripCtx): SimResponse | null {
    if (req.kind === 'autoTrace') {
      const strip = this.stripSpectral;
      if (!strip || this.stripKind !== 'spectral') return null;
      const { vMin, vMax } = spectralRange(ctx.input.spectral);
      const cols = this.stripCols;
      const secondsShown = STRIP_MM_WIDTH / ctx.input.spectral.sweepSpeedMmPerS;
      const spc = cols ? secondsShown / cols : 0;
      const x0 = Math.max(0, Math.min(cols - 1, Math.round(Math.min(req.x0, req.x1))));
      const x1 = Math.max(0, Math.min(cols - 1, Math.round(Math.max(req.x0, req.x1))));
      const baselineBin = (vMax / (vMax - vMin)) * SPECTRAL_BINS;
      const velocitiesMps: number[] = [];
      for (let x = x0; x <= x1; x++) {
        let max = 0;
        for (let b = 0; b < SPECTRAL_BINS; b++)
          max = Math.max(max, strip[x * SPECTRAL_BINS + b] ?? 0);
        const thr = envelopeThreshold(max, ctx.input.spectral);
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
        velocitiesMps.push(vMax - (edgeBin / SPECTRAL_BINS) * (vMax - vMin));
      }
      // valve clicks have no envelope: across a click the trace joins the columns on either side (decision 103), as a
      // sonographer ignores the line; the VTI would otherwise add a spike to the top of the scale at each one
      const core = velocitiesMps.map((_, i) =>
        isClickColumn(
          strip.subarray((x0 + i) * SPECTRAL_BINS, (x0 + i + 1) * SPECTRAL_BINS),
          ctx.input.spectral,
        ),
      );
      // the click's tails, too faint to fill the scale, still lift the envelope: bridge 2.5 click widths on each side
      const reach = Math.ceil((2.5 * CLICK_SIGMA_S) / Math.max(1e-6, spc));
      const click = core.map((_, i) =>
        core.slice(Math.max(0, i - reach), i + reach + 1).some(Boolean),
      );
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

  drawStrip(
    rgba: Uint8ClampedArray,
    W: number,
    H: number,
    sectorH: number,
    spec: PolarFrameSpec,
    ctx: StripCtx,
  ): StripInfo {
    const inp = ctx.input;
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
        for (let c = 0; c < cols; c++) this.paintStripColumn(c, ctx);
      }
      rgba.set(this.stripRgba, y0 * W * 4);
      this.drawSweepMarker(rgba, W, y0, h, head);
      return {
        x: 0,
        y: y0,
        width: W,
        height: h,
        secondsPerColumn: spc,
        topValue: 0,
        bottomValue: spec.depthCm,
        kind: 'm-mode',
      };
    }
    if (kind === 'spectral' && this.stripDisplay) {
      const { vMin, vMax } = spectralRange(inp.spectral);
      for (let y = 0; y < h; y++) {
        const b = Math.min(SPECTRAL_BINS - 1, Math.floor((y / h) * SPECTRAL_BINS));
        for (let x = 0; x < W; x++) {
          const col = x < cols ? x : cols - 1;
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
      topValue: 0,
      bottomValue: 0,
      kind: null,
    };
  }

  /** Paint one column of the displayed M-mode strip: grey rows from the line samples they cover, then the colour M-mode velocities. */
  private paintStripColumn(col: number, ctx: StripCtx): void {
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
      const inp = ctx.input;
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
