import type { BeamFrame } from '@/simulator/probe/pose';
import type { PolarFrame, PolarFrameSpec, RendererBackend, Scene } from '../types';
import { classifyHeart } from '@/simulator/anatomy/heartModel';
import { classifyThorax, isAnteriorLung } from '@/simulator/anatomy/thoraxModel';
import { makeSample, TISSUE_PROPS, Tissue, Structure, type TissueSample } from '@/simulator/anatomy/tissue';
import { latticeNoise3, noiseLattice } from '@/core/noise';
import { hash3 } from '@/core/random';
import { contactQuality } from '@/simulator/probe/pose';
import { buildLineKernels, buildPsfKernels, formEnvelope, formEnvelopeLine, LINE_LATTICE_PATH, lineKernelKey, psfKey, sliceHalfWidthCm, type LineKernels, type PsfKernels } from '../acoustic/psf';
import { HETERO_FREQ, heteroDb, MYO_ANISO_FLOOR, PHASOR_NORM, SCATTER_FREQ, SCATTER_FREQ_RATIO, SPECULAR_GAIN, SPECULAR_HARMONIC, SPECULAR_WINDOW_MIN } from '../acoustic/acoustics';

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
  private lineRe = new Float32Array(0);
  private lineIm = new Float32Array(0);
  private lineTmpRe = new Float32Array(0);
  private lineTmpIm = new Float32Array(0);
  private lineSigma = new Float32Array(0);
  private lineAcross = new Float32Array(0);
  private lineElevation = new Float32Array(0);
  private lineAlong = new Float32Array(0);
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
    if (!this.psf || this.psf.key !== psfKey(spec, frequencyMHz, harmonics, bw)) this.psf = buildPsfKernels(spec, frequencyMHz, harmonics, bw);
    return this.psf;
  }

  render(scene: Scene, beam: BeamFrame, spec: PolarFrameSpec, _phase: number, out: PolarFrame): void {
    const t0 = performance.now();
    const n = spec.lines * spec.samples;
    if (this.re.length !== n) {
      this.re = new Float32Array(n);
      this.im = new Float32Array(n);
      this.tmpRe = new Float32Array(n);
      this.tmpIm = new Float32Array(n);
    }
    const ctx = this.prepare(scene, beam, spec);
    for (let li = 0; li < spec.lines; li++) {
      const theta = -spec.sectorRad / 2 + (spec.sectorRad * (li + 0.5)) / spec.lines;
      this.renderLine(ctx, theta, li, li * spec.samples, this.re, this.im, out.structure, out.transmission, out.tissue);
    }
    formEnvelope(this.re, this.im, spec.lines, spec.samples, this.kernels(scene, spec), out.amplitude, this.tmpRe, this.tmpIm);
    this.lastMs = performance.now() - t0;
    this.lastSamples = n;
  }

  /** Kernels and level scales of an M-mode line of `samples` samples drawn under the frame geometry `frame` (decision 84). */
  lineKernels(scene: Scene, frame: PolarFrameSpec, samples: number): LineKernels {
    const { frequencyMHz, harmonics } = scene.physics;
    const bw = scene.physics.beamWidth ?? 0;
    if (!this.linePsf || this.linePsf.key !== lineKernelKey(frame, samples, frequencyMHz, harmonics, bw)) this.linePsf = buildLineKernels(frame, samples, frequencyMHz, harmonics, bw);
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
  renderMmodeLine(scene: Scene, beam: BeamFrame, frame: PolarFrameSpec, samples: number, theta: number, pulse: number, amp: Float32Array, st: Uint8Array, tr: Float32Array, ti: Uint8Array): void {
    if (this.lineRe.length !== samples) {
      this.lineRe = new Float32Array(samples);
      this.lineIm = new Float32Array(samples);
      this.lineTmpRe = new Float32Array(samples);
      this.lineTmpIm = new Float32Array(samples);
      this.lineSigma = new Float32Array(samples);
      this.lineAcross = new Float32Array(samples);
      this.lineElevation = new Float32Array(samples);
      this.lineAlong = new Float32Array(samples);
    }
    this.lineSigma.fill(0);
    const spec: PolarFrameSpec = { ...frame, samples, elevationSamples: 1 };
    const k = this.lineKernels(scene, frame, samples);
    const ctx = this.prepare(scene, beam, spec);
    const ct = Math.cos(theta),
      sn = Math.sin(theta);
    const hf = scene.heart.frame;
    const lat = { x: beam.lateral.x * ct - beam.forward.x * sn, y: beam.lateral.y * ct - beam.forward.y * sn, z: beam.lateral.z * ct - beam.forward.z * sn };
    const fwd = { x: beam.forward.x * ct + beam.lateral.x * sn, y: beam.forward.y * ct + beam.lateral.y * sn, z: beam.forward.z * ct + beam.lateral.z * sn };
    const fH = torsoToHeartDir(hf, fwd),
      lH = torsoToHeartDir(hf, lat),
      nH = torsoToHeartDir(hf, beam.normal);
    ctx.line = {
      kernels: k,
      torsoAxes: [fwd.x, fwd.y, fwd.z, lat.x, lat.y, lat.z, beam.normal.x, beam.normal.y, beam.normal.z],
      heartAxes: [fH.x, fH.y, fH.z, lH.x, lH.y, lH.z, nH.x, nH.y, nH.z],
      frameSampleShare: frame.samples / samples,
      // 2.7 cells per pulse: value noise is uncorrelated beyond two cells
      bloodCells: (pulse % 4096) * 2.7,
      sigma: this.lineSigma,
      across: this.lineAcross,
      elevation: this.lineElevation,
      along: this.lineAlong,
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
      along = this.lineAlong;
    const [, pathY, pathZ] = LINE_LATTICE_PATH;
    for (let a = 0; a < samples; ) {
      let b = a + 1;
      while (b < samples && st[b] === st[a] && ti[b] === ti[a]) b++;
      const centre = (a + b) / 2;
      const offset = st[a]! * 7.31 + ti[a]! * 3.17;
      for (let i = a; i < b; i++) {
        const sg = sigma[i]!;
        if (sg === 0) continue;
        const u = Number.isNaN(along[i]!) ? (i + 0.5 - centre) * dr * SCATTER_FREQ : along[i]! * SCATTER_FREQ;
        const qx = u + offset,
          qy = across[i]! + u * pathY!,
          qz = elev[i]! + u * pathZ!;
        re[i] = re[i]! + sg * (latticeNoise3(qx, qy, qz, latA) + latticeNoise3(qx * R + 37.3, qy * R + 11.9, qz * R + 23.7, latB) - 1) * PHASOR_NORM;
        im[i] = im[i]! + sg * (latticeNoise3(qx + 71.1, qy + 53.5, qz + 5.3, latC) + latticeNoise3(qx * R + 17.9, qy * R + 91.1, qz * R + 43.3, latA) - 1) * PHASOR_NORM;
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
      fAtten: f * (harm ? 1.2 : 1),
      seed: physics.seed,
      harm,
      clutter: (physics.clutterLevel * 2.5 + physics.windowAttenuation * 0.8) * (harm ? 0.35 : 1) * Math.sqrt(2.5 / f),
      contact: contactQuality(beam.contact),
      fwdH: torsoToHeartDir(hf, beam.forward),
      latH: torsoToHeartDir(hf, beam.lateral),
      windowAttenuation: physics.windowAttenuation,
      thorax,
      latA: noiseLattice(physics.seed),
      latB: noiseLattice(physics.seed ^ 0x2545f491),
      latC: noiseLattice(physics.seed ^ 0x51),
      line: null,
    };
  }

  private renderLine(ctx: LineContext, theta: number, li: number, base: number, re: Float32Array, im: Float32Array, st: Uint8Array, tr: Float32Array, ti: Uint8Array): void {
    const { beam, spec, dr, fAtten, seed, harm, clutter, contact, fwdH, latH, thorax, latA, latB, latC, line } = ctx;
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
        return 1;
      }
      const hx = (px - hf.origin.x) * hf.ex.x + (py - hf.origin.y) * hf.ex.y + (pz - hf.origin.z) * hf.ex.z;
      const hy = (px - hf.origin.x) * hf.ey.x + (py - hf.origin.y) * hf.ey.y + (pz - hf.origin.z) * hf.ey.z;
      const hz = (px - hf.origin.x) * hf.ez.x + (py - hf.origin.y) * hf.ez.y + (pz - hf.origin.z) * hf.ez.z;
      if (classifyHeart(heart, heartPose, hx, hy, hz, q)) return 2;
      return classifyThorax(thorax, px, py, pz, q) ? 1 : 0;
    };
    /** Incoherent backscatter σ and coherent specular echo of a classified sample, before attenuation. */
    const acoustic = (q: TissueSample, inH: boolean, a: { sigma: number; spec: number }): void => {
      const props = TISSUE_PROPS[q.tissue]!;
      const nd = Math.abs(inH ? q.nx * dhx + q.ny * dhy + q.nz * dhz : q.nx * dx + q.ny * dy + q.nz * dz);
      let sigma = props.reflect;
      if (q.tissue === Tissue.Blood && harm) sigma *= 0.6;
      // myocardial backscatter is strongest with the beam across the fibres (perpendicular to the wall)
      if (q.tissue === Tissue.Myocardium) sigma *= MYO_ANISO_FLOOR + (1 - MYO_ANISO_FLOOR) * nd * nd;
      const het = heteroDb(q.tissue);
      if (het > 0) sigma *= Math.pow(10, ((latticeNoise3(q.mx * HETERO_FREQ + 5.3, q.my * HETERO_FREQ + 1.7, q.mz * HETERO_FREQ + 9.1, latC) - 0.5) * het) / 20);
      if (q.extraReflect > 0) sigma += q.extraReflect * 1.5 * (0.6 + 0.8 * latticeNoise3(q.mx * 6 + 3.3, q.my * 6 + 1.1, q.mz * 6 + 9.2, latB));
      let specular = 0;
      // the interface echo belongs to the sample the interface crosses (distance along the line < one sample)
      if (props.specular > 0 && Math.abs(q.sdf) < Math.max(nd, SPECULAR_WINDOW_MIN) * dr) specular = props.specular * SPECULAR_GAIN * nd * nd * nd * nd * (harm ? SPECULAR_HARMONIC : 1);
      a.sigma = sigma;
      a.spec = specular;
    };
    for (let si = 0; si < samples; si++) {
      const r = (si + 0.5) * dr;
      const idx = base + si;
      if (dead) {
        const d = r - lungEntryR;
        const period = Math.max(lungEntryR, 0.4);
        const k = d / period;
        const frac = k - Math.floor(k);
        const band = Math.exp(-Math.pow((Math.min(frac, 1 - frac) * period) / 0.12, 2));
        const decay = Math.pow(0.55, Math.floor(k) + 1);
        const nn = 0.4 + 0.6 * latticeNoise3(li * 0.7, r * 4, 3.1, latC);
        const a = lungEntryT * (band * decay * 0.9 + 0.02 * decay * nn);
        // reverberation energy is incoherent: a phasor tied to the line and the depth
        const px2 = li * 0.9,
          pr = r * SCATTER_FREQ;
        re[idx] = a * (latticeNoise3(px2, pr, 17.3, latA) + latticeNoise3(px2 + 5.1, pr * R + 2.3, 29.9, latB) - 1) * PHASOR_NORM * incAxial;
        im[idx] = a * (latticeNoise3(px2 + 9.7, pr + 13.1, 41.3, latC) + latticeNoise3(px2 + 3.3, pr * R + 7.7, 53.9, latA) - 1) * PHASOR_NORM * incAxial;
        st[idx] = Structure.Lung;
        tr[idx] = 0;
        ti[idx] = Tissue.Lung;
        continue;
      }
      const px = ox + dx * r,
        py = oy + dy * r,
        pz = oz + dz * r;
      const kind = classifyAt(px, py, pz, s);
      if (kind === 0) {
        re[idx] = 0;
        im[idx] = 0;
        st[idx] = Structure.None;
        tr[idx] = transmission;
        ti[idx] = Tissue.None;
        continue;
      }
      const inHeart = kind === 2;
      const tissue = s.tissue;
      const props = TISSUE_PROPS[tissue]!;
      st[idx] = s.structure;
      tr[idx] = transmission;
      ti[idx] = tissue;
      if (tissue === Tissue.Lung) {
        // pleural line: a strong coherent reflector; everything behind it is reverberation
        lungEntryR = r;
        lungEntryT = transmission;
        re[idx] = transmission * (1.2 + 0.4 * latticeNoise3(li * 0.8, r * 3, 1, latA));
        if (lk) re[idx] = re[idx]! * lk.single;
        im[idx] = 0;
        dead = true;
        continue;
      }
      acoustic(s, inHeart, acA);
      let sigma = acA.sigma;
      let specular = acA.spec;
      if (nElev > 1) {
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
      // complex scatterer phasor of the central plane, anchored in tissue coordinates (moves with the tissue)
      const qx = s.mx * SCATTER_FREQ,
        qy = s.my * SCATTER_FREQ,
        qz = s.mz * SCATTER_FREQ;
      let sRe: number, sIm: number;
      if (line && lk) {
        // M-mode line (decision 84): the lattice axes follow the beam, with the beam width as the cell across it; the
        // coordinate along the beam is set per structure after the march (`renderMmodeLine`), so only σ is kept here
        const a = inHeart ? line.heartAxes : line.torsoAxes;
        line.along[si] = inHeart ? NaN : s.mx * a[0]! + s.my * a[1]! + s.mz * a[2]!;
        line.across[si] = (s.mx * a[3]! + s.my * a[4]! + s.mz * a[5]!) * lk.lateralCells[si]!;
        line.elevation[si] = (s.mx * a[6]! + s.my * a[7]! + s.mz * a[8]!) * lk.elevationCells[si]! + (tissue === Tissue.Blood ? line.bloodCells : 0);
        line.sigma[si] = sigma * inc * transmission;
        sRe = specular * lk.specular;
        sIm = 0;
      } else {
        const zr = (latticeNoise3(qx, qy, qz, latA) + latticeNoise3(qx * R + 37.3, qy * R + 11.9, qz * R + 23.7, latB) - 1) * PHASOR_NORM;
        const zi = (latticeNoise3(qx + 71.1, qy + 53.5, qz + 5.3, latC) + latticeNoise3(qx * R + 17.9, qy * R + 91.1, qz * R + 43.3, latA) - 1) * PHASOR_NORM;
        sRe = sigma * zr + specular;
        sIm = sigma * zi;
      }
      if (r < 4.5 && clutter > 0) {
        // near-field clutter: reverberation in the chest wall under the footprint, incoherent, fixed to the probe position
        const cm = clutter * Math.exp(-r / 1.8) * (0.15 + 0.5 * latticeNoise3(ox * 6 + li * 0.7, oy * 6 + oz * 6, r * 5, latC));
        const cx = ox * 25 + li * 0.9,
          cy = oy * 25 + oz * 25,
          cz = r * SCATTER_FREQ;
        sRe += cm * (latticeNoise3(cx + 3.1, cy, cz, latA) + latticeNoise3(cx * R + 8.3, cy + 1.9, cz * R, latB) - 1) * PHASOR_NORM * incAxial;
        sIm += cm * (latticeNoise3(cx + 61.7, cy + 5.5, cz + 3.3, latC) + latticeNoise3(cx * R + 21.1, cy + 44.4, cz * R + 9.9, latA) - 1) * PHASOR_NORM * incAxial;
      }
      if (r < 0.35) sRe += lk ? 0.6 * (1 - r / 0.35) * lk.smooth : 0.6 * (1 - r / 0.35); // transducer ring-down
      re[idx] = sRe * transmission;
      im[idx] = sIm * transmission;
      let attenNp = 0.23 * props.attenuation * fAtten * dr;
      // bone and calcium stop the beam within a frame sample; a finer M-mode line spreads the same loss over its samples
      if (tissue === Tissue.Bone || tissue === Tissue.Calcium || tissue === Tissue.Spine) attenNp = line ? 1.2 * line.frameSampleShare : 1.2;
      else if (s.extraReflect > 0.4) attenNp += 0.09 * s.extraReflect * (dr / 0.07); // calcified tissue ≈ 10 dB/cm at 2.5 MHz
      if (!inHeart && (tissue === Tissue.Fat || tissue === Tissue.Muscle || tissue === Tissue.Skin)) attenNp *= 1 + 1.5 * ctx.windowAttenuation;
      transmission *= Math.exp(-attenNp);
      if (transmission < 1e-4) transmission = 1e-4;
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
  windowAttenuation: number;
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
    /** Line sample length over frame sample length. */
    frameSampleShare: number;
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
  } | null;
}

function torsoToHeartDir(f: { ex: { x: number; y: number; z: number }; ey: { x: number; y: number; z: number }; ez: { x: number; y: number; z: number } }, d: { x: number; y: number; z: number }) {
  return {
    x: d.x * f.ex.x + d.y * f.ex.y + d.z * f.ex.z,
    y: d.x * f.ey.x + d.y * f.ey.y + d.z * f.ey.z,
    z: d.x * f.ez.x + d.y * f.ez.y + d.z * f.ez.z,
  };
}
