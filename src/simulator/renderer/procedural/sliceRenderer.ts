import type { BeamFrame } from '@/simulator/probe/pose';
import type { PolarFrame, PolarFrameSpec, RendererBackend, Scene } from '../types';
import { classifyHeart } from '@/simulator/anatomy/heartModel';
import { classifyThorax, isAnteriorLung } from '@/simulator/anatomy/thoraxModel';
import { makeSample, TISSUE_PROPS, Tissue, Structure } from '@/simulator/anatomy/tissue';
import { latticeNoise3, noiseLattice } from '@/core/noise';
import { hash3 } from '@/core/random';
import { contactQuality } from '@/simulator/probe/pose';

/**
 * Procedural slice renderer: marches every scanline through the parametric thorax + heart model.
 * Physics is deliberately reduced to what teaches (spec 7, 82): tissue-dependent backscatter +
 * tissue-attached speckle, specular interfaces (∝ |n·d|³), two-way frequency-dependent attenuation,
 * shadowing behind bone/calcium, pleural reverberation (A-lines at multiples of the pleural depth),
 * partial coupling dropout and near-field clutter. No wave propagation, no RF.
 *
 * Output amplitude is linear and *pre-console*: gain/TGC/compression/persistence are applied later
 * so every console control remains causal on this same frame.
 */
export class ProceduralSliceRenderer implements RendererBackend {
  readonly id = 'procedural' as const;
  private sample = makeSample();
  private lastMs = 0;
  private lastSamples = 0;

  stats(): Record<string, number | string> {
    return { renderMs: Number(this.lastMs.toFixed(2)), samplesPerFrame: this.lastSamples };
  }
  dispose(): void {}

  render(scene: Scene, beam: BeamFrame, spec: PolarFrameSpec, _phase: number, out: PolarFrame): void {
    const t0 = performance.now();
    const ctx = this.prepare(scene, beam, spec);
    for (let li = 0; li < spec.lines; li++) {
      const theta = -spec.sectorRad / 2 + (spec.sectorRad * (li + 0.5)) / spec.lines;
      this.renderLine(ctx, theta, li, li * spec.samples, out.amplitude, out.structure, out.transmission, out.tissue);
    }
    this.lastMs = performance.now() - t0;
    this.lastSamples = spec.lines * spec.samples;
  }

  /** Render one scanline at angle theta (rad) into the given arrays at offset `base`. Used by M-mode. */
  renderSingleLine(scene: Scene, beam: BeamFrame, spec: PolarFrameSpec, theta: number, amp: Float32Array, st: Uint8Array, tr: Float32Array, ti: Uint8Array): void {
    const ctx = this.prepare(scene, beam, spec);
    const li = Math.round(((theta + spec.sectorRad / 2) / spec.sectorRad) * spec.lines);
    this.renderLine(ctx, theta, li, 0, amp, st, tr, ti);
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
      grainLatScale: Math.sqrt(f / 2.5),
      grainAxScale: (f / 2.5) * 2.2 * (harm ? 1.25 : 1),
      seed: physics.seed,
      harm,
      clutter: (physics.clutterLevel * 2.5 + physics.windowAttenuation * 0.8) * (harm ? 0.35 : 1) * Math.sqrt(2.5 / f),
      contact: contactQuality(beam.contact),
      fwdH: torsoToHeartDir(hf, beam.forward),
      latH: torsoToHeartDir(hf, beam.lateral),
      norH: torsoToHeartDir(hf, beam.normal),
      windowAttenuation: physics.windowAttenuation,
      thorax,
      latA: noiseLattice(physics.seed),
      latB: noiseLattice(physics.seed ^ 0x2545f491),
      latC: noiseLattice(physics.seed ^ 0x51),
    };
  }

  private renderLine(ctx: LineContext, theta: number, li: number, base: number, amp: Float32Array, st: Uint8Array, tr: Float32Array, ti: Uint8Array): void {
    const { beam, spec, dr, fAtten, grainLatScale, grainAxScale, seed, harm, clutter, contact, fwdH, latH, norH, thorax, latA, latB, latC } = ctx;
    const { heart, heartPose } = ctx.scene;
    const hf = heart.frame;
    const s = this.sample;
    const samples = spec.samples;
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
    const lhx = latH.x * ct - fwdH.x * sn,
      lhy = latH.y * ct - fwdH.y * sn,
      lhz = latH.z * ct - fwdH.z * sn;
    const tlx = beam.lateral.x * ct - beam.forward.x * sn,
      tly = beam.lateral.y * ct - beam.forward.y * sn,
      tlz = beam.lateral.z * ct - beam.forward.z * sn;
    const lineDrop = hash3(li, 7, 0, seed) > contact ? 0.08 : 1;
    let transmission = lineDrop;
    let lungEntryR = -1;
    let lungEntryT = 0;
    let dead = false;
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
        const n = 0.4 + 0.6 * latticeNoise3(li * 0.7, r * 4, 3.1, latC);
        amp[idx] = lungEntryT * (band * decay * 0.9 + 0.06 * decay * n);
        st[idx] = Structure.Lung;
        tr[idx] = 0;
        ti[idx] = Tissue.Lung;
        continue;
      }
      const px = ox + dx * r,
        py = oy + dy * r,
        pz = oz + dz * r;
      const hx = (px - hf.origin.x) * hf.ex.x + (py - hf.origin.y) * hf.ex.y + (pz - hf.origin.z) * hf.ex.z;
      const hy = (px - hf.origin.x) * hf.ey.x + (py - hf.origin.y) * hf.ey.y + (pz - hf.origin.z) * hf.ey.z;
      const hz = (px - hf.origin.x) * hf.ez.x + (py - hf.origin.y) * hf.ez.y + (pz - hf.origin.z) * hf.ez.z;
      // lung interposed between chest wall and heart occludes everything behind it
      let inHeart = false;
      let inBody = true;
      if (isAnteriorLung(thorax, px, py, pz)) {
        s.tissue = Tissue.Lung;
        s.structure = Structure.Lung;
        s.sdf = -1;
        s.nx = 0;
        s.ny = 0;
        s.nz = 1;
        s.mx = px;
        s.my = py;
        s.mz = pz;
        s.extraReflect = 0;
      } else {
        inHeart = classifyHeart(heart, heartPose, hx, hy, hz, s);
        if (!inHeart) inBody = classifyThorax(thorax, px, py, pz, s);
      }
      if (!inBody) {
        amp[idx] = 0;
        st[idx] = Structure.None;
        tr[idx] = transmission;
        ti[idx] = Tissue.None;
        continue;
      }
      const tissue = s.tissue;
      const props = TISSUE_PROPS[tissue]!;
      let u: number, v: number, w: number;
      if (inHeart) {
        u = s.mx * lhx + s.my * lhy + s.mz * lhz;
        v = s.mx * norH.x + s.my * norH.y + s.mz * norH.z;
        w = s.mx * dhx + s.my * dhy + s.mz * dhz;
      } else {
        u = s.mx * tlx + s.my * tly + s.mz * tlz;
        v = s.mx * beam.normal.x + s.my * beam.normal.y + s.mz * beam.normal.z;
        w = s.mx * dx + s.my * dy + s.mz * dz;
      }
      const gl = props.grain * grainLatScale;
      const ga = props.grain * grainAxScale;
      const n1 = latticeNoise3(u * gl, v * gl, w * ga, latA);
      const n2 = latticeNoise3(u * gl * 2.1 + 11.7, v * gl * 2.1 + 3.3, w * ga * 2.1 + 7.9, latB);
      const spk = (n1 * 0.6 + n2 * 0.4) * 2;
      const speckle = spk * spk * 0.8 + 0.2;
      let reflect = props.reflect;
      if (tissue === Tissue.Blood && harm) reflect *= 0.6;
      let echo = reflect * speckle;
      if (props.specular > 0) {
        const ad = Math.abs(inHeart ? s.nx * dhx + s.ny * dhy + s.nz * dhz : s.nx * dx + s.ny * dy + s.nz * dz);
        const fall = Math.max(0, 1 - Math.abs(s.sdf) / 0.16);
        echo += props.specular * ad * ad * ad * fall * (harm ? 1.25 : 1.0) * 1.35;
      }
      if (s.extraReflect > 0) echo += s.extraReflect * 1.5 * (0.6 + 0.8 * latticeNoise3(u * 6 + 3.3, v * 6 + 1.1, w * 6 + 9.2, latB));
      if (r < 4.5 && clutter > 0) {
        const cn = latticeNoise3(px * 2.3, py * 2.3, r * 5.0, latC);
        echo += clutter * Math.exp(-r / 1.8) * (0.15 + 0.5 * cn);
      }
      if (r < 0.35) echo += 0.6 * (1 - r / 0.35);
      amp[idx] = echo * transmission;
      st[idx] = s.structure;
      tr[idx] = transmission;
      ti[idx] = tissue;
      if (tissue === Tissue.Lung) {
        lungEntryR = r;
        lungEntryT = transmission;
        amp[idx] = transmission * (1.2 + 0.4 * latticeNoise3(li * 0.8, r * 3, 1, latA));
        dead = true;
        continue;
      }
      let attenNp = 0.23 * props.attenuation * fAtten * dr;
      if (tissue === Tissue.Bone || tissue === Tissue.Calcium || tissue === Tissue.Spine) attenNp = 1.2;
      else if (s.extraReflect > 0.4) attenNp += 0.09 * s.extraReflect * (dr / 0.07); // calcified tissue ≈ 10 dB/cm at 2.5 MHz: partial shadow, total only over long in-plane paths
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
  grainLatScale: number;
  grainAxScale: number;
  seed: number;
  harm: boolean;
  clutter: number;
  contact: number;
  fwdH: { x: number; y: number; z: number };
  latH: { x: number; y: number; z: number };
  norH: { x: number; y: number; z: number };
  windowAttenuation: number;
  thorax: Scene['thorax'];
  latA: Uint8Array;
  latB: Uint8Array;
  latC: Uint8Array;
}

function torsoToHeartDir(f: { ex: { x: number; y: number; z: number }; ey: { x: number; y: number; z: number }; ez: { x: number; y: number; z: number } }, d: { x: number; y: number; z: number }) {
  return {
    x: d.x * f.ex.x + d.y * f.ex.y + d.z * f.ex.z,
    y: d.x * f.ey.x + d.y * f.ey.y + d.z * f.ey.z,
    z: d.x * f.ez.x + d.y * f.ez.y + d.z * f.ez.z,
  };
}
