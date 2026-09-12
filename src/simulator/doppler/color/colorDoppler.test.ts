import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { Tissue } from '@/simulator/anatomy/tissue';
import type { SimInput } from '@/simulator/core/protocol';
import { SimulatorCore } from '@/simulator/core/simulatorCore';
import { DEFAULT_SPECTRAL } from '@/simulator/doppler/spectral/spectrum';
import { buildScanLut, computeSectorMapping, type ScanLut } from '@/simulator/renderer/scanConvert';
import { allocPolarFrame, DEFAULT_ACQUISITION, type PolarFrameSpec } from '@/simulator/renderer/types';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import { allocColorField, computeColorField, DEFAULT_COLOR, overlayColorField, type ColorField, type ColorSettings } from './colorDoppler';

// synthetic frame: blood everywhere with full transmission, so every sample inside the colour box gets colour
const spec: PolarFrameSpec = { lines: 24, samples: 64, sectorRad: 1.2, depthCm: 16, elevationSamples: 1, focusCm: 8 };
const frame = allocPolarFrame(spec);
frame.tissue.fill(Tissue.Blood);
frame.transmission.fill(1);

/** One colour update of the synthetic frame with a uniform axial velocity (m/s, below Nyquist) and dispersion. */
function update(persistence: number, prev: ColorField | null, v: number, disp: number): ColorField {
  const out = allocColorField(spec.lines * spec.samples);
  computeColorField(
    frame,
    { ...DEFAULT_COLOR, persistence },
    prev,
    (_idx, _li, _si, o) => {
      o.v = v;
      o.disp = disp;
      o.present = 1;
    },
    out,
  );
  return out;
}

const colored = (f: ColorField): number[] => Array.from(f.vel.keys()).filter((i) => !Number.isNaN(f.vel[i]!));

describe('colour Doppler persistence (decision 56)', () => {
  it('persistence 0.5: the second field blends its raw velocity and variance with the first field', () => {
    const first = update(0.5, null, 0.2, 0.1); // variance 1.6 · 0.1 = 0.16
    const second = update(0.5, first, 0.5, 0.4); // raw variance 0.64
    const idx = colored(first);
    expect(idx.length).toBeGreaterThan(100);
    expect(colored(second)).toEqual(idx);
    for (const i of idx) {
      expect(second.vel[i]).toBeCloseTo(0.5 * 0.5 + 0.5 * 0.2, 5);
      expect(second.variance[i]).toBeCloseTo(0.5 * 0.64 + 0.5 * 0.16, 5);
      expect(first.vel[i]).toBeCloseTo(0.2, 5); // the previous field is only read
    }
  });

  it('persistence 0: the second field is the raw second field', () => {
    const first = update(0, null, 0.2, 0.1);
    const second = update(0, first, 0.5, 0.4);
    const raw = update(0, null, 0.5, 0.4);
    expect(colored(second).length).toBeGreaterThan(100);
    expect(second.vel[colored(second)[0]!]).toBeCloseTo(0.5, 5);
    expect(second.vel).toEqual(raw.vel);
    expect(second.variance).toEqual(raw.variance);
  });
});

const W = 320;
const H = 260;

/** Colour-mode input (built here: importing `baseInput` from simulatorCore.test would run that file's tests here too). */
function colorInput(persistence: number, over: Partial<SimInput> = {}): SimInput {
  return {
    probe: { u: 3.4, v: 0.4, rotationDeg: 25, tiltDeg: 6, rockDeg: -4, pressure: 0.55 },
    patient: { position: 'left-lateral', respiration: 'expiration', headElevationDeg: 0 },
    settings: { ...DEFAULT_ACQUISITION, tgcDb: [...DEFAULT_ACQUISITION.tgcDb] },
    modality: 'color',
    frozen: false,
    cineOffset: 0,
    color: { ...DEFAULT_COLOR, persistence },
    spectral: { ...DEFAULT_SPECTRAL },
    cursorThetaRad: 0,
    gateDepthCm: 9,
    quality: 'low',
    display: { width: W, height: H },
    rendererBackend: 'procedural',
    artifactOverrides: null,
    ...over,
  };
}

/**
 * Red minus blue of every pixel of the colour overlay alone. The overlay adds the same grey level to both
 * channels, so this difference survives compositing (up to rounding) and says which colour field a composite shows.
 */
function redMinusBlue(field: ColorField, lut: ScanLut, c: ColorSettings): Int16Array {
  const rgba = new Uint8ClampedArray(W * H * 4);
  overlayColorField(rgba, lut, field.vel, field.variance, c);
  const d = new Int16Array(W * H);
  for (let q = 0, o = 0; q < d.length; q++, o += 4) d[q] = (rgba[o] ?? 0) - (rgba[o + 2] ?? 0);
  return d;
}

const coloredSamples = (f: ColorField): number => f.vel.reduce((n, v) => (Number.isNaN(v) ? n : n + 1), 0);

/** Samples where two fields disagree (NaN counts as a value). */
function fieldDiff(a: ColorField, b: ColorField): number {
  let n = 0;
  for (let s = 0; s < a.vel.length; s++) {
    const x = a.vel[s]!;
    const y = b.vel[s]!;
    if (Number.isNaN(x) !== Number.isNaN(y) || (!Number.isNaN(x) && x !== y)) n++;
  }
  return n;
}

const copyField = (f: ColorField): ColorField => ({ vel: new Float32Array(f.vel), variance: new Float32Array(f.variance), power: new Float32Array(0) });

/** Samples where blending with `before` would change the raw field: only there can a missing reset be seen. */
function wouldBlend(before: ColorField, rawNow: ColorField, minDelta = 0.002): number {
  let n = 0;
  for (let s = 0; s < Math.min(before.vel.length, rawNow.vel.length); s++) {
    const a = before.vel[s]!;
    const b = rawNow.vel[s]!;
    if (!Number.isNaN(a) && !Number.isNaN(b) && Math.abs(a - b) > minDelta) n++;
  }
  return n;
}

describe('colour persistence through SimulatorCore (decision 56)', () => {
  it('blends every update with the previous field, shows the latest one, and resets on modality and spec changes', { timeout: 120_000 }, () => {
    const c = loadCaseById('normal-excellent-window');
    const p = 0.5;
    // identical cores and steps: the one without persistence yields the raw field of every update
    const raw = new SimulatorCore(c, colorInput(0));
    const kept = new SimulatorCore(c, colorInput(p));
    const probe = canonicalControl(getViewTarget('a4c'), kept.models.heart, kept.models.thorax);
    raw.setInput(colorInput(0, { probe }));
    kept.setInput(colorInput(p, { probe }));
    const settings = { ...DEFAULT_COLOR, persistence: p };
    const live: Uint8Array[] = [];
    let lut: ScanLut | null = null;
    let prev: ColorField | null = null;
    let version = 0;
    let updates = 0;
    let blended = 0;
    let mismatches = 0;
    let discriminating = 0;
    let wrongField = 0;
    for (let i = 0; i < 40 && updates < 6; i++) {
      const outRaw = raw.step(0.1);
      const out = kept.step(0.1);
      expect(Boolean(out)).toBe(Boolean(outRaw));
      if (!out) continue;
      live.push(new Uint8Array(out.rgba));
      const r = raw.lastColorField;
      const k = kept.lastColorField;
      expect(k.version).toBe(r.version);
      if (k.version === version) continue; // no colour update on this frame
      expect(k.version).toBe(version + 1); // the GPU present pass uploads the field when the version changes
      version = k.version;
      updates++;
      const { vel: rv, variance: rs } = r.field!;
      const { vel: kv, variance: ks } = k.field!;
      for (let s = 0; s < kv.length; s++) {
        const vPrev = prev ? prev.vel[s]! : NaN;
        const both = !Number.isNaN(rv[s]!) && !Number.isNaN(vPrev);
        const ev = both ? rv[s]! * (1 - p) + vPrev * p : rv[s]!;
        const es = both ? rs[s]! * (1 - p) + prev!.variance[s]! * p : rs[s]!;
        const velOk = Number.isNaN(ev) ? Number.isNaN(kv[s]!) : Math.abs(kv[s]! - ev) < 1e-5;
        if (!velOk || !(Math.abs(ks[s]! - es) < 1e-5)) mismatches++;
        if (both && Math.abs(rv[s]! - vPrev) > 0.05) blended++;
      }
      // the composite must show the field of this update, not the one before it
      if (prev) {
        const fspec = kept.lastFrame!.spec;
        lut ??= buildScanLut(fspec, computeSectorMapping(fspec, W, H, DEFAULT_ACQUISITION.invertLR, DEFAULT_ACQUISITION.zoom));
        const now = redMinusBlue(k.field!, lut, settings);
        const before = redMinusBlue(prev, lut, settings);
        const px = live[live.length - 1]!;
        for (let q = 0, o = 0; q < now.length; q++, o += 4) {
          if (Math.abs(now[q]! - before[q]!) <= 30) continue; // this pixel cannot tell the two fields apart
          discriminating++;
          if (Math.abs(px[o]! - px[o + 2]! - now[q]!) > 2) wrongField++;
        }
      }
      prev = { vel: new Float32Array(kv), variance: new Float32Array(ks), power: new Float32Array(0) };
    }
    expect(updates).toBe(6);
    expect(mismatches).toBe(0);
    expect(blended).toBeGreaterThan(100);
    expect(discriminating).toBeGreaterThan(100);
    expect(wrongField).toBe(0);
    // freezing reviews the cine: each frame must show the colour its live composite showed
    let coloredPixels = 0;
    for (let j = 0; j < live.length; j++) {
      kept.setInput(colorInput(p, { probe, frozen: true, cineOffset: j - (live.length - 1) }));
      const a = live[j]!;
      const b = new Uint8Array(kept.step(0.1)!.rgba);
      expect(b.length).toBe(a.length);
      let differing = 0;
      for (let o = 0; o < a.length; o++) if (a[o] !== b[o]) differing++;
      expect(differing).toBe(0);
      for (let o = 0; o < a.length; o += 4) if (a[o] !== a[o + 1] || a[o + 1] !== a[o + 2]) coloredPixels++;
    }
    expect(coloredPixels).toBeGreaterThan(1000);
    // the two resets: the first update after them is raw, because there is no previous field to blend.
    // short steps keep the phase near the one that has flow, so the comparison is not made on an empty field.
    const nextUpdate = (dt: number, over: Partial<SimInput> = {}): { kept: ColorField; raw: ColorField } => {
      raw.setInput(colorInput(0, { probe, ...over }));
      kept.setInput(colorInput(p, { probe, ...over }));
      const v0 = kept.lastColorField.version;
      for (let i = 0; i < 40 && kept.lastColorField.version === v0; i++) {
        raw.step(dt);
        kept.step(dt);
      }
      expect(kept.lastColorField.version).toBe(v0 + 1);
      expect(raw.lastColorField.version).toBe(kept.lastColorField.version);
      // copies: the core keeps writing into those two buffers as it steps
      return { kept: copyField(kept.lastColorField.field!), raw: copyField(raw.lastColorField.field!) };
    };
    // unfreeze and stop at an update with flow in the box: how much colour there is depends on the cardiac phase
    let flow = nextUpdate(0.1);
    for (let i = 0; i < 12 && coloredSamples(flow.raw) < 200; i++) flow = nextUpdate(0.1);
    expect(coloredSamples(flow.raw)).toBeGreaterThan(200);
    // four attempts at different phases: a single one can land where the box holds almost no flow
    const withDepth = (depthCm: number) => ({ ...DEFAULT_ACQUISITION, tgcDb: [...DEFAULT_ACQUISITION.tgcDb], depthCm });
    let depth = DEFAULT_ACQUISITION.depthCm;
    let before = flow.kept;
    let observableModality = 0;
    let observableSpec = 0;
    for (let attempt = 0; attempt < 4; attempt++) {
      // modality: colour → 2D → colour, at the current depth
      raw.setInput(colorInput(0, { probe, modality: '2d', settings: withDepth(depth) }));
      kept.setInput(colorInput(p, { probe, modality: '2d', settings: withDepth(depth) }));
      raw.step(0.02);
      kept.step(0.02);
      const afterModality = nextUpdate(0.02, { settings: withDepth(depth) });
      expect(fieldDiff(afterModality.kept, afterModality.raw)).toBe(0);
      observableModality += wouldBlend(before, afterModality.raw);
      // polar spec: the other depth re-allocates the frame and both colour buffers
      depth = depth === 16 ? 13 : 16;
      const afterSpec = nextUpdate(0.02, { settings: withDepth(depth) });
      const fspec = kept.lastFrame!.spec;
      expect(fspec.depthCm).toBe(depth);
      expect(afterSpec.kept.vel.length).toBe(fspec.lines * fspec.samples);
      expect(fieldDiff(afterSpec.kept, afterSpec.raw)).toBe(0);
      observableSpec += wouldBlend(afterModality.kept, afterSpec.raw);
      before = afterSpec.kept;
    }
    // without the resets those fields would have been blended with the previous one
    expect(observableModality).toBeGreaterThan(50);
    expect(observableSpec).toBeGreaterThan(50);
  });
});
