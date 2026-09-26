import type { BeamFrame } from '@/simulator/probe/pose';
import type { PolarFrame, PolarFrameSpec, RendererBackend, Scene } from '../types';
import { classifyHeart } from '@/simulator/anatomy/heartModel';
import { classifyThorax, isAnteriorLung } from '@/simulator/anatomy/thoraxModel';
import {
  makeSample,
  TISSUE_PROPS,
  Tissue,
  Structure,
  type TissueSample,
} from '@/simulator/anatomy/tissue';
import { latticeNoise3, noiseLattice } from '@/core/noise';
import { hash3 } from '@/core/random';
import { contactQuality } from '@/simulator/probe/pose';
import {
  buildLineKernels,
  buildPsfKernels,
  formEnvelope,
  formEnvelopeLine,
  LINE_LATTICE_PATH,
  lineKernelKey,
  psfKey,
  sideLobeLevelDb,
  sliceHalfWidthCm,
  type LineKernels,
  type PsfKernels,
} from '../acoustic/psf';
import {
  ATTEN_NP_PER_DB,
  attenuationFrequencyMHz,
  BLOOD_DECORRELATION_CELLS,
  BLOOD_HARMONIC_SIGMA,
  bloodShiftCells,
  CALCIUM_AMP,
  CALCIUM_ATTEN_NP,
  CALCIUM_ATTEN_REF_CM,
  CALCIUM_ATTEN_THRESHOLD,
  CALCIUM_BASE,
  CALCIUM_FREQ,
  CALCIUM_GAIN,
  CALCIUM_OFFSET,
  CLUTTER_AMP,
  CLUTTER_BASE,
  CLUTTER_DECAY_CM,
  CLUTTER_FREQ,
  CLUTTER_IM_A,
  CLUTTER_IM_B,
  CLUTTER_LINE_FREQ,
  CLUTTER_MAX_CM,
  CLUTTER_MOD_DEPTH_FREQ,
  CLUTTER_MOD_FREQ,
  CLUTTER_MOD_LINE_FREQ,
  CLUTTER_RE_A_X,
  CLUTTER_RE_B,
  HETERO_FREQ,
  HETERO_OFFSET,
  heteroDb,
  MYO_ANISO_FLOOR,
  MYO_ANISO_RADIAL_EPS,
  myoHelixGain,
  PHASOR_IM_A,
  PHASOR_IM_B,
  PHASOR_NORM,
  PHASOR_RE_B,
  PLEURA_AMP,
  PLEURA_BASE,
  PLEURA_DEPTH_FREQ,
  PLEURA_LINE_FREQ,
  PLEURA_Z,
  pleuralCoherence,
  pleuralIncidenceCos,
  pleuralReverberation,
  PLEURA_DIFFUSE_FLOOR,
  PLEURA_SLOPE_WINDOW_CM,
  REVERB_MOD_AMP,
  REVERB_MOD_BASE,
  REVERB_MOD_DEPTH_FREQ,
  REVERB_MOD_LINE_FREQ,
  REVERB_MOD_Z,
  REVERB_PHASOR_IM_A,
  REVERB_PHASOR_IM_B,
  REVERB_PHASOR_LINE_FREQ,
  REVERB_PHASOR_RE_A_Z,
  REVERB_PHASOR_RE_B,
  RINGDOWN_CM,
  RINGDOWN_GAIN,
  focusingGain,
  membraneWeight,
  cordAlignment,
  cordWeight,
  beamAttenWindowLines,
  COMPOUND_LOOKS,
  LOOK_SHIFT,
  GRAIN_GAIN,
  GRAIN_THRESHOLD,
  GRAIN_OFFSET,
  SCATTER_FREQ,
  SCATTER_FREQ_RATIO,
  SPECULAR_GAIN,
  SPECULAR_HARMONIC,
  SPECULAR_WINDOW_MIN,
  TRANSMISSION_FLOOR,
  WINDOW_ATTEN_GAIN,
} from '../acoustic/acoustics';

// lattice offsets as scalars: the inner loops read them per sample
const [PRB_X, PRB_Y, PRB_Z] = PHASOR_RE_B;
const [PIA_X, PIA_Y, PIA_Z] = PHASOR_IM_A;
const [PIB_X, PIB_Y, PIB_Z] = PHASOR_IM_B;
const [HET_X, HET_Y, HET_Z] = HETERO_OFFSET;
const [GR_X, GR_Y, GR_Z] = GRAIN_OFFSET;
const [CAL_X, CAL_Y, CAL_Z] = CALCIUM_OFFSET;
const [RRB_X, RRB_Y, RRB_Z] = REVERB_PHASOR_RE_B;
const [RIA_X, RIA_Y, RIA_Z] = REVERB_PHASOR_IM_A;
const [RIB_X, RIB_Y, RIB_Z] = REVERB_PHASOR_IM_B;
const [CRB_X, CRB_Y] = CLUTTER_RE_B;
const [CIA_X, CIA_Y, CIA_Z] = CLUTTER_IM_A;
const [CIB_X, CIB_Y, CIB_Z] = CLUTTER_IM_B;

/**
 * Procedural slice renderer: marches every scanline through the parametric thorax + heart model and forms
 * the image the way a scanner does (decision 52). Per sample it computes the incoherent tissue backscatter σ
 * (tissue reflectivity × myocardial anisotropy × heterogeneity), the coherent specular echo of an interface
 * crossing the sample (∝ |n·d|⁴) and a complex scatterer phasor anchored in tissue coordinates; the complex
 * signal σ·z + specular is multiplied by the two-way frequency-dependent transmission (shadowing), pleural
 * reverberation and near-field clutter are added, and the separable PSF + envelope detection of
 * `acoustic/psf.ts` produces the linear amplitude. No wave propagation, no RF carrier.
 *
 * Output amplitude is linear and *pre-console*: gain/TGC/compression/persistence are applied later
 * so every console control remains causal on this same frame.
 */
export class ProceduralSliceRenderer implements RendererBackend {
  readonly id = 'procedural' as const;
  private sample = makeSample();
  private sample2 = makeSample();
  private lastMs = 0;
  private lastSamples = 0;
  private re = new Float32Array(0);
  private im = new Float32Array(0);
  private tmpRe = new Float32Array(0);
  private tmpIm = new Float32Array(0);
  private tmpAmp = new Float32Array(0);
  /** Attenuation increment of each sample (Np), for the beam-averaged march of a frame (decision 144). */
  private atten = new Float32Array(0);
  private prefix = new Float32Array(0);
  /** Sample of each frame line where it enters lung, −1 where it does not (decision 221). */
  private lungEntry = new Int32Array(0);
  private lineRe = new Float32Array(0);
  private lineIm = new Float32Array(0);
  private lineTmpRe = new Float32Array(0);
  private lineTmpIm = new Float32Array(0);
  private lineSigma = new Float32Array(0);
  private lineAcross = new Float32Array(0);
  private lineElevation = new Float32Array(0);
  private lineAlong = new Float32Array(0);
  private lineGrainScale = new Float32Array(0);
  private lineGrainCells = new Float32Array(0);
  private psf: PsfKernels | null = null;
  private linePsf: LineKernels | null = null;
  private acA = { sigma: 0, spec: 0 };
  private acB = { sigma: 0, spec: 0 };

  stats(): Record<string, number | string> {
    return { renderMs: Number(this.lastMs.toFixed(2)), samplesPerFrame: this.lastSamples };
  }
  dispose(): void {}

  /** PSF kernels for this frame geometry and probe settings (also uploaded by the GPU port). */
  kernels(scene: Scene, spec: PolarFrameSpec): PsfKernels {
    const { frequencyMHz, harmonics } = scene.physics;
    const bw = scene.physics.beamWidth ?? 0;
    const lobes = sideLobeLevelDb(scene.physics.sideLobe);
    if (!this.psf || this.psf.key !== psfKey(spec, frequencyMHz, harmonics, bw, lobes))
      this.psf = buildPsfKernels(spec, frequencyMHz, harmonics, bw, lobes);
    return this.psf;
  }

  render(
    scene: Scene,
    beam: BeamFrame,
    spec: PolarFrameSpec,
    _phase: number,
    out: PolarFrame,
  ): void {
    const t0 = performance.now();
    const n = spec.lines * spec.samples;
    if (this.re.length !== n * COMPOUND_LOOKS) {
      // one complex signal per compounding look (decision 145)
      this.re = new Float32Array(n * COMPOUND_LOOKS);
      this.im = new Float32Array(n * COMPOUND_LOOKS);
      this.tmpRe = new Float32Array(n);
      this.tmpIm = new Float32Array(n);
      this.tmpAmp = new Float32Array(n);
      this.atten = new Float32Array(n);
      this.prefix = new Float32Array((spec.lines + 1) * spec.samples);
    }
    const ctx = this.prepare(scene, beam, spec);
    if (this.lungEntry.length !== spec.lines) this.lungEntry = new Int32Array(spec.lines);
    this.lungEntry.fill(-1);
    for (let li = 0; li < spec.lines; li++) {
      const theta = -spec.sectorRad / 2 + (spec.sectorRad * (li + 0.5)) / spec.lines;
      this.renderLine(
        ctx,
        theta,
        li,
        li * spec.samples,
        this.re,
        this.im,
        out.structure,
        out.transmission,
        out.tissue,
        this.atten,
        out.segment,
      );
    }
    this.drawLung(ctx, spec, this.re, this.im);
    const kernels = this.kernels(scene, spec);
    // the march of the beam, not of the pencil line (decision 144): the echoes scaled by its transmission
    beamMarch(
      this.re,
      this.im,
      out.transmission,
      out.tissue,
      this.atten,
      spec,
      ctx.contact,
      ctx.seed,
      this.prefix,
      COMPOUND_LOOKS,
    );
    // the looks are detected one by one and their envelopes averaged (compounding, decision 145)
    out.amplitude.fill(0);
    for (let k = 0; k < COMPOUND_LOOKS; k++) {
      formEnvelope(
        this.re.subarray(k * n, (k + 1) * n),
        this.im.subarray(k * n, (k + 1) * n),
        spec.lines,
        spec.samples,
        kernels,
        this.tmpAmp,
        this.tmpRe,
        this.tmpIm,
      );
      const amp = out.amplitude,
        ta = this.tmpAmp,
        w = 1 / COMPOUND_LOOKS;
      for (let i = 0; i < n; i++) amp[i]! += ta[i]! * w;
    }
    this.lastMs = performance.now() - t0;
    this.lastSamples = n;
  }

  /** Kernels and level scales of an M-mode line of `samples` samples drawn under the frame geometry `frame` (decision 84). */
  lineKernels(scene: Scene, frame: PolarFrameSpec, samples: number): LineKernels {
    const { frequencyMHz, harmonics } = scene.physics;
    const bw = scene.physics.beamWidth ?? 0;
    if (
      !this.linePsf ||
      this.linePsf.key !== lineKernelKey(frame, samples, frequencyMHz, harmonics, bw)
    )
      this.linePsf = buildLineKernels(frame, samples, frequencyMHz, harmonics, bw);
    return this.linePsf;
  }

  /**
   * One M-mode line at angle theta (rad) through `samples` samples over the frame depth (decision 84). The line is finer
   * than a frame line so an echo moves continuously between columns, keeps the frame's levels (`LineKernels`), and draws
   * its scatterer phasor on a lattice aligned with the beam whose cell across the beam is the beam width: a line has no
   * lateral neighbours to average, and tissue sliding through it decorrelates over the beam and not over a 0.4 mm cell.
   * Blood is the exception: its scatterers flow a scatterer cell in a pulse interval or two (0.4 mm at 20 cm/s in 2 ms), so
   * its phasor is drawn anew for every `pulse` instead of streaking the cavity like still tissue. The slice-thickness side
   * planes are not sampled.
   */
  renderMmodeLine(
    scene: Scene,
    beam: BeamFrame,
    frame: PolarFrameSpec,
    samples: number,
    theta: number,
    pulse: number,
    amp: Float32Array,
    st: Uint8Array,
    tr: Float32Array,
    ti: Uint8Array,
  ): void {
    if (this.lineRe.length !== samples) {
      this.lineRe = new Float32Array(samples);
      this.lineIm = new Float32Array(samples);
      this.lineTmpRe = new Float32Array(samples);
      this.lineTmpIm = new Float32Array(samples);
      this.lineSigma = new Float32Array(samples);
      this.lineAcross = new Float32Array(samples);
      this.lineElevation = new Float32Array(samples);
      this.lineAlong = new Float32Array(samples);
      this.lineGrainScale = new Float32Array(samples);
      this.lineGrainCells = new Float32Array(samples);
    }
    this.lineSigma.fill(0);
    this.lineGrainScale.fill(0);
    const spec: PolarFrameSpec = { ...frame, samples, elevationSamples: 1 };
    const k = this.lineKernels(scene, frame, samples);
    const ctx = this.prepare(scene, beam, spec);
    const ct = Math.cos(theta),
      sn = Math.sin(theta);
    const hf = scene.heart.frame;
    const lat = {
      x: beam.lateral.x * ct - beam.forward.x * sn,
      y: beam.lateral.y * ct - beam.forward.y * sn,
      z: beam.lateral.z * ct - beam.forward.z * sn,
    };
    const fwd = {
      x: beam.forward.x * ct + beam.lateral.x * sn,
      y: beam.forward.y * ct + beam.lateral.y * sn,
      z: beam.forward.z * ct + beam.lateral.z * sn,
    };
    const fH = torsoToHeartDir(hf, fwd),
      lH = torsoToHeartDir(hf, lat),
      nH = torsoToHeartDir(hf, beam.normal);
    ctx.line = {
      kernels: k,
      torsoAxes: [
        fwd.x,
        fwd.y,
        fwd.z,
        lat.x,
        lat.y,
        lat.z,
        beam.normal.x,
        beam.normal.y,
        beam.normal.z,
      ],
      heartAxes: [fH.x, fH.y, fH.z, lH.x, lH.y, lH.z, nH.x, nH.y, nH.z],
      // a new realization of the flowing blood in every pulse (decision 163)
      bloodCells: (pulse % 4096) * BLOOD_DECORRELATION_CELLS,
      sigma: this.lineSigma,
      across: this.lineAcross,
      elevation: this.lineElevation,
      along: this.lineAlong,
      grainScale: this.lineGrainScale,
      grainCells: this.lineGrainCells,
    };
    const li = Math.round(((theta + frame.sectorRad / 2) / frame.sectorRad) * frame.lines);
    const re = this.lineRe,
      im = this.lineIm;
    this.renderLine(ctx, theta, li, 0, re, im, st, tr, ti);
    // Scatterers along the beam. Many heart structures carry material coordinates fixed in the heart frame (valves, atrial
    // and aortic walls, pericardium) or scaled with the whole ventricle, which is invisible in a frame but in an M-mode trace
    // leaves the speckle standing still while the band moves: horizontal stripes across a moving leaflet. Each run of one
    // heart structure and tissue along the line is given its own coordinate from the run's centre, so its speckle travels
    // with it and stretches only by half the thickening. The thorax does not move under the probe: its tissue keeps its
    // material coordinate, or a chest-wall run ending on the beating heart would drag its speckle along.
    const { latA, latB, latC } = ctx;
    const R = SCATTER_FREQ_RATIO;
    const dr = frame.depthCm / samples;
    const sigma = this.lineSigma,
      across = this.lineAcross,
      elev = this.lineElevation,
      along = this.lineAlong,
      grainScale = this.lineGrainScale,
      grainCells = this.lineGrainCells;
    const [, pathY, pathZ] = LINE_LATTICE_PATH;
    for (let a = 0; a < samples;) {
      let b = a + 1;
      while (b < samples && st[b] === st[a] && ti[b] === ti[a]) b++;
      const centre = (a + b) / 2;
      const offset = st[a]! * 7.31 + ti[a]! * 3.17;
      for (let i = a; i < b; i++) {
        const sg = sigma[i]!;
        if (sg === 0) continue;
        const uc = Number.isNaN(along[i]!) ? (i + 0.5 - centre) * dr : along[i]!;
        const u = uc * SCATTER_FREQ;
        const gs = grainScale[i]!;
        if (gs > 0) {
          // the grains of the run travel with it too; across the beam their cell is the beam width or the slice
          // thickness where those are coarser than the grain
          const gf = grainCells[i]!;
          const ug = uc * gf;
          re[i] =
            re[i]! +
            gs *
              grainCoef(
                ug + offset + GR_X,
                across[i]! * Math.min(1, gf / k.lateralCells[i]!) + ug * pathY + GR_Y,
                elev[i]! * Math.min(1, gf / k.elevationCells[i]!) + ug * pathZ + GR_Z,
                latA,
                latB,
                latC,
              );
        }
        const qx = u + offset,
          qy = across[i]! + u * pathY,
          qz = elev[i]! + u * pathZ;
        re[i] =
          re[i]! +
          sg *
            (latticeNoise3(qx, qy, qz, latA) +
              latticeNoise3(qx * R + PRB_X, qy * R + PRB_Y, qz * R + PRB_Z, latB) -
              1) *
            PHASOR_NORM;
        im[i] =
          im[i]! +
          sg *
            (latticeNoise3(qx + PIA_X, qy + PIA_Y, qz + PIA_Z, latC) +
              latticeNoise3(qx * R + PIB_X, qy * R + PIB_Y, qz * R + PIB_Z, latA) -
              1) *
            PHASOR_NORM;
      }
      a = b;
    }
    formEnvelopeLine(re, im, samples, k, amp, this.lineTmpRe, this.lineTmpIm);
  }

  private prepare(scene: Scene, beam: BeamFrame, spec: PolarFrameSpec): LineContext {
    const { heart, thorax, physics } = scene;
    const f = physics.frequencyMHz;
    const harm = physics.harmonics;
    const hf = heart.frame;
    return {
      scene,
      beam,
      spec,
      dr: spec.depthCm / spec.samples,
      fAtten: attenuationFrequencyMHz(f, harm),
      seed: physics.seed,
      harm,
      clutter:
        (physics.clutterLevel * 2.5 + physics.windowAttenuation * 0.8) *
        (harm ? 0.35 : 1) *
        Math.sqrt(2.5 / f),
      contact: contactQuality(beam.contact),
      fwdH: torsoToHeartDir(hf, beam.forward),
      latH: torsoToHeartDir(hf, beam.lateral),
      nrmH: torsoToHeartDir(hf, beam.normal),
      windowAttenuation: physics.windowAttenuation,
      bloodShift: bloodShiftCells(physics.bloodFrame ?? 0),
      thorax,
      latA: noiseLattice(physics.seed),
      latB: noiseLattice(physics.seed ^ 0x2545f491),
      latC: noiseLattice(physics.seed ^ 0x51),
      line: null,
    };
  }

  /** The pleural line at sample `idx`: coherent, the same in every look; its specular share follows the incidence. */
  private pleuraEcho(
    ctx: LineContext,
    li: number,
    idx: number,
    r: number,
    entryT: number,
    coherence: number,
    looks: number,
    re: Float32Array,
    im: Float32Array,
  ): void {
    const lk = ctx.line ? ctx.line.kernels : null;
    const nFrame = ctx.spec.lines * ctx.spec.samples;
    let pleura =
      entryT *
      (PLEURA_BASE +
        PLEURA_AMP *
          latticeNoise3(li * PLEURA_LINE_FREQ, r * PLEURA_DEPTH_FREQ, PLEURA_Z, ctx.latA)) *
      (PLEURA_DIFFUSE_FLOOR + (1 - PLEURA_DIFFUSE_FLOOR) * coherence);
    if (lk) pleura *= lk.single;
    for (let k = 0; k < looks; k++) {
      re[k * nFrame + idx] = pleura;
      im[k * nFrame + idx] = 0;
    }
  }

  /** Reverberation behind the pleura at sample `idx`: incoherent, a phasor tied to the line and the depth per look. */
  private lungEcho(
    ctx: LineContext,
    li: number,
    idx: number,
    r: number,
    entryR: number,
    entryT: number,
    coherence: number,
    looks: number,
    re: Float32Array,
    im: Float32Array,
  ): void {
    const { latA, latB, latC } = ctx;
    const incAxial = ctx.line ? ctx.line.kernels.incoherentAxial : 1;
    const nFrame = ctx.spec.lines * ctx.spec.samples;
    const R = SCATTER_FREQ_RATIO;
    const nn =
      REVERB_MOD_BASE +
      REVERB_MOD_AMP *
        latticeNoise3(li * REVERB_MOD_LINE_FREQ, r * REVERB_MOD_DEPTH_FREQ, REVERB_MOD_Z, latC);
    const a = pleuralReverberation(r, entryR, entryT, nn, coherence);
    // reverberation energy is incoherent: a phasor tied to the line and the depth, one per look (decision 145)
    const px2 = li * REVERB_PHASOR_LINE_FREQ,
      pr = r * SCATTER_FREQ;
    for (let k = 0; k < looks; k++) {
      const sx = LOOK_SHIFT[k]![0],
        sy = LOOK_SHIFT[k]![1],
        sz = LOOK_SHIFT[k]![2];
      re[k * nFrame + idx] =
        a *
        (latticeNoise3(px2 + sx, pr + sy, REVERB_PHASOR_RE_A_Z + sz, latA) +
          latticeNoise3(px2 + RRB_X + sx, pr * R + RRB_Y + sy, RRB_Z + sz, latB) -
          1) *
        PHASOR_NORM *
        incAxial;
      im[k * nFrame + idx] =
        a *
        (latticeNoise3(px2 + RIA_X + sx, pr + RIA_Y + sy, RIA_Z + sz, latC) +
          latticeNoise3(px2 + RIB_X + sx, pr * R + RIB_Y + sy, RIB_Z + sz, latA) -
          1) *
        PHASOR_NORM *
        incAxial;
    }
  }

  /**
   * The pleura and the reverberations of a frame (decision 221): how square the pleura stands to a line comes from the
   * entries of its neighbours, each taken within PLEURA_SLOPE_WINDOW_CM of its own (a neighbour without lung there is a
   * cliff); `glslPasses.ts` repeats it from the pass A flags.
   */
  private drawLung(
    ctx: LineContext,
    spec: PolarFrameSpec,
    re: Float32Array,
    im: Float32Array,
  ): void {
    const { dr } = ctx;
    const lines = spec.lines,
      samples = spec.samples;
    const w = Math.floor(PLEURA_SLOPE_WINDOW_CM / dr + 0.5);
    const dTheta = spec.sectorRad / lines;
    const entry = this.lungEntry;
    for (let li = 0; li < lines; li++) {
      const e = entry[li]!;
      if (e < 0) continue;
      const near = (j: number): number => {
        const ej = entry[j]!;
        return ej < 0 ? e + w : Math.min(e + w, Math.max(e - w, ej));
      };
      let dEntry = 0,
        span = 1;
      if (li > 0 && li < lines - 1) {
        dEntry = near(li + 1) - near(li - 1);
        span = 2;
      } else if (li > 0) dEntry = e - near(li - 1);
      else if (li < lines - 1) dEntry = near(li + 1) - e;
      const rE = (e + 0.5) * dr;
      const coherence = pleuralCoherence(pleuralIncidenceCos(dEntry * dr, span * rE * dTheta));
      const base = li * samples;
      this.pleuraEcho(ctx, li, base + e, rE, 1, coherence, COMPOUND_LOOKS, re, im);
      for (let si = e + 1; si < samples; si++)
        this.lungEcho(
          ctx,
          li,
          base + si,
          (si + 0.5) * dr,
          rE,
          1,
          coherence,
          COMPOUND_LOOKS,
          re,
          im,
        );
    }
  }

  private renderLine(
    ctx: LineContext,
    theta: number,
    li: number,
    base: number,
    re: Float32Array,
    im: Float32Array,
    st: Uint8Array,
    tr: Float32Array,
    ti: Uint8Array,
    atten: Float32Array | null = null,
    sg: Uint8Array | null = null,
  ): void {
    const {
      beam,
      spec,
      dr,
      fAtten,
      seed,
      harm,
      clutter,
      contact,
      fwdH,
      latH,
      nrmH,
      thorax,
      latA,
      latB,
      latC,
      line,
    } = ctx;
    // M-mode line scales (decision 84); a frame line uses 1, which leaves its arithmetic unchanged
    const lk = line ? line.kernels : null;
    const inc = lk ? lk.incoherent : 1;
    const incAxial = lk ? lk.incoherentAxial : 1;
    const { heart, heartPose } = ctx.scene;
    const hf = heart.frame;
    const s = this.sample;
    const s2 = this.sample2;
    const acA = this.acA;
    const acB = this.acB;
    const samples = spec.samples;
    const nElev = spec.elevationSamples;
    const focus = spec.focusCm;
    // compounding looks of a frame (decision 145); an M-mode line has one
    const looks = line ? 1 : COMPOUND_LOOKS;
    const nFrame = spec.lines * samples;
    const ox = beam.origin.x,
      oy = beam.origin.y,
      oz = beam.origin.z;
    const ct = Math.cos(theta),
      sn = Math.sin(theta);
    const dx = beam.forward.x * ct + beam.lateral.x * sn;
    const dy = beam.forward.y * ct + beam.lateral.y * sn;
    const dz = beam.forward.z * ct + beam.lateral.z * sn;
    const dhx = fwdH.x * ct + latH.x * sn,
      dhy = fwdH.y * ct + latH.y * sn,
      dhz = fwdH.z * ct + latH.z * sn;
    const nX = beam.normal.x,
      nY = beam.normal.y,
      nZ = beam.normal.z;
    const R = SCATTER_FREQ_RATIO;
    const lineDrop = hash3(li, 7, 0, seed) > contact ? 0.08 : 1;
    let transmission = lineDrop;
    let lungEntryR = -1;
    let lungEntryT = 0;
    let dead = false;
    /** Classify a torso point into `q`: 0 outside the body, 1 thorax, 2 heart (anterior lung wins over the heart). */
    const classifyAt = (px: number, py: number, pz: number, q: TissueSample): number => {
      if (isAnteriorLung(thorax, px, py, pz)) {
        q.tissue = Tissue.Lung;
        q.structure = Structure.Lung;
        q.sdf = -1;
        q.nx = 0;
        q.ny = 0;
        q.nz = 1;
        q.mx = px;
        q.my = py;
        q.mz = pz;
        q.extraReflect = 0;
        q.segment = 0;
        return 1;
      }
      const hx =
        (px - hf.origin.x) * hf.ex.x + (py - hf.origin.y) * hf.ex.y + (pz - hf.origin.z) * hf.ex.z;
      const hy =
        (px - hf.origin.x) * hf.ey.x + (py - hf.origin.y) * hf.ey.y + (pz - hf.origin.z) * hf.ey.z;
      const hz =
        (px - hf.origin.x) * hf.ez.x + (py - hf.origin.y) * hf.ez.y + (pz - hf.origin.z) * hf.ez.z;
      if (classifyHeart(heart, heartPose, hx, hy, hz, q)) return 2;
      // on a miss q.sdf holds the distance beyond the pericardial sac: the lungs wrap the heart (decision 144)
      return classifyThorax(thorax, px, py, pz, q, q.sdf) ? 1 : 0;
    };
    /** Incoherent backscatter σ and coherent specular echo of a classified sample, before attenuation. */
    const acoustic = (q: TissueSample, inH: boolean, a: { sigma: number; spec: number }): void => {
      const props = TISSUE_PROPS[q.tissue]!;
      const nd0 = Math.abs(
        inH ? q.nx * dhx + q.ny * dhy + q.nz * dhz : q.nx * dx + q.ny * dy + q.nz * dz,
      );
      // a cord's sample carries its axis: it reflects with the beam across it (decision 227)
      const nd = q.tissue === Tissue.Chordae ? cordAlignment(nd0) : nd0;
      let sigma = props.reflect;
      if (q.tissue === Tissue.Blood && harm) sigma *= BLOOD_HARMONIC_SIGMA;
      // myocardial backscatter is strongest with the beam across the fibres: in the LV walls they run
      // ~circumferentially around the long axis (heart-frame z), so the circumferential direction at
      // the sample is ẑ × radial = (−my, mx, 0)/r — beam·fibre alignment darkens the wall, not the
      // wall normal. Other myocardium keeps the normal-based response.
      // The right ventricular free wall wraps the same axis with the same circumferential-oblique fibres, so it takes
      // the fibre response too; the atrial walls and the interatrial septum scatter without anisotropy (thin walls of
      // crossing fibre bundles, decision 140). Under the wall-normal response both ran along the apical beams and
      // fell to the floor: RV free wall 71-76 grey against 61 in its blood, atrial walls 75-102 against 74-84, next
      // to a septum at 95-100 (A4C and A5C, default console).
      if (q.tissue === Tissue.Myocardium) {
        if (
          inH &&
          ((q.structure >= Structure.LvWallSeptal && q.structure <= Structure.LvApex) ||
            q.structure === Structure.RvWall)
        ) {
          const rr = Math.sqrt(q.mx * q.mx + q.my * q.my);
          const dphi = rr > MYO_ANISO_RADIAL_EPS ? (dhy * q.mx - dhx * q.my) / rr : 0;
          // the fibre helix across the wall (decision 144); a wall sample without a depth (the RV free wall) takes the mid-wall
          sigma *= myoHelixGain(dphi, dhz, q.transmural >= 0 ? q.transmural : 0.5);
        } else if (
          !inH ||
          (q.structure !== Structure.LaWall &&
            q.structure !== Structure.RaWall &&
            q.structure !== Structure.InteratrialSeptum)
        ) {
          sigma *= MYO_ANISO_FLOOR + (1 - MYO_ANISO_FLOOR) * nd * nd;
        }
      }
      const het = heteroDb(q.tissue);
      if (het > 0)
        sigma *= Math.pow(
          10,
          ((latticeNoise3(
            q.mx * HETERO_FREQ + HET_X,
            q.my * HETERO_FREQ + HET_Y,
            q.mz * HETERO_FREQ + HET_Z,
            latC,
          ) -
            0.5) *
            het) /
            20,
        );
      if (q.extraReflect > 0)
        sigma +=
          q.extraReflect *
          CALCIUM_GAIN *
          (CALCIUM_BASE +
            CALCIUM_AMP *
              latticeNoise3(
                q.mx * CALCIUM_FREQ + CAL_X,
                q.my * CALCIUM_FREQ + CAL_Y,
                q.mz * CALCIUM_FREQ + CAL_Z,
                latB,
              ));
      let specular = 0;
      // the interface echo belongs to the sample the interface crosses (distance along the line < one sample)
      if (props.specular > 0 && Math.abs(q.sdf) < Math.max(nd, SPECULAR_WINDOW_MIN) * dr)
        specular =
          props.specular * SPECULAR_GAIN * nd * nd * nd * nd * (harm ? SPECULAR_HARMONIC : 1);
      a.sigma = sigma;
      a.spec = specular;
    };
    for (let si = 0; si < samples; si++) {
      const r = (si + 0.5) * dr;
      const idx = base + si;
      if (dead) {
        // an M-mode line: its pleura faces the beam (a frame's lines wait for their neighbours, decision 221)
        this.lungEcho(ctx, li, idx, r, lungEntryR, lungEntryT, 1, looks, re, im);
        st[idx] = Structure.Lung;
        tr[idx] = 0;
        ti[idx] = Tissue.Lung;
        if (sg) sg[idx] = 0;
        continue;
      }
      const px = ox + dx * r,
        py = oy + dy * r,
        pz = oz + dz * r;
      const kind = classifyAt(px, py, pz, s);
      if (kind === 0) {
        for (let k = 0; k < looks; k++) {
          re[k * nFrame + idx] = 0;
          im[k * nFrame + idx] = 0;
        }
        st[idx] = Structure.None;
        tr[idx] = transmission;
        ti[idx] = Tissue.None;
        if (sg) sg[idx] = 0;
        continue;
      }
      const inHeart = kind === 2;
      const tissue = s.tissue;
      const props = TISSUE_PROPS[tissue]!;
      st[idx] = s.structure;
      tr[idx] = transmission;
      ti[idx] = tissue;
      // the LV segment of the tissue the beam crosses here (decision 152), from the same sample as the structure
      if (sg) sg[idx] = s.segment;
      if (tissue === Tissue.Lung) {
        // pleural line: a strong coherent reflector; everything behind it is reverberation
        lungEntryR = r;
        // a frame's lung echoes are scaled by the beam's transmission at the entry in the beam march; a line's by its own
        lungEntryT = line ? transmission : 1;
        if (!line) {
          // a frame line: its pleura and reverberations are drawn once every line's entry is known, since how square the
          // pleura stands to the beam comes from the neighbouring lines' entries (decision 221)
          this.lungEntry[li] = si;
          for (let sj = si; sj < samples; sj++) {
            const j = base + sj;
            for (let k = 0; k < looks; k++) {
              re[k * nFrame + j] = 0;
              im[k * nFrame + j] = 0;
            }
            if (sj === si) continue;
            st[j] = Structure.Lung;
            tr[j] = 0;
            ti[j] = Tissue.Lung;
            if (sg) sg[j] = 0;
          }
          break;
        }
        this.pleuraEcho(ctx, li, idx, r, lungEntryT, 1, looks, re, im);
        dead = true;
        continue;
      }
      acoustic(s, inHeart, acA);
      let sigma = acA.sigma;
      let specular = acA.spec;
      if (tissue === Tissue.Valve) {
        // a leaflet is a membrane thinner than the slice: it reads by the fraction of the slice it fills, full where it
        // stands across the plane and MEMBRANE_CM over the slice thickness where it lies in it; the side planes of the
        // high tier would miss it, so it takes no elevation average (decision 147)
        const nn = inHeart
          ? s.nx * nrmH.x + s.ny * nrmH.y + s.nz * nrmH.z
          : s.nx * nX + s.ny * nY + s.nz * nZ;
        const w = membraneWeight(nn, sliceHalfWidthCm(r, focus));
        sigma *= w;
        specular *= w;
      } else if (tissue === Tissue.Chordae) {
        // a cord thinner than the slice reads by the fraction of the slice it fills, and takes no elevation average
        // either (decision 227)
        const w = cordWeight(
          s.nx * nrmH.x + s.ny * nrmH.y + s.nz * nrmH.z,
          sliceHalfWidthCm(r, focus),
        );
        sigma *= w;
        specular *= w;
      } else if (nElev > 1) {
        // slice thickness: the beam's elevational width grows away from the focus; backscatter and interface
        // echo are the weighted mean over the slice (¼ ½ ¼), which blurs obliquely cut structures
        const e = sliceHalfWidthCm(r, focus);
        let accS = sigma * 0.5,
          accP = specular * 0.5,
          wsum = 0.5;
        for (let k = -1; k <= 1; k += 2) {
          const kk = classifyAt(px + nX * k * e, py + nY * k * e, pz + nZ * k * e, s2);
          if (kk > 0 && s2.tissue !== Tissue.Lung) {
            acoustic(s2, kk === 2, acB);
            accS += 0.25 * acB.sigma;
            accP += 0.25 * acB.spec;
            wsum += 0.25;
          }
        }
        sigma = accS / wsum;
        specular = accP / wsum;
      }
      // the beam's on-axis sensitivity at this depth: wide near the face, narrowest at the focus (decision 144)
      const fg = focusingGain(r, focus);
      sigma *= fg;
      specular *= fg;
      // complex scatterer phasor of the central plane, anchored in tissue coordinates (moves with the tissue). Across the
      // plane its lattice cell is the slice thickness, as for an M-mode line (decision 99): at the scatterer cell (0.4 mm)
      // a probe tilt that moved the plane by 0.31 mm at 9 cm left the myocardial speckle with a correlation of 0.71, for a
      // slice about 4 mm thick there
      const nhx = inHeart ? nrmH.x : nX,
        nhy = inHeart ? nrmH.y : nY,
        nhz = inHeart ? nrmH.z : nZ;
      const across =
        (SCATTER_FREQ - 1 / (2 * sliceHalfWidthCm(r, focus))) *
        (s.mx * nhx + s.my * nhy + s.mz * nhz);
      // flowing blood is a new realization in every frame (decision 163)
      const qx =
          s.mx * SCATTER_FREQ - across * nhx + (tissue === Tissue.Blood ? ctx.bloodShift : 0),
        qy = s.my * SCATTER_FREQ - across * nhy,
        qz = s.mz * SCATTER_FREQ - across * nhz;
      // bright grains of the parenchyma: a sparse coherent component over the diffuse scatterers, the same in every look
      // (decision 145). The grain lattice is anchored in tissue coordinates at the tissue's grain frequency; across the
      // plane its cell is the slice thickness where that is coarser, as for the scatterer phasor, and the slice
      // integrates the grains it holds across (`grainCoef`). An M-mode line places its grains per structure run after
      // the march (`renderMmodeLine`), like its scatterers
      let grain = 0;
      const gf = props.grain;
      if (tissue === Tissue.Myocardium || tissue === Tissue.Muscle || tissue === Tissue.Liver) {
        if (line && lk) {
          line.grainScale[si] = sigma * GRAIN_GAIN * transmission * lk.smooth;
          line.grainCells[si] = gf;
        } else {
          const ga = gf - Math.min(gf, 1 / (2 * sliceHalfWidthCm(r, focus)));
          const gm = (s.mx * nhx + s.my * nhy + s.mz * nhz) * ga;
          grain =
            sigma *
            GRAIN_GAIN *
            grainCoef(
              s.mx * gf - gm * nhx + GR_X,
              s.my * gf - gm * nhy + GR_Y,
              s.mz * gf - gm * nhz + GR_Z,
              latA,
              latB,
              latC,
            );
        }
      }
      // a frame forms one complex signal per compounding look: the scatterer and clutter phasors differ between looks,
      // the coherent echoes (specular, ring-down) do not (decision 145); an M-mode line keeps one look
      let sRe = 0,
        sIm = 0;
      if (line && lk) {
        // M-mode line (decision 84): the lattice axes follow the beam, with the beam width as the cell across it; the
        // coordinate along the beam is set per structure after the march (`renderMmodeLine`), so only σ is kept here
        const a = inHeart ? line.heartAxes : line.torsoAxes;
        line.along[si] = inHeart ? NaN : s.mx * a[0]! + s.my * a[1]! + s.mz * a[2]!;
        line.across[si] = (s.mx * a[3]! + s.my * a[4]! + s.mz * a[5]!) * lk.lateralCells[si]!;
        line.elevation[si] =
          (s.mx * a[6]! + s.my * a[7]! + s.mz * a[8]!) * lk.elevationCells[si]! +
          (tissue === Tissue.Blood ? line.bloodCells : 0);
        line.sigma[si] = sigma * inc * transmission;
        sRe = specular * lk.specular;
        sIm = 0;
      }
      let cm = 0;
      if (r < CLUTTER_MAX_CM && clutter > 0)
        // near-field clutter: reverberation in the chest wall under the footprint, incoherent, fixed to the probe position
        cm =
          clutter *
          Math.exp(-r / CLUTTER_DECAY_CM) *
          (CLUTTER_BASE +
            CLUTTER_AMP *
              latticeNoise3(
                ox * CLUTTER_MOD_FREQ + li * CLUTTER_MOD_LINE_FREQ,
                oy * CLUTTER_MOD_FREQ + oz * CLUTTER_MOD_FREQ,
                r * CLUTTER_MOD_DEPTH_FREQ,
                latC,
              ));
      const cx = ox * CLUTTER_FREQ + li * CLUTTER_LINE_FREQ,
        cy = oy * CLUTTER_FREQ + oz * CLUTTER_FREQ,
        cz = r * SCATTER_FREQ;
      const ringDown = r < RINGDOWN_CM ? RINGDOWN_GAIN * (1 - r / RINGDOWN_CM) : 0; // transducer ring-down
      if (line && lk) {
        if (cm > 0) {
          sRe +=
            cm *
            (latticeNoise3(cx + CLUTTER_RE_A_X, cy, cz, latA) +
              latticeNoise3(cx * R + CRB_X, cy + CRB_Y, cz * R, latB) -
              1) *
            PHASOR_NORM *
            incAxial;
          sIm +=
            cm *
            (latticeNoise3(cx + CIA_X, cy + CIA_Y, cz + CIA_Z, latC) +
              latticeNoise3(cx * R + CIB_X, cy + CIB_Y, cz * R + CIB_Z, latA) -
              1) *
            PHASOR_NORM *
            incAxial;
        }
        if (ringDown > 0) sRe += ringDown * lk.smooth;
        // an M-mode line scales its echoes by its own transmission (no lateral neighbours)
        re[idx] = sRe * transmission;
        im[idx] = sIm * transmission;
      } else {
        // a frame's echoes are scaled by the beam's transmission in the beam march
        for (let k = 0; k < looks; k++) {
          const sx = LOOK_SHIFT[k]![0],
            sy = LOOK_SHIFT[k]![1],
            sz = LOOK_SHIFT[k]![2];
          const zr =
            (latticeNoise3(qx + sx, qy + sy, qz + sz, latA) +
              latticeNoise3(qx * R + PRB_X + sx, qy * R + PRB_Y + sy, qz * R + PRB_Z + sz, latB) -
              1) *
            PHASOR_NORM;
          const zi =
            (latticeNoise3(qx + PIA_X + sx, qy + PIA_Y + sy, qz + PIA_Z + sz, latC) +
              latticeNoise3(qx * R + PIB_X + sx, qy * R + PIB_Y + sy, qz * R + PIB_Z + sz, latA) -
              1) *
            PHASOR_NORM;
          let lre = sigma * zr + specular + grain + ringDown;
          let lim = sigma * zi;
          if (cm > 0) {
            lre +=
              cm *
              (latticeNoise3(cx + CLUTTER_RE_A_X + sx, cy + sy, cz + sz, latA) +
                latticeNoise3(cx * R + CRB_X + sx, cy + CRB_Y + sy, cz * R + sz, latB) -
                1) *
              PHASOR_NORM;
            lim +=
              cm *
              (latticeNoise3(cx + CIA_X + sx, cy + CIA_Y + sy, cz + CIA_Z + sz, latC) +
                latticeNoise3(cx * R + CIB_X + sx, cy + CIB_Y + sy, cz * R + CIB_Z + sz, latA) -
                1) *
              PHASOR_NORM;
          }
          re[k * nFrame + idx] = lre;
          im[k * nFrame + idx] = lim;
        }
      }
      // two-way amplitude loss integrated over the sample's length (decision 89): 0.23 Np per dB·cm⁻¹·MHz⁻¹ of one-way
      // attenuation, so a layer loses the same whatever the sampling. Bone, calcium and spine used a fixed 1.2 Np per
      // sample, which made a rib's shadow depend on the quality tier (17 dB between low and high behind 4 mm of rib).
      let attenNp = ATTEN_NP_PER_DB * props.attenuation * fAtten * dr;
      if (s.extraReflect > CALCIUM_ATTEN_THRESHOLD)
        attenNp += CALCIUM_ATTEN_NP * s.extraReflect * (dr / CALCIUM_ATTEN_REF_CM); // calcified tissue ≈ 10 dB/cm at 2.5 MHz
      if (!inHeart && (tissue === Tissue.Fat || tissue === Tissue.Muscle || tissue === Tissue.Skin))
        attenNp *= 1 + WINDOW_ATTEN_GAIN * ctx.windowAttenuation;
      if (atten) atten[idx] = attenNp;
      transmission *= Math.exp(-attenNp);
      if (transmission < TRANSMISSION_FLOOR) transmission = TRANSMISSION_FLOOR;
    }
  }
}

/**
 * The march of the beam (decision 144). Each line marched its own attenuation, so a line running inside the lateral
 * wall from the apex reached 7 cm 15 dB weaker than its neighbour in the blood, and an apical wall came out brightest
 * at its endocardial edge and darkest at its epicardial one whatever the fibres did. A pulse is not a pencil: the
 * energy that reaches a sample left the whole aperture and crossed, at every depth on the way, the width of the beam
 * there — mostly blood beside a wall it grazes. So the attenuation a line pays at each depth is the mean increment over
 * the lines within the beam's half-width at that depth (`beamHalfWidthCm`, the aperture tapering to the focus, at most ±12° of sector: `beamAttenWindowLines`), over
 * the body-tissue samples among them; outside-body and lung samples neither pay nor count. Prefix sums across lines make
 * the window mean O(1). The echoes come unscaled from the line march and are scaled here by the beam's transmission,
 * the lung echoes of a line by the transmission at its pleural entry.
 */
export function beamMarch(
  re: Float32Array,
  im: Float32Array,
  tr: Float32Array,
  ti: Uint8Array,
  atten: Float32Array,
  spec: PolarFrameSpec,
  contact: number,
  seed: number,
  prefix: Float32Array,
  looks = 1,
): void {
  const { lines, samples } = spec;
  const n = lines * samples;
  const dr = spec.depthCm / samples;
  const dTheta = spec.sectorRad / lines;
  // prefix sums per sample across lines: `prefix` ((lines + 1) × samples) holds the increment sums, `count` the
  // number of tissue samples
  const count = new Int32Array(lines + 1);
  for (let si = 0; si < samples; si++) {
    const r = (si + 0.5) * dr;
    const K = beamAttenWindowLines(r, spec.focusCm, dTheta);
    let acc = 0;
    let cnt = 0;
    prefix[si] = 0;
    count[0] = 0;
    for (let li = 0; li < lines; li++) {
      const i = li * samples + si;
      const t = ti[i]!;
      if (t !== Tissue.None && t !== Tissue.Lung) {
        acc += atten[i]!;
        cnt++;
      }
      prefix[(li + 1) * samples + si] = acc;
      count[li + 1] = cnt;
    }
    // the window mean replaces the increment in place (the prefix sums above are already taken)
    for (let li = 0; li < lines; li++) {
      const i = li * samples + si;
      const t = ti[i]!;
      if (t === Tissue.None || t === Tissue.Lung) continue;
      const a = Math.max(0, li - K),
        b = Math.min(lines, li + K + 1);
      const n = count[b]! - count[a]!;
      atten[i] = n > 0 ? (prefix[b * samples + si]! - prefix[a * samples + si]!) / n : atten[i]!;
    }
  }
  for (let li = 0; li < lines; li++) {
    const base = li * samples;
    let transmission = hash3(li, 7, 0, seed) > contact ? 0.08 : 1;
    let lungScale = -1;
    for (let si = 0; si < samples; si++) {
      const i = base + si;
      const t = ti[i]!;
      if (t === Tissue.None) {
        tr[i] = transmission;
        continue;
      }
      if (t === Tissue.Lung) {
        // the pleural line and the reverberation behind it, drawn at unit transmission by the line march
        if (lungScale < 0) {
          lungScale = transmission;
          tr[i] = transmission;
        } else tr[i] = 0;
        for (let k = 0; k < looks; k++) {
          re[k * n + i]! *= lungScale;
          im[k * n + i]! *= lungScale;
        }
        continue;
      }
      tr[i] = transmission;
      for (let k = 0; k < looks; k++) {
        re[k * n + i]! *= transmission;
        im[k * n + i]! *= transmission;
      }
      transmission *= Math.exp(-atten[i]!);
      if (transmission < TRANSMISSION_FLOOR) transmission = TRANSMISSION_FLOOR;
    }
  }
}

interface LineContext {
  scene: Scene;
  beam: BeamFrame;
  spec: PolarFrameSpec;
  dr: number;
  fAtten: number;
  seed: number;
  harm: boolean;
  clutter: number;
  contact: number;
  fwdH: { x: number; y: number; z: number };
  latH: { x: number; y: number; z: number };
  nrmH: { x: number; y: number; z: number };
  windowAttenuation: number;
  /** Lattice shift of the flowing blood's scatterers in this frame (decision 163). */
  bloodShift: number;
  thorax: Scene['thorax'];
  latA: Uint8Array;
  latB: Uint8Array;
  latC: Uint8Array;
  /** Set only for an M-mode line (decision 84). */
  line: {
    kernels: LineKernels;
    /** Beam axes (along, across in the scan plane, elevation) in torso and heart coordinates, 3 × 3 flattened. */
    torsoAxes: number[];
    heartAxes: number[];
    /** Lattice offset of flowing blood for this pulse: its speckle does not persist from one pulse to the next. */
    bloodCells: number;
    /**
     * Per sample: incoherent backscatter reaching the probe (σ × transmission), its lattice coordinates across the beam, and
     * for tissue of the thorax (still under the probe) its material coordinate along the beam; NaN in the heart.
     */
    sigma: Float32Array;
    across: Float32Array;
    elevation: Float32Array;
    along: Float32Array;
    /** Per sample: scale of the parenchymal grains reaching the probe (0 without grains) and their lattice frequency. */
    grainScale: Float32Array;
    grainCells: Float32Array;
  } | null;
}

/** A grain field above its threshold, 0–1. */
const grainAbove = (g: number): number =>
  g > GRAIN_THRESHOLD ? (g - GRAIN_THRESHOLD) / (1 - GRAIN_THRESHOLD) : 0;

/**
 * Coefficient (0–1) of the parenchymal grains at a lattice coordinate (decision 145): the slice holds two or three grain
 * cells across, whose coherent echoes add, so it reads the mean (¼ ½ ¼) of three independent grain fields rather than a
 * single one, at every tier and on an M-mode line alike.
 */
function grainCoef(
  x: number,
  y: number,
  z: number,
  latA: Uint8Array,
  latB: Uint8Array,
  latC: Uint8Array,
): number {
  return (
    0.25 * grainAbove(latticeNoise3(x, y, z, latA)) +
    0.5 * grainAbove(latticeNoise3(x, y, z, latB)) +
    0.25 * grainAbove(latticeNoise3(x, y, z, latC))
  );
}

function torsoToHeartDir(
  f: {
    ex: { x: number; y: number; z: number };
    ey: { x: number; y: number; z: number };
    ez: { x: number; y: number; z: number };
  },
  d: { x: number; y: number; z: number },
) {
  return {
    x: d.x * f.ex.x + d.y * f.ex.y + d.z * f.ex.z,
    y: d.x * f.ey.x + d.y * f.ey.y + d.z * f.ey.z,
    z: d.x * f.ez.x + d.y * f.ez.y + d.z * f.ez.z,
  };
}
