/**
 * Acoustic image metrics: speckle statistics and cell size, tissue contrast, angle dependence of the
 * myocardial echo and displayed grey levels, measured on the CPU reference renderer and the console.
 * They are the acceptance numbers of the image-formation iteration (docs/AUDITORIA_FIDELIDAD.md, E-2).
 *
 * Usage: npx tsx tools/offline/render/image-metrics.ts [caseId] [phase]
 */
import { loadCaseById } from '@/cases';
import { createHeartModel, computeHeartPose } from '@/simulator/anatomy/heartModel';
import { createThoraxModel } from '@/simulator/anatomy/thoraxModel';
import { buildBeatTables, cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { ProceduralSliceRenderer } from '@/simulator/renderer/procedural/sliceRenderer';
import {
  allocPolarFrame,
  DEFAULT_ACQUISITION,
  polarSpecFor,
  type AcquisitionSettings,
  type PolarFrame,
  type PolarFrameSpec,
  type Scene,
} from '@/simulator/renderer/types';
import { applyConsole, createConsoleState } from '@/simulator/renderer/postprocess/consolePipeline';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import { Structure, Tissue } from '@/simulator/anatomy/tissue';

const caseId = process.argv[2] ?? 'normal-excellent-window';
const PHASE = Number(process.argv[3] ?? 0.35);
const c = loadCaseById(caseId);
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
const renderer = new ProceduralSliceRenderer();

function scene(settings: AcquisitionSettings): Scene {
  return {
    heart,
    heartPose: computeHeartPose(heart, cycleStateAt(tables, PHASE)),
    thorax,
    physics: {
      frequencyMHz: settings.frequencyMHz,
      harmonics: settings.harmonics,
      clutterLevel: c.acousticWindow.clutterLevel + c.acousticWindow.emphysemaScatter * 0.5,
      windowAttenuation: c.acousticWindow.chestWallAttenuation,
      seed: c.seed,
    },
  };
}

function render(
  viewId: string,
  settings: AcquisitionSettings,
  tier: 'low' | 'medium' | 'high',
): { frame: PolarFrame; spec: PolarFrameSpec } {
  const spec = polarSpecFor(settings, tier);
  const beam = beamFrameFromPose(
    poseFromControl(thorax, canonicalControl(getViewTarget(viewId), heart, thorax)),
    1,
  );
  const frame = allocPolarFrame(spec);
  renderer.render(scene(settings), beam, spec, PHASE, frame);
  return { frame, spec };
}

const isLvWall = (s: number): boolean => s >= Structure.LvWallSeptal && s <= Structure.LvApex;
const fmt = (v: number, d = 2): string => (Number.isFinite(v) ? v.toFixed(d) : 'n/a');

function stats(vals: number[]): { n: number; mean: number; std: number; skew: number } {
  const n = vals.length;
  if (!n) return { n: 0, mean: NaN, std: NaN, skew: NaN };
  const mean = vals.reduce((a, b) => a + b, 0) / n;
  let v = 0,
    s3 = 0;
  for (const x of vals) {
    v += (x - mean) ** 2;
    s3 += (x - mean) ** 3;
  }
  const std = Math.sqrt(v / n);
  return { n, mean, std, skew: s3 / n / std ** 3 };
}

/** Normalised autocorrelation along runs of consecutive masked samples; returns the lag where it falls to 0.5. */
function halfWidth(
  get: (a: number, b: number) => number,
  mask: (a: number, b: number) => boolean,
  outer: [number, number],
  inner: [number, number],
  maxLag = 12,
  minRun = 10,
): { lag: number; runs: number } {
  const acc = new Float64Array(maxLag + 1);
  const cnt = new Float64Array(maxLag + 1);
  let runs = 0;
  for (let o = outer[0]; o < outer[1]; o++) {
    let start = -1;
    for (let i = inner[0]; i <= inner[1]; i++) {
      const inside = i < inner[1] && mask(o, i);
      if (inside && start < 0) start = i;
      if (!inside && start >= 0) {
        const len = i - start;
        if (len >= minRun) {
          runs++;
          const xs: number[] = [];
          for (let k = start; k < i; k++) xs.push(get(o, k));
          const m = xs.reduce((a, b) => a + b, 0) / len;
          const d = xs.map((x) => x - m);
          const v0 = d.reduce((a, b) => a + b * b, 0) / len;
          if (v0 > 0)
            for (let lag = 0; lag <= Math.min(maxLag, len - 1); lag++) {
              let s = 0;
              for (let k = 0; k + lag < len; k++) s += d[k]! * d[k + lag]!;
              acc[lag] = acc[lag]! + s / (len - lag) / v0;
              cnt[lag] = cnt[lag]! + 1;
            }
        }
        start = -1;
      }
    }
  }
  const acf = Array.from(acc, (a, i) => (cnt[i]! > 0 ? a / cnt[i]! : NaN));
  for (let lag = 1; lag <= maxLag; lag++) {
    const prev = acf[lag - 1]!,
      cur = acf[lag]!;
    if (cur <= 0.5) return { lag: lag - 1 + (prev - 0.5) / Math.max(1e-9, prev - cur), runs };
  }
  return { lag: NaN, runs };
}

const lines: string[] = [];
const log = (s: string): void => {
  lines.push(s);
  process.stdout.write(s + '\n');
};
log(`# Image metrics — ${caseId}, phase ${PHASE}`);
log(
  'view | tier | SNR amp region (Rayleigh 1.91) | local SNR median | skew | lat cell mm 3–5 / 7–9 / 11–13 | ax cell mm 3–5 / 7–9 / 11–13 | myo/blood dB | myo/far-blood dB | septum dB rel. PLAX | grey myo / blood / peri p95 | sat % at +12 dB',
);
const septumRef: Record<string, number> = {};
for (const tier of ['medium', 'high'] as const) {
  for (const viewId of ['plax', 'a4c', 'psax-pm']) {
    const settings = { ...DEFAULT_ACQUISITION };
    const { frame, spec } = render(viewId, settings, tier);
    const { lines: L, samples: N } = spec;
    const dr = spec.depthCm / N;
    const norm = (i: number): number =>
      (frame.amplitude[i] ?? 0) / Math.max(1e-4, frame.transmission[i] ?? 1);
    const band = (i: number, a: number, b: number): boolean =>
      (i % N) * dr >= a && (i % N) * dr < b;
    const myo: number[] = [];
    const blood: number[] = [];
    const sept: number[] = [];
    for (let i = 0; i < L * N; i++) {
      if (!band(i, 3, 12)) continue;
      const st = frame.structure[i] ?? 0,
        ti = frame.tissue[i] ?? 0;
      if (ti === Tissue.Myocardium && isLvWall(st)) myo.push(norm(i));
      if (ti === Tissue.Blood && (st === Structure.LvCavity || st === Structure.LaCavity))
        blood.push(norm(i));
      if (ti === Tissue.Myocardium && st === Structure.LvWallSeptal) sept.push(norm(i));
    }
    const sm = stats(myo),
      sb = stats(blood),
      ss = stats(sept);
    // local SNR: 7 lines × 9 samples patches fully inside LV myocardium
    const localSnr: number[] = [];
    for (let li = 3; li < L - 3; li += 4)
      for (let s0 = Math.floor(3 / dr); s0 < Math.floor(12 / dr); s0 += 5) {
        const vals: number[] = [];
        let ok = true;
        for (let dl = -3; dl <= 3 && ok; dl++)
          for (let ds = -4; ds <= 4; ds++) {
            const i = (li + dl) * N + s0 + ds;
            if (frame.tissue[i] !== Tissue.Myocardium || !isLvWall(frame.structure[i] ?? 0)) {
              ok = false;
              break;
            }
            vals.push(norm(i));
          }
        if (ok) {
          const st = stats(vals);
          localSnr.push(st.mean / st.std);
        }
      }
    localSnr.sort((a, b) => a - b);
    // blood at least 3 lines and 4 samples away from any non-blood sample
    const farBlood: number[] = [];
    for (let li = 3; li < L - 3; li++)
      for (let si = Math.floor(3 / dr); si < Math.floor(12 / dr); si++) {
        let ok = true;
        for (let dl = -3; dl <= 3 && ok; dl++)
          for (let ds = -4; ds <= 4; ds++)
            if (frame.tissue[(li + dl) * N + si + ds] !== Tissue.Blood) {
              ok = false;
              break;
            }
        if (ok) farBlood.push(norm(li * N + si));
      }
    const sfb = stats(farBlood);
    const myoMask = (li: number, si: number): boolean =>
      frame.tissue[li * N + si] === Tissue.Myocardium;
    const cell = (d0: number, d1: number): [string, string] => {
      const s0 = Math.floor(d0 / dr),
        s1 = Math.floor(d1 / dr);
      const lat = halfWidth(
        (si, li) => norm(li * N + si),
        (si, li) => myoMask(li, si),
        [s0, s1],
        [0, L],
      );
      const ax = halfWidth((li, si) => norm(li * N + si), myoMask, [0, L], [s0, s1]);
      const pitchMm = (((d0 + d1) / 2) * spec.sectorRad * 10) / L;
      return [fmt(2 * lat.lag * pitchMm, 1), fmt(2 * ax.lag * dr * 10, 1)];
    };
    const c1 = cell(3, 5),
      c2 = cell(7, 9),
      c3 = cell(11, 13);
    if (viewId === 'plax') septumRef[tier] = ss.mean;
    const septRel = viewId === 'plax' ? 0 : 20 * Math.log10(ss.mean / (septumRef[tier] ?? NaN));
    const grey = (gainDb: number): { myo: number; blood: number; peri95: number; sat: number } => {
      const s2 = { ...settings, gainDb };
      const disp = new Uint8ClampedArray(L * N);
      applyConsole(frame, s2, createConsoleState(c.seed), disp);
      const gm: number[] = [],
        gb: number[] = [],
        gp: number[] = [];
      let tissue = 0,
        sat = 0;
      for (let i = 0; i < L * N; i++) {
        const st = frame.structure[i] ?? 0,
          ti = frame.tissue[i] ?? 0,
          g = disp[i] ?? 0;
        if (ti === Tissue.Myocardium && isLvWall(st)) gm.push(g);
        if (ti === Tissue.Blood && st === Structure.LvCavity) gb.push(g);
        if (ti === Tissue.Pericardium) gp.push(g);
        if (ti !== Tissue.None && ti !== Tissue.Blood && ti !== Tissue.Lung) {
          tissue++;
          if (g >= 254) sat++;
        }
      }
      gp.sort((a, b) => a - b);
      return {
        myo: stats(gm).mean,
        blood: stats(gb).mean,
        peri95: gp[Math.floor(gp.length * 0.95)] ?? NaN,
        sat: (100 * sat) / Math.max(1, tissue),
      };
    };
    const g0 = grey(0),
      g12 = grey(12);
    log(
      [
        viewId,
        tier,
        fmt(sm.mean / sm.std),
        `${fmt(localSnr[Math.floor(localSnr.length / 2)] ?? NaN)} (n ${localSnr.length})`,
        fmt(sm.skew),
        `${c1[0]} / ${c2[0]} / ${c3[0]}`,
        `${c1[1]} / ${c2[1]} / ${c3[1]}`,
        fmt(20 * Math.log10(sm.mean / sb.mean), 1),
        fmt(20 * Math.log10(sm.mean / sfb.mean), 1),
        fmt(septRel, 1),
        `${fmt(g0.myo, 0)} / ${fmt(g0.blood, 0)} / ${fmt(g0.peri95, 0)}`,
        fmt(g12.sat, 1),
      ].join(' | '),
    );
  }
}
