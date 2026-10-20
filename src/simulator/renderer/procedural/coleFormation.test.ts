// @tier slow
/**
 * The tracer forms its image the way it is asked (decision 351): the app's lattice phasor detected in COMPOUND_LOOKS
 * looks by default, or the point scatterers, the number of looks and the kernels an offline engine brings. On the
 * normal case's four-chamber view.
 */
import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { createHeartModel, computeHeartPose } from '@/simulator/anatomy/heartModel';
import { createThoraxModel } from '@/simulator/anatomy/thoraxModel';
import { Structure, Tissue } from '@/simulator/anatomy/tissue';
import { buildBeatTables, cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import { buildColeKernels } from '../acoustic/colePsf';
import {
  SCATTER_FIELD,
  STRONG_SCATTERER_FRACTION,
  type ScatterField,
} from '../acoustic/scatterers';
import { COMPOUND_LOOKS } from '../acoustic/acoustics';
import {
  allocPolarFrame,
  DEFAULT_ACQUISITION,
  polarSpecFor,
  type PolarFrame,
  type PolarFrameSpec,
  type Scene,
} from '../types';
import { ProceduralSliceRenderer, type ImageFormation } from './sliceRenderer';

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
const spec = polarSpecFor(settings, 'medium');
const scene: Scene = {
  heart,
  heartPose: computeHeartPose(heart, cycleStateAt(tables, 0)),
  thorax,
  physics: {
    frequencyMHz: settings.frequencyMHz,
    harmonics: settings.harmonics,
    clutterLevel: 0,
    windowAttenuation: c.acousticWindow.chestWallAttenuation,
    seed: c.seed,
  },
};
const beam = beamFrameFromPose(
  poseFromControl(thorax, canonicalControl(getViewTarget('a4c'), heart, thorax)),
  1,
);
function render(formation?: ImageFormation): PolarFrame {
  const f = allocPolarFrame(spec);
  new ProceduralSliceRenderer(formation).render(scene, beam, spec, 0, f);
  return f;
}

const isLvWall = (s: number): boolean => s >= Structure.LvWallSeptal && s <= Structure.LvApex;
/** Median mean/std of the envelope (over the transmission) in 7 × 9 patches fully inside LV myocardium. */
function myocardialSnr(f: PolarFrame, s: PolarFrameSpec): number {
  const { lines: L, samples: N } = s;
  const dr = s.depthCm / N;
  const out: number[] = [];
  for (let li = 3; li < L - 3; li += 4)
    for (let s0 = Math.floor(3 / dr); s0 < Math.floor(12 / dr); s0 += 5) {
      const v: number[] = [];
      let ok = true;
      for (let dl = -3; dl <= 3 && ok; dl++)
        for (let ds = -4; ds <= 4; ds++) {
          const i = (li + dl) * N + s0 + ds;
          if (f.tissue[i] !== Tissue.Myocardium || !isLvWall(f.structure[i] ?? 0)) {
            ok = false;
            break;
          }
          v.push(f.amplitude[i]! / Math.max(1e-4, f.transmission[i]!));
        }
      if (!ok) continue;
      const m = v.reduce((a, b) => a + b, 0) / v.length;
      out.push(m / Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length));
    }
  out.sort((a, b) => a - b);
  return out[out.length >> 1]!;
}

describe('image formation of the CPU tracer (decision 351)', () => {
  it('forms the app’s image by default: the lattice phasor in COMPOUND_LOOKS looks', () => {
    const d = render(),
      l = render({ looks: COMPOUND_LOOKS });
    expect(Array.from(d.amplitude)).toEqual(Array.from(l.amplitude));
  });

  it('detects the looks it is asked for: one look is rougher than two, at the same mean level', () => {
    const f1 = render({ looks: 1 }),
      f2 = render({ looks: 2 });
    expect(myocardialSnr(f2, spec) / myocardialSnr(f1, spec)).toBeGreaterThan(1.15);
    // each look is detected and their envelopes averaged: the mean envelope does not depend on how many
    const meanWall = (f: PolarFrame) => {
      let m = 0,
        n = 0;
      for (let i = 0; i < f.amplitude.length; i++)
        if (f.tissue[i] === Tissue.Myocardium && isLvWall(f.structure[i]!)) {
          m += f.amplitude[i]!;
          n++;
        }
      return m / n;
    };
    expect(meanWall(f1) / meanWall(f2)).toBeGreaterThan(0.85);
    expect(meanWall(f1) / meanWall(f2)).toBeLessThan(1.15);
  });

  it('takes the kernels and the scatterers an engine brings', () => {
    let calls = 0;
    const kernels: ImageFormation['kernels'] = (s, f, h) => {
      calls++;
      return buildColeKernels(s, f, h);
    };
    const scat = render({ looks: 1, scatterers: SCATTER_FIELD, kernels });
    expect(calls).toBeGreaterThan(0);
    const lat = render({ looks: 1, kernels });
    let diff = 0;
    for (let i = 0; i < scat.amplitude.length; i++)
      diff += Math.abs(scat.amplitude[i]! - lat.amplitude[i]!);
    expect(diff / scat.amplitude.length).toBeGreaterThan(1e-3);
    // the same anatomy either way
    expect(Array.from(scat.structure)).toEqual(Array.from(lat.structure));
  });

  it('forms each frame with the scene’s formation when it brings one (decision 354)', () => {
    const cole: ImageFormation = { looks: 1, scatterers: SCATTER_FIELD, kernels: buildColeKernels };
    const tracer = new ProceduralSliceRenderer();
    const withCole = allocPolarFrame(spec);
    tracer.render({ ...scene, imageFormation: cole }, beam, spec, 0, withCole);
    expect(Array.from(withCole.amplitude)).toEqual(Array.from(render(cole).amplitude));
    // and its own again on the next frame without one
    const own = allocPolarFrame(spec);
    tracer.render(scene, beam, spec, 0, own);
    expect(Array.from(own.amplitude)).toEqual(Array.from(render().amplitude));
  });

  it('asks for parenchyma’s strong scatterers, and draws its grains with them alone (decision 356)', () => {
    // a scatter field that records the fraction of strong scatterers it is asked for and echoes nothing
    const asked = new Set<number>();
    const silent: ScatterField = {
      wavenumber: SCATTER_FIELD.wavenumber,
      phasor: (...a: Parameters<ScatterField['phasor']>) => {
        asked.add(a[11]);
        a[12].re = 0;
        a[12].im = 0;
      },
    };
    const quiet = render({ looks: 1, scatterers: silent, kernels: buildColeKernels });
    // the myocardium and the other parenchyma take the strong ones, blood and the rest none
    expect([...asked].sort()).toEqual([0, STRONG_SCATTERER_FRACTION]);
    // without the scatterers' echo the LV wall is dark but for its interfaces: the lattice's bright grains are not drawn
    const wall = (f: PolarFrame, q: number) => {
      const v: number[] = [];
      for (let i = 0; i < f.amplitude.length; i++)
        if (f.tissue[i] === Tissue.Myocardium && isLvWall(f.structure[i]!)) v.push(f.amplitude[i]!);
      v.sort((x, y) => x - y);
      return v[Math.floor(v.length * q)]!;
    };
    const lattice = render({ looks: 1, kernels: buildColeKernels });
    expect(wall(quiet, 0.5)).toBeLessThan(0.1 * wall(lattice, 0.5));
    expect(wall(quiet, 0.9)).toBeLessThan(0.1 * wall(lattice, 0.9));
  });
});
