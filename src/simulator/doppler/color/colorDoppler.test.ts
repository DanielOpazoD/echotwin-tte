// @tier slow
import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { Tissue } from '@/simulator/anatomy/tissue';
import type { SimInput } from '@/simulator/core/protocol';
import { SimulatorCore } from '@/simulator/core/simulatorCore';
import { DEFAULT_SPECTRAL } from '@/simulator/doppler/spectral/spectrum';
import { buildScanLut, computeSectorMapping, type ScanLut } from '@/simulator/renderer/scanConvert';
import {
  allocPolarFrame,
  DEFAULT_ACQUISITION,
  type PolarFrameSpec,
} from '@/simulator/renderer/types';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import { aliasVelocity } from '@/clinical/formulas';
import { persistenceOverTime } from '@/simulator/renderer/postprocess/consolePipeline';
import {
  allocColorField,
  computeColorField,
  DEFAULT_COLOR,
  overlayColorField,
  wallFilterResponse,
  type ColorAcquisition,
  type ColorField,
  type ColorSettings,
} from './colorDoppler';

// synthetic frame: blood everywhere with full transmission, so every sample inside the colour box gets colour
const spec: PolarFrameSpec = {
  lines: 24,
  samples: 64,
  sectorRad: 1.2,
  depthCm: 16,
  elevationSamples: 1,
  focusCm: 8,
};
const frame = allocPolarFrame(spec);
frame.tissue.fill(Tissue.Blood);
frame.transmission.fill(1);

const ACQ: ColorAcquisition = { frequencyMHz: 2.5, harmonics: true };

/** One colour update of the synthetic frame with a uniform axial velocity (m/s) and dispersion. */
function update(
  persistence: number,
  prev: ColorField | null,
  v: number,
  disp: number,
  over: Partial<ColorSettings> = {},
  target = frame,
  acq = ACQ,
): ColorField {
  const out = allocColorField(spec.lines * spec.samples);
  computeColorField(
    target,
    { ...DEFAULT_COLOR, persistence, ...over },
    prev,
    (_idx, _li, _si, o) => {
      o.v = v;
      o.disp = disp;
      o.present = 1;
    },
    out,
    acq,
  );
  return out;
}

/**
 * Persistence as the autocorrelation the velocity comes from (decision 87): power-weighted phasors at the Doppler phase
 * of each velocity; the blended velocity is their angle.
 */
function circularBlend(
  p: number,
  v: number,
  pw: number,
  vPrev: number,
  pwPrev: number,
  c: ColorSettings = DEFAULT_COLOR,
): number {
  const a1 = (Math.PI * (v - c.baselineShiftMps)) / c.scaleMps;
  const a0 = (Math.PI * (vPrev - c.baselineShiftMps)) / c.scaleMps;
  const re = (1 - p) * pw * Math.cos(a1) + p * pwPrev * Math.cos(a0);
  const im = (1 - p) * pw * Math.sin(a1) + p * pwPrev * Math.sin(a0);
  return aliasVelocity(
    c.baselineShiftMps + (c.scaleMps * Math.atan2(im, re)) / Math.PI,
    c.scaleMps,
    c.baselineShiftMps,
  );
}

const colored = (f: ColorField): number[] =>
  Array.from(f.vel.keys()).filter((i) => !Number.isNaN(f.vel[i]!));

describe('the colour field is an estimate (decision 116)', () => {
  /** One estimated colour update (realization `r`) of a uniform flow whose expected colour power is `power` everywhere. */
  const estimated = (r: number, v: number, disp: number, power = 1): ColorField => {
    const f = allocPolarFrame(spec);
    f.tissue.fill(Tissue.Blood);
    // transmission relative to what soft tissue leaves at each depth for this acquisition (relativeTransmission)
    for (let li = 0; li < spec.lines; li++)
      for (let si = 0; si < spec.samples; si++)
        f.transmission[li * spec.samples + si] =
          power *
          Math.exp(
            -0.23 * 0.5 * ACQ.frequencyMHz * 1.2 * ((si + 0.5) / spec.samples) * spec.depthCm,
          );
    const out = allocColorField(spec.lines * spec.samples);
    computeColorField(
      f,
      {
        ...DEFAULT_COLOR,
        persistence: 0,
        boxRMinCm: 1,
        boxRMaxCm: 6,
        boxThetaMinRad: -0.6,
        boxThetaMaxRad: 0.6,
      },
      null,
      (_idx, _li, _si, o) => {
        o.v = v;
        o.disp = disp;
        o.present = 1;
      },
      out,
      ACQ,
      { realization: r, seed: 5 },
    );
    return out;
  };
  const inBox = (f: ColorField) => {
    const idx: number[] = [];
    for (let li = 0; li < spec.lines; li++)
      for (let si = 0; si < spec.samples; si++) {
        const rCm = ((si + 0.5) / spec.samples) * spec.depthCm;
        const th = -spec.sectorRad / 2 + (spec.sectorRad * (li + 0.5)) / spec.lines;
        if (rCm > 1.2 && rCm < 5.8 && Math.abs(th) < 0.55) idx.push(li * spec.samples + si);
      }
    return idx.map((i) => f.vel[i]!);
  };

  it('a steady laminar flow shows a velocity texture around its speed, and strong flow is not lost', () => {
    // The field was the expected velocity at every sample: a uniform 0.30 m/s flow drew one flat colour (standard deviation
    // 0) and a sample was coloured or not by an exact power threshold. The autocorrelation estimate of a short packet
    // scatters around the velocity, and the echo power of blood fluctuates with its speckle.
    const values = [0, 1, 2].flatMap((r) => inBox(estimated(r, 0.3, 0.04)));
    const shown = values.filter((x) => !Number.isNaN(x));
    const mean = shown.reduce((a, b) => a + b, 0) / shown.length;
    const sd = Math.sqrt(shown.reduce((a, b) => a + (b - mean) ** 2, 0) / shown.length);
    const report = `mean ${mean.toFixed(3)} sd ${sd.toFixed(3)} m/s, coloured ${((shown.length / values.length) * 100).toFixed(1)}%`;
    expect(Math.abs(mean - 0.3), report).toBeLessThan(0.01 * DEFAULT_COLOR.scaleMps);
    expect(sd / DEFAULT_COLOR.scaleMps, report).toBeGreaterThan(0.02);
    expect(sd / DEFAULT_COLOR.scaleMps, report).toBeLessThan(0.1);
    expect(shown.length / values.length, report).toBeGreaterThan(0.95);
  });

  it('a flow near the display threshold is partly coloured, and which samples changes from one update to the next', () => {
    // expected power 0.3 against a threshold of 0.25: every sample was coloured, in every update
    const a = inBox(estimated(0, 0.3, 0.04, 0.3));
    const b = inBox(estimated(1, 0.3, 0.04, 0.3));
    const fracA = a.filter((x) => !Number.isNaN(x)).length / a.length;
    let changed = 0;
    for (let i = 0; i < a.length; i++) if (Number.isNaN(a[i]!) !== Number.isNaN(b[i]!)) changed++;
    const report = `coloured ${(fracA * 100).toFixed(1)}%, changed between updates ${((changed / a.length) * 100).toFixed(1)}%`;
    expect(fracA, report).toBeGreaterThan(0.3);
    expect(fracA, report).toBeLessThan(0.85);
    expect(changed / a.length, report).toBeGreaterThan(0.1);
  });
});

describe('colour Doppler persistence (decisions 56 and 87)', () => {
  it('persistence 0.5: the second field blends its raw velocity and variance with the first field', () => {
    const first = update(0.5, null, 0.2, 0.1); // variance 1.6 · 0.1 = 0.16
    const second = update(0.5, first, 0.5, 0.4); // raw variance 0.64
    const idx = colored(first);
    expect(idx.length).toBeGreaterThan(100);
    expect(colored(second)).toEqual(idx);
    const w = DEFAULT_COLOR.wallFilterMps;
    for (const i of idx) {
      expect(second.vel[i]).toBeCloseTo(
        circularBlend(0.5, 0.5, wallFilterResponse(0.5, w), 0.2, wallFilterResponse(0.2, w)),
        5,
      );
      // two nearly equal powers well below Nyquist: the phasor angle is the linear mean
      expect(second.vel[i]).toBeCloseTo(0.35, 2);
      expect(second.variance[i]).toBeCloseTo(0.5 * 0.64 + 0.5 * 0.16, 5);
      expect(first.vel[i]).toBeCloseTo(0.2, 5); // the previous field is only read
    }
  });

  it('two flows either side of Nyquist stay near Nyquist instead of blending into a false slow flow', () => {
    // 0.60 m/s shows as +0.60; 0.64 m/s aliases to −0.60 with the 0.62 m/s scale
    const first = update(0.3, null, 0.6, 0.05);
    const second = update(0.3, first, 0.64, 0.05);
    const idx = colored(second);
    expect(idx.length).toBeGreaterThan(100);
    for (const i of idx) expect(Math.abs(second.vel[i]!)).toBeGreaterThan(0.55); // a linear blend gives −0.24
  });

  it('a history formed under another velocity scale is not blended', () => {
    // 0.5 m/s is stored as −0.3 on a 0.4 m/s scale: read as a phase of the 0.8 m/s scale it would pull the flow backwards
    const first = update(0.5, null, 0.5, 0.05, { scaleMps: 0.4 });
    const second = update(0.5, first, 0.5, 0.05, { scaleMps: 0.8 });
    const raw = update(0, null, 0.5, 0.05, { scaleMps: 0.8 });
    expect(colored(second).length).toBeGreaterThan(100);
    expect(second.vel).toEqual(raw.vel);
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

describe('colour signal power (decision 87)', () => {
  const depthFrame = (trans: (rCm: number) => number) => {
    const f = allocPolarFrame(spec);
    f.tissue.fill(Tissue.Blood);
    for (let li = 0; li < spec.lines; li++)
      for (let si = 0; si < spec.samples; si++)
        f.transmission[li * spec.samples + si] = trans(((si + 0.5) / spec.samples) * spec.depthCm);
    return f;
  };
  const deepestColoured = (f: ColorField): number => {
    let deepest = -1;
    for (let li = 0; li < spec.lines; li++)
      for (let si = 0; si < spec.samples; si++)
        if (!Number.isNaN(f.vel[li * spec.samples + si]!)) deepest = Math.max(deepest, si);
    return ((deepest + 0.5) / spec.samples) * spec.depthCm;
  };

  it('the shadow threshold follows the acquisition frequency: soft tissue at 3.5 MHz is not a shadow', () => {
    const acq: ColorAcquisition = { frequencyMHz: 3.5, harmonics: true };
    const softTissue = depthFrame((r) => Math.exp(-0.23 * 0.5 * 3.5 * 1.2 * r));
    const f = update(0, null, 0.5, 0.05, {}, softTissue, acq);
    // the box reaches 13 cm; with the attenuation expected at 2.5 MHz the deepest 5 cm went dark
    expect(deepestColoured(f)).toBeGreaterThan(12.5);
  });

  it('low colour gain loses attenuated flow before strong flow, and a real shadow has no colour at any gain', () => {
    const half = depthFrame((r) => (r < 9 ? 1 : 0.4) * Math.exp(-0.23 * 0.5 * 2.5 * 1.2 * r));
    const low = update(0, null, 0.5, 0.05, { gainDb: -6 }, half);
    const deep = deepestColoured(low);
    expect(deep).toBeLessThan(9); // 0.5 × 0.4 = 0.2 falls under the threshold beyond 9 cm
    expect(deep).toBeGreaterThan(8); // the unattenuated flow above stays
    const shadow = depthFrame((r) => (r < 9 ? 1 : 0.01) * Math.exp(-0.23 * 0.5 * 2.5 * 1.2 * r));
    expect(deepestColoured(update(0, null, 0.5, 0.05, { gainDb: 12 }, shadow))).toBeLessThan(9);
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

const coloredSamples = (f: ColorField): number =>
  f.vel.reduce((n, v) => (Number.isNaN(v) ? n : n + 1), 0);

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

const copyField = (f: ColorField): ColorField => ({
  vel: new Float32Array(f.vel),
  variance: new Float32Array(f.variance),
  power: new Float32Array(f.power),
  scaleMps: f.scaleMps,
  baselineShiftMps: f.baselineShiftMps,
  invert: f.invert,
});

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

describe('colour persistence through SimulatorCore (decisions 56 and 94)', () => {
  it(
    'blends every update with the previous field by the weight of the time since it, shows the latest one, and resets on modality and spec changes',
    { timeout: 120_000 },
    () => {
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
      let timeS = 0;
      let updateTimeS = NaN;
      const weights = new Set<number>();
      // ten updates: six caught too little changing flow once systole moved to its Weissler time (decision 162)
      for (let i = 0; i < 60 && updates < 10; i++) {
        const outRaw = raw.step(0.1);
        const out = kept.step(0.1);
        timeS += 0.1;
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
        // the field updates every other frame: the history weight is p per two frame intervals of the cadence, of elapsed time
        const w = persistenceOverTime(p, timeS - updateTimeS, 2 / out.cadenceHz);
        if (prev) weights.add(Number(w.toFixed(6)));
        updateTimeS = timeS;
        const { vel: rv, variance: rs, power: rp } = r.field!;
        const { vel: kv, variance: ks } = k.field!;
        for (let s = 0; s < kv.length; s++) {
          const vPrev = prev ? prev.vel[s]! : NaN;
          const both = !Number.isNaN(rv[s]!) && !Number.isNaN(vPrev);
          const ev = both
            ? circularBlend(w, rv[s]!, rp[s]!, vPrev, prev!.power[s]!, settings)
            : rv[s]!;
          const es = both ? rs[s]! * (1 - w) + prev!.variance[s]! * w : rs[s]!;
          const velOk = Number.isNaN(ev) ? Number.isNaN(kv[s]!) : Math.abs(kv[s]! - ev) < 1e-5;
          if (!velOk || !(Math.abs(ks[s]! - es) < 1e-5)) mismatches++;
          if (both && Math.abs(rv[s]! - vPrev) > 0.05) blended++;
        }
        // the composite must show the field of this update, not the one before it
        if (prev) {
          const fspec = kept.lastFrame!.spec;
          lut ??= buildScanLut(
            fspec,
            computeSectorMapping(
              fspec,
              W,
              H,
              DEFAULT_ACQUISITION.invertLR,
              DEFAULT_ACQUISITION.zoom,
            ),
          );
          const now = redMinusBlue(k.field!, lut, settings);
          const before = redMinusBlue(prev, lut, settings);
          const px = live[live.length - 1]!;
          for (let q = 0, o = 0; q < now.length; q++, o += 4) {
            if (Math.abs(now[q]! - before[q]!) <= 30) continue; // this pixel cannot tell the two fields apart
            discriminating++;
            if (Math.abs(px[o]! - px[o + 2]! - now[q]!) > 2) wrongField++;
          }
        }
        prev = copyField(k.field!);
      }
      expect(updates).toBe(10);
      // the first blend comes one frame after the first field, half the colour interval: its weight (about p^0.5) is far from
      // the setting, so a weight per update would not pass the blend check
      expect(Math.max(...[...weights].map((x) => Math.abs(x - p)))).toBeGreaterThan(0.1);
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
        for (let o = 0; o < a.length; o += 4)
          if (a[o] !== a[o + 1] || a[o + 1] !== a[o + 2]) coloredPixels++;
      }
      expect(coloredPixels).toBeGreaterThan(1000);
      // the two resets: the first update after them is raw, because there is no previous field to blend.
      // short steps keep the phase near the one that has flow, so the comparison is not made on an empty field.
      const nextUpdate = (
        dt: number,
        over: Partial<SimInput> = {},
      ): { kept: ColorField; raw: ColorField } => {
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
        return {
          kept: copyField(kept.lastColorField.field!),
          raw: copyField(raw.lastColorField.field!),
        };
      };
      // unfreeze and stop at an update with flow in the box: how much colour there is depends on the cardiac phase
      let flow = nextUpdate(0.1);
      for (let i = 0; i < 12 && coloredSamples(flow.raw) < 200; i++) flow = nextUpdate(0.1);
      expect(coloredSamples(flow.raw)).toBeGreaterThan(200);
      // four attempts at different phases: a single one can land where the box holds almost no flow
      const withDepth = (depthCm: number) => ({
        ...DEFAULT_ACQUISITION,
        tgcDb: [...DEFAULT_ACQUISITION.tgcDb],
        depthCm,
      });
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
    },
  );
});
