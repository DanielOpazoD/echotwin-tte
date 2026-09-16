import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { SimulatorCore } from '@/simulator/core/simulatorCore';
import { baseInput } from '@/simulator/core/baseInput';
import { createHeartModel, computeHeartPose } from '@/simulator/anatomy/heartModel';
import { createThoraxModel } from '@/simulator/anatomy/thoraxModel';
import { buildBeatTables, cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { ProceduralSliceRenderer } from '../procedural/sliceRenderer';
import {
  allocPolarFrame,
  DEFAULT_ACQUISITION,
  polarSpecFor,
  type PolarFrame,
  type PolarFrameSpec,
  type Scene,
} from '../types';
import { applyConsole, createConsoleState } from '../postprocess/consolePipeline';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import { Structure, Tissue } from '@/simulator/anatomy/tissue';
import { pleuralReverberation } from './acoustics';

/**
 * Acceptance numbers of the acoustic image formation (decision 52, docs/AUDITORIA_FIDELIDAD.md E-2) measured on
 * the CPU reference renderer: speckle statistics, a speckle cell that is elongated laterally and grows with depth,
 * tissue/blood contrast, myocardial anisotropy and console grey levels. `tools/offline/render/image-metrics.ts`
 * prints the same quantities for more views and tiers.
 */
const c = loadCaseById('normal-excellent-window');
const thorax = createThoraxModel(
  c.bodyHabitus,
  c.acousticWindow,
  { position: 'left-lateral', respiration: 'expiration', headElevationDeg: 0 },
  c.anatomy.ivc.collapsePct,
);
const heart = createHeartModel(
  c.anatomy,
  c.physiology,
  thorax.heartOffset,
  c.seed,
  thorax.ivcCollapse,
);
const tables = buildBeatTables(60 / c.rhythm.heartRateBpm, c.physiology, c.rhythm, c.hemodynamics);
const settings = { ...DEFAULT_ACQUISITION };
const PHASE = 0.35;
const spec = polarSpecFor(settings, 'medium');
const renderer = new ProceduralSliceRenderer();

function render(viewId: string): PolarFrame {
  const scene: Scene = {
    heart,
    heartPose: computeHeartPose(heart, cycleStateAt(tables, PHASE)),
    thorax,
    physics: {
      frequencyMHz: settings.frequencyMHz,
      harmonics: settings.harmonics,
      clutterLevel: c.acousticWindow.clutterLevel,
      windowAttenuation: c.acousticWindow.chestWallAttenuation,
      seed: c.seed,
    },
  };
  const beam = beamFrameFromPose(
    poseFromControl(thorax, canonicalControl(getViewTarget(viewId), heart, thorax)),
    1,
  );
  const f = allocPolarFrame(spec);
  renderer.render(scene, beam, spec, PHASE, f);
  return f;
}

const isLvWall = (s: number): boolean => s >= Structure.LvWallSeptal && s <= Structure.LvApex;
const mean = (v: number[]): number => v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
const std = (v: number[]): number => {
  const m = mean(v);
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, v.length));
};
const median = (v: number[]): number =>
  [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] ?? NaN;

/** Amplitude normalised by the local two-way transmission (removes attenuation from the statistics). */
const norm = (f: PolarFrame, i: number): number =>
  (f.amplitude[i] ?? 0) / Math.max(1e-4, f.transmission[i] ?? 1);

/** Median mean/std of 7 × 9 patches fully inside LV myocardium between 3 and 12 cm. */
function localSpeckleSnr(f: PolarFrame, s: PolarFrameSpec): number {
  const { lines: L, samples: N } = s;
  const dr = s.depthCm / N;
  const out: number[] = [];
  for (let li = 3; li < L - 3; li += 4)
    for (let s0 = Math.floor(3 / dr); s0 < Math.floor(12 / dr); s0 += 5) {
      const vals: number[] = [];
      let ok = true;
      for (let dl = -3; dl <= 3 && ok; dl++)
        for (let ds = -4; ds <= 4; ds++) {
          const i = (li + dl) * N + s0 + ds;
          if (f.tissue[i] !== Tissue.Myocardium || !isLvWall(f.structure[i] ?? 0)) {
            ok = false;
            break;
          }
          vals.push(norm(f, i));
        }
      if (ok) out.push(mean(vals) / std(vals));
    }
  return median(out);
}

/** Speckle cell (mm): twice the lag at which the autocorrelation of myocardial runs falls to 0.5. */
function cellMm(
  f: PolarFrame,
  s: PolarFrameSpec,
  d0: number,
  d1: number,
  lateral: boolean,
): number {
  const { lines: L, samples: N } = s;
  const dr = s.depthCm / N;
  const s0 = Math.floor(d0 / dr),
    s1 = Math.floor(d1 / dr);
  const acc = new Float64Array(9);
  const cnt = new Float64Array(9);
  const run = (xs: number[]): void => {
    if (xs.length < 10) return;
    const m = mean(xs);
    const d = xs.map((x) => x - m);
    const v0 = d.reduce((a, b) => a + b * b, 0) / d.length;
    if (v0 <= 0) return;
    for (let lag = 0; lag < 9 && lag < d.length; lag++) {
      let sum = 0;
      for (let k = 0; k + lag < d.length; k++) sum += d[k]! * d[k + lag]!;
      acc[lag] = acc[lag]! + sum / (d.length - lag) / v0;
      cnt[lag] = cnt[lag]! + 1;
    }
  };
  const inMyo = (li: number, si: number): boolean => f.tissue[li * N + si] === Tissue.Myocardium;
  if (lateral) {
    for (let si = s0; si < s1; si++) {
      let xs: number[] = [];
      for (let li = 0; li <= L; li++) {
        if (li < L && inMyo(li, si)) xs.push(norm(f, li * N + si));
        else {
          run(xs);
          xs = [];
        }
      }
    }
  } else {
    for (let li = 0; li < L; li++) {
      let xs: number[] = [];
      for (let si = s0; si <= s1; si++) {
        if (si < s1 && inMyo(li, si)) xs.push(norm(f, li * N + si));
        else {
          run(xs);
          xs = [];
        }
      }
    }
  }
  const acf = Array.from(acc, (a, i) => a / Math.max(1, cnt[i]!));
  let lag = NaN;
  for (let k = 1; k < 9; k++)
    if (acf[k]! <= 0.5) {
      lag = k - 1 + (acf[k - 1]! - 0.5) / Math.max(1e-9, acf[k - 1]! - acf[k]!);
      break;
    }
  const pitchMm = lateral ? (((d0 + d1) / 2) * s.sectorRad * 10) / L : dr * 10;
  return 2 * lag * pitchMm;
}

/**
 * The three depth bands, measured from where the myocardium starts instead of from the transducer.
 *
 * They were nailed at 3-5, 7-9 and 11-13 cm. The myocardium currently begins at 0.36 cm, so those are the
 * same bands this returns today (2.6, 6.6 and 10.6 cm past its leading edge) — but anchored to the tissue
 * they follow the heart if it moves, instead of filling with different tissue and breaking a PHYSICS test.
 * That coupling blocked a measured correction of the heart's position inside the chest wall: even a 0.48 cm
 * push-back failed this test (decision 65). What the test checks and how strictly is unchanged.
 */
function myocardialBands(
  f: PolarFrame,
  s: PolarFrameSpec,
): [[number, number], [number, number], [number, number]] {
  const { lines: L, samples: N } = s;
  const dr = s.depthCm / N;
  let lead = s.depthCm;
  for (let li = 0; li < L; li++)
    for (let si = 0; si < N; si++)
      if (f.tissue[li * N + si] === Tissue.Myocardium) {
        lead = Math.min(lead, si * dr);
        break;
      }
  const at = (from: number): [number, number] => [lead + from, lead + from + 2];
  return [at(2.6), at(6.6), at(10.6)];
}

describe('acoustic image formation', () => {
  const plax = render('plax');
  const a4c = render('a4c');
  const psax = render('psax-pm');

  it('myocardial speckle is fully developed (Rayleigh-like local statistics)', () => {
    for (const f of [plax, a4c]) {
      const snr = localSpeckleSnr(f, spec);
      expect(snr).toBeGreaterThan(1.7);
      expect(snr).toBeLessThan(2.35);
    }
  });

  it('the speckle cell is longer laterally than axially and grows laterally with depth', () => {
    const [near, mid, far] = myocardialBands(plax, spec);
    const latNear = cellMm(plax, spec, near[0], near[1], true);
    const latMid = cellMm(plax, spec, mid[0], mid[1], true);
    const latFar = cellMm(plax, spec, far[0], far[1], true);
    const axMid = cellMm(plax, spec, mid[0], mid[1], false);
    expect(latMid).toBeGreaterThan(latNear);
    expect(latFar).toBeGreaterThan(latMid);
    expect(latMid).toBeGreaterThan(2 * axMid);
  });

  it('tissue is 25–40 dB above blood away from the walls, and the septum stays lit with the beam across its fibres', () => {
    const { lines: L, samples: N } = spec;
    const dr = spec.depthCm / N;
    const myo: number[] = [];
    const farBlood: number[] = [];
    const septPlax: number[] = [];
    const septA4c: number[] = [];
    for (let li = 3; li < L - 3; li++)
      for (let si = Math.floor(3 / dr); si < Math.floor(12 / dr); si++) {
        const i = li * N + si;
        if (plax.tissue[i] === Tissue.Myocardium && isLvWall(plax.structure[i] ?? 0))
          myo.push(norm(plax, i));
        if (plax.tissue[i] === Tissue.Myocardium && plax.structure[i] === Structure.LvWallSeptal)
          septPlax.push(norm(plax, i));
        if (a4c.tissue[i] === Tissue.Myocardium && a4c.structure[i] === Structure.LvWallSeptal)
          septA4c.push(norm(a4c, i));
        let far = true;
        for (let dl = -3; dl <= 3 && far; dl++)
          for (let ds = -4; ds <= 4; ds++)
            if (plax.tissue[(li + dl) * N + si + ds] !== Tissue.Blood) {
              far = false;
              break;
            }
        if (far) farBlood.push(norm(plax, i));
      }
    const contrastDb = 20 * Math.log10(mean(myo) / mean(farBlood));
    expect(contrastDb).toBeGreaterThan(25);
    expect(contrastDb).toBeLessThan(40);
    // The beam runs along the septal wall in A4C but across its circumferential fibres, which leave the
    // image plane — so the fibre-orientation model keeps it lit (≈ −1 dB vs PLAX) instead of dropping it
    // like the wall-normal response did. Beam-along-fibre dropout is asserted in the PSAX test below.
    expect(20 * Math.log10(mean(septA4c) / mean(septPlax))).toBeGreaterThan(-5);
  });

  // In PSAX the LV ring is perpendicular to the beam where the central lines cross it and parallel at the
  // sector edges: the lateral walls must drop out, not stay a uniform bright ring — the fibre-orientation
  // model puts the beam along the circumferential fibres there. Measured 0.57 → 0.50.
  it('the PSAX ring drops out where the beam runs along the wall', () => {
    const { lines: L, samples: N } = spec;
    const dr = spec.depthCm / N;
    const buckets: number[][] = [[], [], [], [], [], []];
    for (let li = 0; li < L; li++)
      for (let si = Math.floor(3 / dr); si < Math.floor(12 / dr); si++) {
        const i = li * N + si;
        if (psax.tissue[i] === Tissue.Myocardium && isLvWall(psax.structure[i] ?? 0))
          buckets[Math.floor((6 * li) / L)]!.push(norm(psax, i));
      }
    const oblique = [...buckets[1]!, ...buckets[4]!];
    const perpendicular = [...buckets[2]!, ...buckets[3]!];
    const ratio = mean(oblique) / mean(perpendicular);
    expect(ratio).toBeLessThan(0.55);
    expect(ratio).toBeGreaterThan(0.2);
  });

  // The absolute grey levels are calibrated against clinical optimal-window images in clinicalImage.test.ts
  // (decision 70). The bands this test used to hold — blood 8-45, myocardium 100-170 — came from the textbook idea
  // of anechoic blood; CAMUS Good images put the LV cavity at grey ~58 and the myocardium ~44 levels above it.
  it('the console keeps myocardium well above blood, blood off black, and saturates with excess gain', () => {
    const { lines: L, samples: N } = spec;
    const grey = (gainDb: number): { myo: number; blood: number; sat: number } => {
      const disp = new Uint8ClampedArray(L * N);
      applyConsole(plax, { ...settings, gainDb }, createConsoleState(c.seed), disp);
      const gm: number[] = [];
      const gb: number[] = [];
      let tissue = 0,
        sat = 0;
      for (let i = 0; i < L * N; i++) {
        const st = plax.structure[i] ?? 0,
          ti = plax.tissue[i] ?? 0,
          g = disp[i] ?? 0;
        if (ti === Tissue.Myocardium && isLvWall(st)) gm.push(g);
        if (ti === Tissue.Blood && st === Structure.LvCavity) gb.push(g);
        if (ti !== Tissue.None && ti !== Tissue.Blood && ti !== Tissue.Lung) {
          tissue++;
          if (g >= 254) sat++;
        }
      }
      return { myo: mean(gm), blood: mean(gb), sat: sat / Math.max(1, tissue) };
    };
    const g0 = grey(0);
    expect(g0.blood).toBeGreaterThan(8);
    expect(g0.myo - g0.blood).toBeGreaterThan(20);
    expect(grey(12).sat).toBeGreaterThan(0.03);
  });
});

describe('pleural reverberation continuity', () => {
  function capture(view: string, depthCm: number) {
    const inp = baseInput({ quality: 'high', display: { width: 320, height: 280 } });
    inp.settings.depthCm = depthCm;
    inp.settings.persistence = 0;
    inp.settings.edgeEnhance = 0;
    const core = new SimulatorCore(loadCaseById('normal-excellent-window'), inp);
    inp.probe = canonicalControl(getViewTarget(view), core.models.heart, core.models.thorax);
    core.setInput(inp);
    const output = core.step(0);
    expect(output).not.toBeNull();
    const f = core.lastFrame!;
    return {
      amplitude: new Float32Array(f.amplitude),
      tissue: new Uint8Array(f.tissue),
      structure: new Uint8Array(f.structure),
      rgba: new Uint8ClampedArray(output!.rgba),
    };
  }

  it.each(['a2c', 'psax-mv', 'plax'])('vanishing depth changes preserve the %s image', (view) => {
    const a = capture(view, 16);
    const b = capture(view, 16 + 1e-8);
    expect(a.tissue).toEqual(b.tissue);
    expect(a.structure).toEqual(b.structure);
    let maxEnv = 0;
    for (let i = 0; i < a.amplitude.length; i++)
      maxEnv = Math.max(maxEnv, Math.abs(a.amplitude[i]! - b.amplitude[i]!));
    expect(maxEnv).toBeLessThan(1e-5);
    let maxByte = 0;
    for (let i = 0; i < a.rgba.length; i++)
      maxByte = Math.max(maxByte, Math.abs(a.rgba[i]! - b.rgba[i]!));
    expect(maxByte).toBeLessThanOrEqual(1);
  });

  it('matches the full echo-train sum within 1e-12', () => {
    for (const entry of [0.1, 0.4, 2.3, 4.025]) {
      const period = Math.max(entry, 0.4);
      for (let j = 1; j <= 4; j++)
        for (const off of [-0.12, -0.04, 0, 0.04, 0.12]) {
          const r = entry + j * period + off;
          const d = r - entry;
          let sum = 0;
          for (let n = 0; n <= Math.ceil(d / period) + 10; n++)
            sum += 0.55 ** (n + 1) * Math.exp(-(((d - n * period) / 0.12) ** 2));
          const expected = 0.7 * (0.9 * sum + 0.02 * 0.55 ** (d / period + 1) * 0.6);
          expect(Math.abs(pleuralReverberation(r, entry, 0.7, 0.6) - expected)).toBeLessThan(1e-12);
        }
    }
  });

  it('places decaying pulses at whole periods and is flat at each crest', () => {
    const entry = 2.3;
    const expected = [0.9 * 0.55 ** 2, 0.9 * 0.55 ** 3, 0.9 * 0.55 ** 4];
    [2, 3, 4].forEach((n, i) => {
      const r = n * entry;
      expect(Math.abs(pleuralReverberation(r, entry, 1, 0) - expected[i]!)).toBeLessThan(1e-12);
      for (const eps of [-1e-8, 1e-8])
        expect(
          Math.abs(
            pleuralReverberation(r + eps, entry, 1, 0) - pleuralReverberation(r, entry, 1, 0),
          ),
        ).toBeLessThan(1e-10);
    });
    expect(
      Math.abs(
        pleuralReverberation(2 * entry - 0.04, entry, 1, 0) -
          pleuralReverberation(2 * entry + 0.04, entry, 1, 0),
      ),
    ).toBeLessThan(1e-12);
  });

  it('is zero before the pleura and bounded by the entry transmission behind it', () => {
    expect(pleuralReverberation(5, 2.3, 0, 0.6)).toBe(0);
    expect(pleuralReverberation(2.3, 2.3, 0.4, 0.6)).toBe(0);
    expect(pleuralReverberation(1, 2.3, 0.4, 0.6)).toBe(0);
    for (let r = 2.31; r <= 16; r += 0.05) {
      const v = pleuralReverberation(r, 2.3, 0.4, 0.6);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(0.4);
    }
  });
});
