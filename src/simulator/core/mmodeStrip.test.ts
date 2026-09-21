// @tier slow
import { beforeAll, describe, expect, it } from 'vitest';
import {
  binsToTrace,
  buildRowMap,
  columnSource,
  MMODE_PRF_HZ,
  MmodeLineCache,
  mmodeLineSamples,
  mmodePhaseBins,
  mmodePulsesPerColumn,
  type MmodeLine,
} from './mmodeStrip';
import { SimulatorCore } from './simulatorCore';
import { baseInput } from './baseInput';
import { loadCaseById } from '@/cases';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import { beamFrameFromPose, contactQuality, poseFromControl } from '@/simulator/probe/pose';
import { classifyHeart, computeHeartPose, type HeartPose } from '@/simulator/anatomy/heartModel';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { makeSample, Structure } from '@/simulator/anatomy/tissue';
import { polarSpecFor } from '@/simulator/renderer/types';
import { ProceduralSliceRenderer } from '@/simulator/renderer/procedural/sliceRenderer';

const line = (v: number): MmodeLine => ({ amp: new Float32Array([v]), velocity: null });

describe('M-mode acquisition helpers (decision 84)', () => {
  it('lines resolve the axial pulse, bins follow the columns of a beat and a column averages the pulses it spans', () => {
    // 0.2 mm samples: 800 over 16 cm, a quarter of the 0.89 mm pulse at 2.5 MHz
    expect(mmodeLineSamples(16)).toBe(800);
    expect(mmodePhaseBins(445, 0.92)).toBe(512);
    expect(mmodePhaseBins(1024, 0.92)).toBe(1024);
    expect(mmodePhaseBins(100, 0.5)).toBe(128);
    expect(mmodePhaseBins(4000, 1.5)).toBe(2048);
    expect(MMODE_PRF_HZ).toBeGreaterThanOrEqual(1000);
    expect(mmodePulsesPerColumn(222)).toBe(5); // 25 mm/s
    expect(mmodePulsesPerColumn(445)).toBe(2); // 50 mm/s
    expect(mmodePulsesPerColumn(1024)).toBe(1); // 100 mm/s
  });

  it('a column is interpolated between the traced lines on each side of its instant', () => {
    const cache = new MmodeLineCache();
    cache.reset('k', 256);
    cache.set(10, line(1));
    cache.set(11, line(3));
    const full = columnSource(cache, 10.25 / 256, 64)!;
    expect(full.span).toBe(1);
    expect(full.lo.amp[0]).toBe(1);
    expect(full.hi.amp[0]).toBe(3);
    expect(full.t).toBeCloseTo(0.25, 6);
    // a gap: bins 12 and 13 missing, the column at 13.5 bins sits between 11 and 14
    cache.set(14, line(7));
    const gap = columnSource(cache, 13.5 / 256, 64)!;
    expect(gap.span).toBe(3);
    expect(gap.t).toBeCloseTo(2.5 / 3, 6);
    // across the end of the beat
    cache.set(255, line(5));
    cache.set(0, line(9));
    expect(columnSource(cache, 255.5 / 256, 4)!.span).toBe(1);
    // nothing traced within reach
    const empty = new MmodeLineCache();
    empty.reset('k', 256);
    expect(columnSource(empty, 0.3, 64)).toBeNull();
    empty.set(100, line(2));
    expect(columnSource(empty, 90 / 256, 64)!.lo.amp[0]).toBe(2);
  });

  it('the trace budget is spread over the missing bins of the due columns', () => {
    const cache = new MmodeLineCache();
    cache.reset('k', 512);
    const phases = Array.from({ length: 40 }, (_, i) => (100 + i * 1.2) / 512);
    const all = binsToTrace(cache, phases, 1000);
    expect(new Set(all).size).toBe(all.length);
    expect(Math.min(...all)).toBe(100);
    expect(Math.max(...all)).toBeGreaterThanOrEqual(147);
    const few = binsToTrace(cache, phases, 5);
    expect(few.length).toBe(5);
    // evenly spread: no two picks closer than a fifth of the missing range less a bin
    const sorted = [...few].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++)
      expect(sorted[i]! - sorted[i - 1]!).toBeGreaterThanOrEqual(8);
    for (const b of all) cache.set(b, line(1));
    expect(binsToTrace(cache, phases, 5)).toEqual([]);
  });

  it('strip rows average the line samples they cover, so no row repeats a sample and none is skipped', () => {
    for (const [rows, samples] of [
      [470, 800],
      [470, 1200],
      [600, 400],
    ] as const) {
      const map = buildRowMap(rows, samples);
      const cover = new Float32Array(samples);
      for (let y = 0; y < rows; y++) {
        let sum = 0;
        for (let k = 0; k < map.taps; k++) {
          const w = map.weights[y * map.taps + k]!;
          sum += w;
          if (w > 0) cover[map.first[y]! + k]! += w;
        }
        expect(sum).toBeCloseTo(1, 5);
      }
      if (samples >= rows)
        for (let i = 0; i < samples; i++) expect(cover[i]).toBeCloseTo(rows / samples, 4);
      else {
        // upsampled: consecutive rows interpolate at distinct positions
        const pos = Array.from(
          { length: rows },
          (_, y) => map.first[y]! + map.weights[y * map.taps + 1]!,
        );
        for (let y = 1; y < rows; y++) expect(pos[y]!).toBeGreaterThan(pos[y - 1]!);
      }
    }
  });
});

// Decision 84: the M-mode strip as the app draws it, through SimulatorCore, on the ventricular line this file derives (320 px
// at 100 mm/s, 50 ms steps, low tier). Measured before the change: 31 of 319 column pairs with a time gap (the sweep showed
// 1.61 s of heart in 1 s of trace, because a step drew at most 10 of its 16 columns), the posterior pericardial echo moving
// against its model position by 0.30 mm RMS between neighbouring columns with steps of up to 1.56 mm (1 mm samples), and
// tissue texture decorrelating from one column to the next (septum 0.72, posterior wall 0.71). After it: no gap, 0.08 mm
// RMS with steps of 0.24 mm at most, correlation 0.97 and 0.98.
describe('M-mode strip through the simulator (decision 84)', () => {
  const c = loadCaseById('normal-excellent-window');
  const models = new SimulatorCore(c, baseInput()).models;
  const { heart, thorax, tables } = models;
  const probe = canonicalControl(getViewTarget('plax'), heart, thorax);
  const beam = beamFrameFromPose(poseFromControl(thorax, probe), contactQuality(probe.pressure));
  const smp = makeSample();
  const hf = heart.frame;
  const structureAt = (hp: HeartPose, theta: number, r: number): number => {
    const ct = Math.cos(theta),
      sn = Math.sin(theta);
    const px = beam.origin.x + (beam.forward.x * ct + beam.lateral.x * sn) * r,
      py = beam.origin.y + (beam.forward.y * ct + beam.lateral.y * sn) * r,
      pz = beam.origin.z + (beam.forward.z * ct + beam.lateral.z * sn) * r;
    const hx =
      (px - hf.origin.x) * hf.ex.x + (py - hf.origin.y) * hf.ex.y + (pz - hf.origin.z) * hf.ex.z;
    const hy =
      (px - hf.origin.x) * hf.ey.x + (py - hf.origin.y) * hf.ey.y + (pz - hf.origin.z) * hf.ey.z;
    const hz =
      (px - hf.origin.x) * hf.ez.x + (py - hf.origin.y) * hf.ez.y + (pz - hf.origin.z) * hf.ez.z;
    return classifyHeart(heart, hp, hx, hy, hz, smp) ? smp.structure : Structure.None;
  };
  /** Extent (cm) of each structure along the cursor at 0.1 mm, and the start of the posterior pericardium refined to 1 µm. */
  const lineAnatomy = (hp: HeartPose, theta: number) => {
    const ext = new Map<number, [number, number]>();
    let peri = -1;
    for (let r = 1.5; r < 14; r += 0.01) {
      const st = structureAt(hp, theta, r);
      const e = ext.get(st);
      if (e) e[1] = r;
      else ext.set(st, [r, r]);
      if (st === Structure.Pericardium && peri < 0 && ext.has(Structure.LvWallInferior)) {
        let lo = r - 0.01,
          hi = r;
        for (let k = 0; k < 14; k++) {
          const m = (lo + hi) / 2;
          if (structureAt(hp, theta, m) === Structure.Pericardium) hi = m;
          else lo = m;
        }
        peri = hi;
      }
    }
    return { ext, peri };
  };
  // The ventricular M-mode line, derived from the anatomy: the line nearest the anterior mitral leaflet that, over the whole
  // cycle, crosses septum, cavity, inferolateral wall and pericardium without leaflets, left atrium or coronary sinus (the
  // classic line just past the leaflet tips).
  const theta = (() => {
    const poses = [0, 0.2, 0.35, 0.5, 0.65, 0.8].map((ph) =>
      computeHeartPose(heart, cycleStateAt(tables, ph)),
    );
    const excluded = [
      Structure.MitralAnterior,
      Structure.MitralPosterior,
      Structure.LaCavity,
      Structure.CoronarySinus,
    ];
    let mitral = 0,
      mitralLen = 0;
    const clean: number[] = [];
    for (let k = -20; k <= 20; k++) {
      const th = k * 0.03;
      let ok = true,
        aml = 0;
      for (const hp of poses) {
        const { ext, peri } = lineAnatomy(hp, th);
        const len = (id: number) => (ext.has(id) ? ext.get(id)![1] - ext.get(id)![0] : 0);
        aml += len(Structure.MitralAnterior);
        if (
          excluded.some((id) => ext.has(id)) ||
          peri < 0 ||
          len(Structure.LvWallSeptal) < 0.5 ||
          len(Structure.LvWallInferior) < 0.5
        )
          ok = false;
      }
      if (aml > mitralLen) {
        mitralLen = aml;
        mitral = th;
      }
      if (ok) clean.push(th);
    }
    return clean.sort((a, b) => Math.abs(a - mitral) - Math.abs(b - mitral))[0] ?? 0;
  })();

  const W = 320;
  const SWEEP = 100;
  const DT = 0.05; // 16 columns per step, more than the old bound of 10
  const cols = W;
  const secondsShown = 100 / SWEEP;
  let core: SimulatorCore;
  let steps = 0;
  let converged = -1;

  beforeAll(() => {
    core = new SimulatorCore(
      c,
      baseInput({
        probe,
        modality: 'm-mode',
        quality: 'low',
        display: { width: W, height: 480 },
        cursorThetaRad: theta,
        spectral: { ...baseInput().spectral, sweepSpeedMmPerS: SWEEP },
      }),
    );
    for (; steps < 4000; steps++) {
      core.step(DT);
      const s = core.mmodeStrip!;
      if (converged < 0 && s.head >= 2 * cols && Array.from(s.span).every((x) => x === 1))
        converged = steps;
      // one more sweep after every column of a sweep came from neighbouring bins
      if (converged >= 0 && steps > converged + Math.ceil(secondsShown / DT) + 2) break;
    }
  }, 600_000);

  /** Columns of the last sweep, oldest first. */
  const lastSweep = (): number[] => {
    const head = core.mmodeStrip!.head;
    return Array.from({ length: cols }, (_, i) => (head + i) % cols);
  };

  it('the cursor crosses septum, cavity and inferolateral wall, and the strip reaches full time resolution', () => {
    expect(theta).not.toBe(0);
    expect(converged).toBeGreaterThan(0);
    expect(core.mmodeStrip!.samples).toBe(mmodeLineSamples(16));
  });

  it('no time is dropped: every column is its own instant, one column interval after the previous', () => {
    const s = core.mmodeStrip!;
    const order = lastSweep();
    const nominal = secondsShown / cols;
    let covered = 0,
      longest = 0;
    for (let i = 1; i < cols; i++) {
      let d = s.phase[order[i]!]! - s.phase[order[i - 1]!]!;
      if (d < -0.5) d += 1;
      covered += d * tables.rrS;
      longest = Math.max(longest, d * tables.rrS);
    }
    // the case's beat-to-beat variability stretches a column across a beat boundary (4.4 ms against 3.1 nominal measured);
    // a dropped step left 22.6 ms
    expect(longest).toBeLessThan(2 * nominal);
    expect(covered).toBeGreaterThan(secondsShown * 0.94);
    expect(covered).toBeLessThan(secondsShown * 1.06);
  });

  it('echoes move continuously: the posterior pericardial echo follows the model within a tenth of the axial pulse', () => {
    const s = core.mmodeStrip!;
    const dr = 16 / s.samples;
    const errs: number[] = [];
    for (const col of lastSweep()) {
      const hp = computeHeartPose(heart, cycleStateAt(tables, s.phase[col]!));
      const { peri } = lineAnatomy(hp, theta);
      if (peri < 0) continue;
      // intensity centroid of the pericardial echo, 1.5 mm to either side of the model's pericardium. The window used to
      // reach 3 mm behind it, into the pleural reverberation, which does not move with the heart (the lung is static
      // in the model): that read the pericardium–pleura distance, not the echo's continuity, and once decision 139
      // moved the base 0.7 cm posterior the rms step rose from 0.080 to 0.121 mm with the wide window while the
      // pericardium itself stayed at 0.086–0.095 mm.
      const a0 = Math.max(0, Math.floor((peri - 0.15) / dr)),
        a1 = Math.min(s.samples - 1, Math.ceil((peri + 0.15) / dr));
      let base = 255;
      for (let i = a0; i <= a1; i++) base = Math.min(base, s.grey[i * cols + col]!);
      let w = 0,
        rw = 0;
      for (let i = a0; i <= a1; i++) {
        const g = (s.grey[i * cols + col]! - base) ** 2;
        w += g;
        rw += g * (i + 0.5) * dr;
      }
      errs.push(w > 0 ? (rw / w - peri) * 10 : NaN);
    }
    expect(errs.length).toBeGreaterThan(cols * 0.9);
    expect(errs.every((e) => Number.isFinite(e))).toBe(true);
    // the echo's offset from the model may drift slowly over the cycle (the complex changes shape); a staircase shows up as
    // the offset changing between neighbouring columns: still for several columns, then a whole sample at once
    const steps1 = errs.slice(1).map((e, i) => e - errs[i]!);
    const rmsStep = Math.sqrt(steps1.reduce((a, d) => a + d * d, 0) / steps1.length);
    const jump = Math.max(...steps1.map(Math.abs));
    expect(rmsStep).toBeLessThan(0.12);
    expect(jump).toBeLessThan(0.6);
  });

  it('tissue speckle travels with the tissue from one column to the next', () => {
    const s = core.mmodeStrip!;
    const dr = 16 / s.samples;
    const order = lastSweep();
    const shift = Math.round(0.06 / dr);
    const corr = (c1: number, c0: number, from: number, to: number): number => {
      const i0 = Math.ceil(from / dr),
        i1 = Math.floor(to / dr);
      let best = -1;
      for (let sh = -shift; sh <= shift; sh++) {
        let ma = 0,
          mb = 0;
        const n = i1 - i0;
        for (let i = i0; i < i1; i++) {
          ma += s.grey[i * cols + c1]!;
          mb += s.grey[(i + sh) * cols + c0]!;
        }
        ma /= n;
        mb /= n;
        let ab = 0,
          aa = 0,
          bb = 0;
        for (let i = i0; i < i1; i++) {
          const a = s.grey[i * cols + c1]! - ma,
            b = s.grey[(i + sh) * cols + c0]! - mb;
          ab += a * b;
          aa += a * a;
          bb += b * b;
        }
        if (aa > 1 && bb > 1) best = Math.max(best, ab / Math.sqrt(aa * bb));
      }
      return best;
    };
    const septum: number[] = [],
      wall: number[] = [];
    for (let i = 1; i < cols; i += 2) {
      const col = order[i]!,
        prev = order[i - 1]!;
      const { ext } = lineAnatomy(
        computeHeartPose(heart, cycleStateAt(tables, s.phase[col]!)),
        theta,
      );
      const sep = ext.get(Structure.LvWallSeptal),
        inf = ext.get(Structure.LvWallInferior);
      if (sep && sep[1] - sep[0] > 0.4) septum.push(corr(col, prev, sep[0] + 0.08, sep[1] - 0.08));
      if (inf && inf[1] - inf[0] > 0.4) wall.push(corr(col, prev, inf[0] + 0.08, inf[1] - 0.08));
    }
    const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;
    expect(septum.length).toBeGreaterThan(100);
    expect(wall.length).toBeGreaterThan(100);
    expect(mean(septum)).toBeGreaterThan(0.9);
    expect(mean(wall)).toBeGreaterThan(0.9);
  });

  // Structures whose texture cannot follow them yet, and why. The RV free wall's material coordinates are scaled with the
  // contraction (x / (1 − 0.3·s) in heartModel.ts), so across the beam they slide ~0.8 mm in 2 % of the cycle while the wall
  // moves along it; its speckle decorrelates instead of travelling (docs/LIMITATIONS.md). The test fails when one of these
  // follows its structure, so a stale entry is noticed.
  const KNOWN_TEXTURE_LIMITATIONS = new Set<number>([Structure.RvWall]);

  it('the speckle of each heart structure travels with it along the beam, also where its material coordinates stand still, and blood speckle is new in every pulse', () => {
    const renderer = new ProceduralSliceRenderer();
    const spec = polarSpecFor(baseInput().settings, 'medium');
    const S = mmodeLineSamples(spec.depthCm);
    const dr = spec.depthCm / S;
    const physics = {
      frequencyMHz: 2.5,
      harmonics: true,
      clutterLevel: c.acousticWindow.clutterLevel,
      windowAttenuation: c.acousticWindow.chestWallAttenuation,
      seed: c.seed,
    };
    const render = (phase: number, th: number, pulse = 7) => {
      const o = {
        amp: new Float32Array(S),
        st: new Uint8Array(S),
        tr: new Float32Array(S),
        ti: new Uint8Array(S),
      };
      renderer.renderMmodeLine(
        { heart, heartPose: computeHeartPose(heart, cycleStateAt(tables, phase)), thorax, physics },
        beam,
        spec,
        S,
        th,
        pulse,
        o.amp,
        o.st,
        o.tr,
        o.ti,
      );
      return o;
    };
    /** Best correlation of log amplitude of A's samples [i0, i1) with B's within ±shift samples; the shift too. */
    const bestShift = (
      A: ReturnType<typeof render>,
      B: ReturnType<typeof render>,
      i0: number,
      i1: number,
      maxShift: number,
    ): [number, number] => {
      let best = -2,
        shift = 0;
      for (let sh = -maxShift; sh <= maxShift; sh++) {
        let ma = 0,
          mb = 0,
          n = 0;
        for (let q = i0; q < i1; q++) {
          if (q + sh < 0 || q + sh >= S) continue;
          ma += Math.log(A.amp[q]! + 1e-4);
          mb += Math.log(B.amp[q + sh]! + 1e-4);
          n++;
        }
        ma /= n;
        mb /= n;
        let ab = 0,
          aa = 0,
          bb = 0;
        for (let q = i0; q < i1; q++) {
          if (q + sh < 0 || q + sh >= S) continue;
          const x = Math.log(A.amp[q]! + 1e-4) - ma,
            y = Math.log(B.amp[q + sh]! + 1e-4) - mb;
          ab += x * y;
          aa += x * x;
          bb += y * y;
        }
        const cor = ab / Math.sqrt(aa * bb);
        if (cor > best) {
          best = cor;
          shift = sh;
        }
      }
      return [best, shift];
    };
    // the aortic-valve line: the one crossing most aortic root wall and left atrial wall, derived from the anatomy
    const avTheta = (() => {
      let best = 0,
        most = -1;
      for (let k = 0; k <= 12; k++) {
        const o = render(0.3, k * 0.03);
        let n = 0;
        for (let i = 0; i < S; i++)
          if (o.st[i] === Structure.AorticRoot || o.st[i] === Structure.LaWall) n++;
        if (n > most) {
          most = n;
          best = k * 0.03;
        }
      }
      return best;
    })();
    const errors = new Map<number, number[]>();
    const bloodPersistence: number[] = [];
    for (const th of [theta, avTheta]) {
      for (let p = 0; p < 40; p++) {
        const A = render(p / 40, th),
          B = render(p / 40 + 0.02, th),
          next = render(p / 40 + 0.004, th, 8);
        const runs = (o: typeof A): [number, number][] => {
          const out: [number, number][] = [];
          for (let i = 0; i < S;) {
            let j = i + 1;
            while (j < S && o.st[j] === o.st[i] && o.ti[j] === o.ti[i]) j++;
            out.push([i, j]);
            i = j;
          }
          return out;
        };
        const runsB = runs(B);
        for (const [i, j] of runs(A)) {
          const id = A.st[i]!;
          // blood of the left chambers, 5 mm or more, against the next pulse 4 ms later
          if (
            (id === Structure.LvCavity || id === Structure.LaCavity) &&
            A.ti[i] === 1 &&
            j - i >= 25
          )
            bloodPersistence.push(bestShift(A, next, i + 5, j - 5, 5)[0]);
          // heart tissue runs of at least 2 mm, not blood (its speckle is new in every pulse)
          if (
            id === Structure.None ||
            A.ti[i] === 1 ||
            j - i < 10 ||
            id === Structure.ChestWall ||
            id === Structure.Lung
          )
            continue;
          let match: [number, number] | null = null;
          for (const [k, m] of runsB)
            if (
              B.st[k] === id &&
              B.ti[k] === A.ti[i] &&
              (!match || Math.abs(k + m - i - j) < Math.abs(match[0] + match[1] - i - j))
            )
              match = [k, m];
          if (!match || Math.abs(match[1] - match[0] - (j - i)) > 3) continue;
          const moved = ((match[0] + match[1] - i - j) / 2) * dr;
          if (Math.abs(moved) < 0.03) continue;
          const [, shift] = bestShift(A, B, i + 2, j - 2, Math.round(0.25 / dr));
          const e = errors.get(id) ?? [];
          e.push(Math.abs(shift * dr - moved) * 10);
          errors.set(id, e);
        }
      }
    }
    const followed = new Set<number>();
    for (const [id, e] of errors) {
      if (e.length < 5) continue;
      const median = [...e].sort((a, b) => a - b)[e.length >> 1]!;
      if (median <= 0.25) followed.add(id);
    }
    for (const id of [
      Structure.LvWallSeptal,
      Structure.LvWallInferior,
      Structure.LaWall,
      Structure.AorticRoot,
    ])
      expect(followed.has(id), `structure ${id} texture follows it`).toBe(true);
    for (const id of KNOWN_TEXTURE_LIMITATIONS)
      expect(followed.has(id), `known limitation ${id} is stale`).toBe(false);
    // left-chamber blood: its speckle 4 ms later, at the best shift, correlates 0.15–0.32 (0.92–1.00 if it stood still)
    expect(bloodPersistence.length).toBeGreaterThan(40);
    expect([...bloodPersistence].sort((a, b) => a - b)[bloodPersistence.length >> 1]!).toBeLessThan(
      0.5,
    );
  });

  it('a line four times finer than the frame keeps, tissue by tissue, the levels of the same line sampled like a frame', () => {
    // Levels are compared inside tissue runs over the whole sector and five phases: one line alone holds a single speckle
    // realisation of still tissue (four phases left the mediastinal fat 15 samples short of the 300 the comparison
    // asks for once the apical probe of decision 139 put lung on the edge lines). Interface peaks are not compared here: the frame merges the two surfaces of a thin
    // membrane that the finer line resolves (psf.test.ts checks a single interface).
    const renderer = new ProceduralSliceRenderer();
    const spec = polarSpecFor(baseInput().settings, 'medium');
    const fine = 4 * spec.samples;
    const physics = {
      frequencyMHz: 2.5,
      harmonics: true,
      clutterLevel: c.acousticWindow.clutterLevel,
      windowAttenuation: c.acousticWindow.chestWallAttenuation,
      seed: c.seed,
    };
    const bufs = (n: number) => ({
      amp: new Float32Array(n),
      st: new Uint8Array(n),
      tr: new Float32Array(n),
      ti: new Uint8Array(n),
    });
    const a = bufs(spec.samples),
      b = bufs(fine);
    const inside = (x: ReturnType<typeof bufs>, n: number, i: number, half: number): boolean => {
      for (let d = -half; d <= half; d++)
        if (i + d < 0 || i + d >= n || x.ti[i + d] !== x.ti[i] || x.st[i + d] !== x.st[i])
          return false;
      return x.st[i] !== 0;
    };
    const power = new Map<number, [number, number, number, number]>();
    for (let p = 0; p < 5; p++) {
      const scene = {
        heart,
        heartPose: computeHeartPose(heart, cycleStateAt(tables, p / 5)),
        thorax,
        physics,
      };
      for (let k = -11; k <= 11; k++) {
        const th = k * 0.05;
        renderer.renderMmodeLine(
          scene,
          beam,
          spec,
          spec.samples,
          th,
          p * 31 + k,
          a.amp,
          a.st,
          a.tr,
          a.ti,
        );
        renderer.renderMmodeLine(scene, beam, spec, fine, th, p * 31 + k, b.amp, b.st, b.tr, b.ti);
        for (let i = 0; i < spec.samples; i++)
          if (inside(a, spec.samples, i, 2)) {
            const e = power.get(a.ti[i]!) ?? [0, 0, 0, 0];
            e[0] += a.amp[i]! ** 2;
            e[1]++;
            power.set(a.ti[i]!, e);
          }
        for (let i = 0; i < fine; i++)
          if (inside(b, fine, i, 8)) {
            const e = power.get(b.ti[i]!) ?? [0, 0, 0, 0];
            e[2] += b.amp[i]! ** 2;
            e[3]++;
            power.set(b.ti[i]!, e);
          }
      }
    }
    const compared: string[] = [];
    for (const [tissue, [pa, na, pb, nb]] of power) {
      if (na < 300 || nb < 1000) continue;
      compared.push(String(tissue));
      expect(Math.abs(10 * Math.log10(pb / nb / (pa / na))), `tissue ${tissue}`).toBeLessThan(1);
    }
    expect(compared.length).toBeGreaterThanOrEqual(4);
  });
});
